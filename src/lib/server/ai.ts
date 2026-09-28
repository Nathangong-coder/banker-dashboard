import "server-only";
import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogle } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiProvider } from "@/lib/types";
import { HttpError, assertPublicHttps, errorResponse } from "./http";
import { isKeyProblem } from "./keys";

export { HttpError, errorResponse };

export const PROVIDERS: AiProvider[] = ["anthropic", "openai", "google", "deepseek", "glm", "gateway", "custom"];
const GLM_BASE = "https://api.z.ai/api/paas/v4";

export function makeModel(provider: AiProvider, apiKey: string, modelId: string, baseURL?: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId.replace(/^anthropic\//, ""));
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "google":
      return createGoogle({ apiKey })(modelId.replace(/^models\//, ""));
    case "deepseek":
      return createDeepSeek({ apiKey })(modelId);
    case "glm":
      return createOpenAICompatible({ name: "glm", baseURL: baseURL || GLM_BASE, apiKey })(modelId);
    case "gateway":
      return createGateway({ apiKey })(modelId.includes("/") ? modelId : `anthropic/${modelId}`);
    case "custom":
      if (!baseURL) throw new HttpError(400, "Custom provider needs a base URL.");
      return createOpenAICompatible({ name: "custom", baseURL, apiKey })(modelId);
  }
}

interface AiSpec {
  provider: AiProvider;
  model: string;
  keys: string[];
  /** Vault ids for `keys` (same order), echoed back when a key runs out of quota. Not secret. */
  ids?: string[];
  baseURL?: string;
}

function validSpec(spec: AiSpec) {
  if (!PROVIDERS.includes(spec.provider)) throw new HttpError(400, `Unknown AI provider "${spec.provider}".`);
  if (!spec.model) throw new HttpError(400, "Pick an AI model in Settings.");
  if (!Array.isArray(spec.keys) || !spec.keys.length) throw new HttpError(400, "Add an AI key in Settings.");
  if (spec.baseURL) assertPublicHttps(spec.baseURL, "AI base URL");
  return spec;
}

/** Primary model first, then backups. Accepts the older single-model header shape too. */
export function aiChainFromRequest(req: Request): AiSpec[] {
  const raw = req.headers.get("x-ai");
  if (!raw) throw new HttpError(400, "Add an AI key in Settings (Claude, GPT, Gemini, DeepSeek, GLM…).");
  let parsed: { chain?: AiSpec[] } & Partial<AiSpec>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Malformed AI settings header.");
  }
  const chain = Array.isArray(parsed.chain) ? parsed.chain : [parsed as AiSpec];
  if (!chain.length) throw new HttpError(400, "Add an AI key in Settings.");
  return chain.slice(0, 12).map(validSpec);
}

/** Worth trying the next model: rate/quota limits, bad keys, or a model id the provider doesn't know. */
function shouldTryNextModel(e: unknown) {
  if (isKeyProblem(e)) return true;
  const st = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  return st === 404 || /model.*(not found|does not exist|not supported|unavailable|deprecated)|resource.?exhausted|overloaded|503/i.test(msg);
}

/** Next midnight in Pacific time, when Gemini's per-day quotas reset. */
function nextPacificMidnight(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const elapsed = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return new Date(now.getTime() + 86_400_000 - elapsed);
}

/**
 * For a rate/quota error, when that model+key is worth trying again: next Pacific midnight for daily
 * quotas (Gemini's "PerDay" limits), else the provider's "retry in Ns" hint, else a minute.
 */
function cooldownUntil(e: unknown): { until: string; daily: boolean } | undefined {
  const st = (e as { statusCode?: number })?.statusCode ?? (e as { status?: number })?.status;
  const text = `${e instanceof Error ? e.message : String(e)} ${(e as { responseBody?: string })?.responseBody ?? ""}`;
  if (st !== 429 && !/quota|resource.?exhausted|rate.?limit|too many requests/i.test(text)) return undefined;
  if (/per.?day|daily/i.test(text)) return { until: nextPacificMidnight().toISOString(), daily: true };
  const secs = Number(text.match(/retry(?:Delay"?\s*:\s*"| in )\s*([\d.]+)\s*s/i)?.[1] ?? 60);
  return { until: new Date(Date.now() + Math.min(Math.max(secs, 20), 3600) * 1000).toISOString(), daily: false };
}

/** A model+key that ran out, so the browser can skip it until `until`. */
export interface AiExhausted {
  provider: AiProvider;
  model: string;
  keyId?: string;
  until: string;
  daily: boolean;
}

/** Which model actually answered, and which model+keys ran out, per request (reported back as headers). */
const used = new WeakMap<Request, string>();
const exhausted = new WeakMap<Request, AiExhausted[]>();

/**
 * Run an AI call down the model chain: for each model, try every key for its provider; on a limit/quota/
 * missing-model error move straight on (no SDK retries, except on the very last option). Other errors
 * (bad prompt, schema) are thrown immediately. Quota hits are reported so the browser skips them next time.
 */
export async function withAi<T>(req: Request, fn: (model: LanguageModel, opts: { maxRetries: number }) => Promise<T>): Promise<T> {
  const chain = aiChainFromRequest(req);
  const spent: AiExhausted[] = [];
  exhausted.set(req, spent);
  const failures: string[] = [];
  const total = chain.reduce((n, s) => n + s.keys.length, 0);
  let attempt = 0;
  let last: unknown;
  for (const [i, spec] of chain.entries()) {
    for (const [k, key] of spec.keys.entries()) {
      attempt++;
      try {
        const out = await fn(makeModel(spec.provider, key, spec.model, spec.baseURL), { maxRetries: attempt === total ? 2 : 0 });
        if (i > 0) used.set(req, `${spec.provider}/${spec.model}`);
        return out;
      } catch (e) {
        last = e;
        const cool = cooldownUntil(e);
        if (cool) spent.push({ provider: spec.provider, model: spec.model, keyId: spec.ids?.[k], ...cool });
        if (isKeyProblem(e)) continue; // this key is out or invalid: next key for the same model
        if (!shouldTryNextModel(e)) throw e;
        break; // model-level problem (unknown model, overloaded): skip its other keys
      }
    }
    const msg = last instanceof Error ? last.message : String(last);
    failures.push(`${spec.model}: ${msg.split("\n")[0].slice(0, 120)}`);
  }
  if (total > 1) throw new HttpError(429, `Every model and key in your AI chain hit a limit or failed. ${failures.join(" · ")}`);
  throw last;
}

function aiHeaders(req: Request) {
  const h: Record<string, string> = {};
  const fallback = used.get(req);
  if (fallback) h["x-ai-fallback"] = fallback;
  const spent = exhausted.get(req);
  if (spent?.length) h["x-ai-exhausted"] = JSON.stringify(spent);
  return h;
}

/** Response.json + `x-ai-fallback` (the backup model that answered) and `x-ai-exhausted` (model+keys that ran out). */
export function aiJson(req: Request, data: unknown) {
  return Response.json(data, { headers: aiHeaders(req) });
}

/** errorResponse that still reports quota hits, so the browser skips those models next time. */
export function aiErrorResponse(req: Request, e: unknown) {
  const res = errorResponse(e);
  for (const [k, v] of Object.entries(aiHeaders(req))) res.headers.set(k, v);
  return res;
}
