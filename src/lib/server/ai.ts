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
import { isKeyProblem, withFallback } from "./keys";

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
  return chain.slice(0, 8).map(validSpec);
}

/** Worth trying the next model: rate/quota limits, bad keys, or a model id the provider doesn't know. */
function shouldTryNextModel(e: unknown) {
  if (isKeyProblem(e)) return true;
  const st = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  return st === 404 || /model.*(not found|does not exist|not supported|unavailable|deprecated)|resource.?exhausted|overloaded|503/i.test(msg);
}

/** Which model actually answered, per request (so routes can report a fallback to the UI). */
const used = new WeakMap<Request, string>();

/**
 * Run an AI call down the model chain: for each model, try every key for its provider; on a limit/quota/
 * missing-model error move to the next model. Other errors (bad prompt, schema) are thrown immediately.
 */
export async function withAi<T>(req: Request, fn: (model: LanguageModel) => Promise<T>): Promise<T> {
  const chain = aiChainFromRequest(req);
  const failures: string[] = [];
  for (const [i, spec] of chain.entries()) {
    try {
      const out = await withFallback(spec.keys, "AI", (key) => fn(makeModel(spec.provider, key, spec.model, spec.baseURL)));
      if (i > 0) used.set(req, `${spec.provider}/${spec.model}`);
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${spec.model}: ${msg.split("\n")[0].slice(0, 120)}`);
      if (!shouldTryNextModel(e) || i === chain.length - 1) {
        if (chain.length > 1 && shouldTryNextModel(e)) throw new HttpError(429, `Every model in your chain hit a limit or failed. ${failures.join(" · ")}`);
        throw e;
      }
    }
  }
  throw new HttpError(500, "No AI model available.");
}

/** Response.json + an `x-ai-fallback` header naming the backup model that answered (if any). */
export function aiJson(req: Request, data: unknown) {
  const fallback = used.get(req);
  return Response.json(data, fallback ? { headers: { "x-ai-fallback": fallback } } : undefined);
}
