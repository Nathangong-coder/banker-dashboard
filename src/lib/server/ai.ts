import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";

/**
 * Users bring their own key: an Anthropic key (sk-ant-...) goes straight to Anthropic,
 * anything else is treated as a Vercel AI Gateway key.
 */
export function modelFromRequest(req: Request) {
  const key = req.headers.get("x-ai-key")?.trim();
  const modelId = req.headers.get("x-ai-model")?.trim() || "claude-sonnet-5";
  if (!key) throw new HttpError(400, "Add an AI key (Anthropic or Vercel AI Gateway) in Settings.");
  if (key.startsWith("sk-ant-")) {
    return createAnthropic({ apiKey: key })(modelId.replace(/^anthropic\//, ""));
  }
  return createGateway({ apiKey: key })(modelId.includes("/") ? modelId : `anthropic/${modelId}`);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : "Unexpected error";
  return Response.json({ error: message }, { status });
}
