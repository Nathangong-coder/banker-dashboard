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

const firstLine = (e: unknown) => redact((e instanceof Error ? e.message : String(e)).split("\n")[0]).slice(0, 200);

/** AI SDK wraps the provider's error after retries (RetryError.lastError) or as a cause; dig out the real one. */
function unwrap(e: unknown): unknown {
  let cur = e;
  for (let i = 0; i < 4; i++) {
    const inner = (cur as { lastError?: unknown; cause?: unknown })?.lastError ?? (cur as { cause?: unknown })?.cause;
    if (!inner || inner === cur) break;
    if ((cur as { statusCode?: number })?.statusCode) break;
    cur = inner;
  }
  return cur;
}

type FailKind = "daily" | "rate" | "busy" | "key" | "model" | "fatal";

/** Never let a key reach a log line or an error message. */
export function redact(s: string) {
  return s
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIza…")
    .replace(/\b(sk|gsk|xai|pk)-[A-Za-z0-9_-]{8,}/g, "$1-…")
    .replace(/(key=)[^&\s"]+/gi, "$1…");
}

/**
 * Why a model+key failed, which decides what to try next:
 * daily / rate / key → the next key for the same model; busy (overloaded, "high demand", 5xx, network) / model
 * (unknown id) → the next model; fatal (bad request, schema) → stop, since another model won't fix the prompt.
 */
export function classifyAiError(e: unknown): { kind: FailKind; text: string } {
  const st = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  const text = `${e instanceof Error ? e.message : String(e)} ${(e as { responseBody?: string })?.responseBody ?? ""}`;
  if (st === 429 || /quota|resource.?exhausted|rate.?limit|too many requests/i.test(text))
    return /per.?day|daily/i.test(text) ? { kind: "daily", text: "used up today's quota" } : { kind: "rate", text: "rate-limited" };
  if (st === 401 || st === 403 || /api key not valid|invalid api key|api_key_invalid|unauthori[sz]ed|permission.?denied|billing|insufficient|credit balance/i.test(text))
    return { kind: "key", text: "key rejected" };
  if (st === 404 || /model.*(not found|does not exist|not supported|deprecated)|is not found for api version/i.test(text))
    return { kind: "model", text: "model not available" };
  if ((st && st >= 500) || /high demand|overloaded|unavailable|try again later|timed? ?out|econnreset|fetch failed|socket hang up|network/i.test(text))
    return { kind: "busy", text: /high demand|overloaded/i.test(text) ? "busy (high demand)" : `unavailable${st ? ` (${st})` : ""}` };
  // Our own errors (e.g. a missing base URL) and cancelled requests: another model won't help.
  if (e instanceof HttpError || (e as { name?: string })?.name === "AbortError") return { kind: "fatal", text: firstLine(e) };
  // Everything else the provider says (this model can't do JSON output / system instructions, returned unparseable
  // output, rejected the request) is specific to the model, so the next one gets a chance.
  if (/not enabled for models|not supported|does not support|developer instruction|json mode|response.?schema|no object generated|could not parse|did not match|schema/i.test(text))
    return { kind: "model", text: `can't do this request (${firstLine(e).slice(0, 90)})` };
  return { kind: "model", text: `failed: ${firstLine(e).slice(0, 110)}` };
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

/** Per request: which model answered, which model+keys to rest, and what was skipped on the way (reported as headers). */
const used = new WeakMap<Request, string>();
const exhausted = new WeakMap<Request, AiExhausted[]>();
const skipped = new WeakMap<Request, { model: string; reason: string }[]>();

/** One try of one model with one key, for the Vercel logs and the browser console (never includes the key). */
export interface AiAttempt {
  model: string;
  provider: string;
  key: string;
  ok: boolean;
  kind?: string;
  status?: number;
  error?: string;
  ms: number;
}
const attemptLog = new WeakMap<Request, AiAttempt[]>();

/** A busy model is rested on every key for this long, so the next few requests go straight to a working one. */
const BUSY_REST_MS = 2 * 60_000;

/**
 * Run an AI call down the model chain until something answers: for each model, try its keys in order. Quota /
 * rate / bad-key errors move to the next key; a busy or unknown model moves to the next model. Only a bad
 * request (which no other model would fix) stops early. SDK retries are off except on the very last option.
 * Everything skipped is reported back, and quota/busy hits are rested in the browser so later calls skip them.
 */
export async function withAi<T>(req: Request, fn: (model: LanguageModel, opts: { maxRetries: number }) => Promise<T>): Promise<T> {
  const chain = aiChainFromRequest(req);
  const spent: AiExhausted[] = [];
  const passed: { model: string; reason: string }[] = [];
  exhausted.set(req, spent);
  skipped.set(req, passed);
  const attempts: AiAttempt[] = [];
  attemptLog.set(req, attempts);
  const route = new URL(req.url).pathname;
  const total = chain.reduce((n, s) => n + s.keys.length, 0);
  let attempt = 0;
  let last: unknown;
  for (const [i, spec] of chain.entries()) {
    const reasons: string[] = [];
    for (const [k, key] of spec.keys.entries()) {
      attempt++;
      const t0 = Date.now();
      const keyLabel = `${k + 1}/${spec.keys.length}`;
      try {
        const out = await fn(makeModel(spec.provider, key, spec.model, spec.baseURL), { maxRetries: attempt === total ? 2 : 0 });
        if (i > 0 || passed.length) used.set(req, `${spec.provider}/${spec.model}`);
        attempts.push({ model: spec.model, provider: spec.provider, key: keyLabel, ok: true, ms: Date.now() - t0 });
        if (attempts.length > 1) console.info(`[ai] ${route} answered by ${spec.provider}/${spec.model} after ${attempts.length - 1} skip(s)`);
        return out;
      } catch (err) {
        const e = unwrap(err);
        last = e;
        const why = classifyAiError(e);
        const status = (e as { statusCode?: number })?.statusCode;
        const a: AiAttempt = { model: spec.model, provider: spec.provider, key: keyLabel, ok: false, kind: why.kind, status, error: firstLine(e), ms: Date.now() - t0 };
        attempts.push(a);
        // Shows up in the Vercel function logs (Deployments → Logs), one line per failed try.
        console.warn(`[ai] ${route} ${a.provider}/${a.model} key ${a.key} → ${a.kind}${status ? ` ${status}` : ""}: ${a.error}`);
        if (why.kind === "fatal") throw e;
        const keyId = spec.ids?.[k];
        const cool = cooldownUntil(e);
        if (cool) spent.push({ provider: spec.provider, model: spec.model, keyId, ...cool });
        reasons.push(why.text);
        if (why.kind === "busy") {
          // Overload is on the provider's side for the whole model: rest it on every key and move on.
          const until = new Date(Date.now() + BUSY_REST_MS).toISOString();
          for (const id of spec.ids ?? []) spent.push({ provider: spec.provider, model: spec.model, keyId: id, until, daily: false });
          attempt += spec.keys.length - k - 1;
          break;
        }
        if (why.kind === "model") {
          attempt += spec.keys.length - k - 1;
          break;
        }
      }
    }
    // "used up today's quota on both keys", "busy (high demand)", "key rejected, rate-limited"
    const uniq = [...new Set(reasons)];
    const reason = uniq.length === 1 && reasons.length > 1 ? `${uniq[0]} on ${reasons.length === 2 ? "both" : `all ${reasons.length}`} keys` : uniq.join(", ");
    passed.push({ model: spec.model, reason });
  }
  if (total > 1 || passed.length > 1) {
    const allBusy = passed.every((p) => /busy|unavailable/.test(p.reason));
    throw new HttpError(
      allBusy ? 503 : 429,
      `Tried all ${passed.length} model${passed.length > 1 ? "s" : ""} (${total} model/key combos) and none answered: ` +
        passed.map((p) => `${p.model} ${p.reason}`).join(" · ") +
        (allBusy ? ". Google's servers are overloaded; try again in a minute." : ". Add another key or backup model in Settings, or wait for quotas to reset (midnight PT)."),
    );
  }
  throw last;
}

function aiHeaders(req: Request) {
  const h: Record<string, string> = {};
  const fallback = used.get(req);
  if (fallback) h["x-ai-fallback"] = fallback;
  const spent = exhausted.get(req);
  if (spent?.length) h["x-ai-exhausted"] = JSON.stringify(spent);
  const passed = skipped.get(req);
  if (passed?.length) h["x-ai-skipped"] = JSON.stringify(passed);
  return h;
}

/** Response.json + `x-ai-fallback` (the backup model that answered) and `x-ai-exhausted` (model+keys that ran out). */
export function aiJson(req: Request, data: unknown) {
  return Response.json(data, { headers: aiHeaders(req) });
}

/** errorResponse that still reports quota hits (so the browser skips them) and every attempt (for the console). */
export function aiErrorResponse(req: Request, e: unknown) {
  const attempts = attemptLog.get(req) ?? [];
  if (!(e instanceof HttpError) || !attempts.length) console.error(`[ai] ${new URL(req.url).pathname} failed:`, redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
  const status = e instanceof HttpError ? e.status : 500;
  const message = redact(e instanceof Error ? e.message : "Unexpected error");
  const res = Response.json({ error: message, attempts }, { status });
  for (const [k, v] of Object.entries(aiHeaders(req))) res.headers.set(k, v);
  return res;
}
