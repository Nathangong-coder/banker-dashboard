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
import { withFallback } from "./keys";

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

export function aiFromRequest(req: Request): AiSpec {
  const raw = req.headers.get("x-ai");
  if (!raw) throw new HttpError(400, "Add an AI key in Settings (Claude, GPT, Gemini, DeepSeek, GLM…).");
  let spec: AiSpec;
  try {
    spec = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Malformed AI settings header.");
  }
  if (!PROVIDERS.includes(spec.provider)) throw new HttpError(400, `Unknown AI provider "${spec.provider}".`);
  if (!spec.model) throw new HttpError(400, "Pick an AI model in Settings.");
  if (!Array.isArray(spec.keys) || !spec.keys.length) throw new HttpError(400, "Add an AI key in Settings.");
  if (spec.baseURL) assertPublicHttps(spec.baseURL, "AI base URL");
  return spec;
}

/** Run an AI call with the request's provider/model, falling through the user's keys for that provider. */
export function withAi<T>(req: Request, fn: (model: LanguageModel) => Promise<T>): Promise<T> {
  const spec = aiFromRequest(req);
  return withFallback(spec.keys, "AI", (key) => fn(makeModel(spec.provider, key, spec.model, spec.baseURL)));
}
