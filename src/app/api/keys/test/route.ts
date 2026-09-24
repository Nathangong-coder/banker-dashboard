import { generateText } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { makeModel, PROVIDERS } from "@/lib/server/ai";
import { HttpError, assertPublicHttps, errorResponse } from "@/lib/server/http";
import type { AiProvider } from "@/lib/types";

/**
 * Validate a credential before the UI stores it. Uses free endpoints wherever possible
 * (model lists, account/usage endpoints) so testing doesn't burn credits.
 */
const Body = z.discriminatedUnion("service", [
  z.object({ service: z.literal("apollo"), key: z.string().min(8) }),
  z.object({ service: z.literal("hunter"), key: z.string().min(8) }),
  z.object({ service: z.literal("serper"), key: z.string().min(8) }),
  z.object({ service: z.literal("brave"), key: z.string().min(8) }),
  z.object({
    service: z.literal("ai"),
    key: z.string().min(8),
    provider: z.enum(PROVIDERS as [AiProvider, ...AiProvider[]]),
    baseURL: z.string().optional(),
    /** When set, also prove this exact model answers (tiny completion). */
    model: z.string().optional(),
  }),
  z.object({
    service: z.literal("twilio"),
    sid: z.string().regex(/^AC[0-9a-fA-F]{32}$/, "Account SID should start with AC and be 34 characters"),
    token: z.string().min(16),
  }),
]);

export interface KeyTestResult {
  ok: boolean;
  note: string;
  models?: string[];
}

const ok = (note: string, models?: string[]): KeyTestResult => ({ ok: true, note, models });
const bad = (note: string): KeyTestResult => ({ ok: false, note });

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, json: json as Record<string, unknown> | null, text };
}

function errText(json: Record<string, unknown> | null, text: string) {
  const e = json?.error as { message?: string; detail?: string } | string | undefined;
  const hunter = (json?.errors as { details?: string }[] | undefined)?.[0]?.details;
  return (typeof e === "string" ? e : (e?.message ?? e?.detail)) ?? hunter ?? (json?.message as string) ?? text.slice(0, 160);
}

const firstLine = (m: string) => m.split(/\r?\n/)[0].slice(0, 200);

async function testAi(provider: AiProvider, key: string, baseURL?: string): Promise<KeyTestResult> {
  const bearer = { Authorization: `Bearer ${key}` };
  const list = async (url: string, init: RequestInit, pick: (j: Record<string, unknown>) => string[]) => {
    const { res, json, text } = await getJson(url, init);
    if (res.status === 401 || res.status === 403) return bad(`Rejected: ${errText(json, text)}`);
    if (!res.ok || !json) return null; // listing unsupported → fall back to a tiny completion
    const models = pick(json).sort();
    return ok(`Key works · ${models.length} models available`, models);
  };
  const ids = (j: Record<string, unknown>) => ((j.data as { id: string }[]) ?? []).map((m) => m.id);

  let r: KeyTestResult | null = null;
  switch (provider) {
    case "anthropic":
      r = await list("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }, ids);
      break;
    case "openai":
      r = await list("https://api.openai.com/v1/models", { headers: bearer }, (j) =>
        ids(j).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|tts|transcribe|image|search/.test(id)),
      );
      break;
    case "google":
      r = await list(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, {}, (j) =>
        ((j.models as { name: string; supportedGenerationMethods?: string[] }[]) ?? [])
          .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/.test(m.name))
          .map((m) => m.name.replace(/^models\//, "")),
      );
      if (r === null) r = bad("Google rejected this key. Create one at aistudio.google.com/apikey.");
      break;
    case "deepseek":
      r = await list("https://api.deepseek.com/models", { headers: bearer }, ids);
      break;
    case "glm":
    case "custom": {
      const base = (baseURL || (provider === "glm" ? "https://api.z.ai/api/paas/v4" : "")).replace(/\/$/, "");
      if (!base) return bad("Enter the provider's base URL (e.g. https://api.example.com/v1).");
      assertPublicHttps(base, "Base URL");
      r = await list(`${base}/models`, { headers: bearer }, ids);
      break;
    }
    case "gateway":
      try {
        const credits = await createGateway({ apiKey: key }).getCredits();
        // The gateway's model catalog is public; list the language models so the picker isn't empty.
        const { json } = await getJson("https://ai-gateway.vercel.sh/v1/models").catch(() => ({ json: null }));
        const models = ((json?.data as { id: string; type?: string }[]) ?? []).filter((m) => !m.type || m.type === "language").map((m) => m.id);
        return ok(`Key works · balance $${credits.balance}`, models.length ? models : undefined);
      } catch (e) {
        return bad(`Rejected: ${firstLine((e as Error).message)}`);
      }
  }
  if (r) return r;

  // No model listing: prove the key with the smallest possible completion.
  const model = provider === "glm" ? "glm-5.3-flash" : provider === "deepseek" ? "deepseek-chat" : "";
  if (!model) return ok("Key accepted (couldn't list models; type your model id manually).");
  try {
    await generateText({ model: makeModel(provider, key, model, baseURL), prompt: "Reply OK", maxOutputTokens: 3 });
    return ok("Key works");
  } catch (e) {
    return bad(`Rejected: ${(e as Error).message.slice(0, 200)}`);
  }
}

export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    let result: KeyTestResult;

    switch (b.service) {
      case "apollo": {
        // Free; needs a master key. A 403 means the key is real but not master.
        const { res, json, text } = await getJson("https://api.apollo.io/api/v1/usage_stats/api_usage_stats", {
          method: "POST",
          headers: { "x-api-key": b.key, "Content-Type": "application/json", "Cache-Control": "no-cache" },
        });
        if (res.ok) result = ok("Master key works (email lookups + people search)");
        else if (res.status === 403)
          result = ok("Key works for email lookups. Apollo people search needs a master key, so Find people won't use Apollo with this one.");
        else result = bad(`Apollo rejected this key: ${errText(json, text)}`);
        break;
      }
      case "hunter": {
        const { res, json, text } = await getJson(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(b.key)}`);
        if (!res.ok) {
          result = bad(`Hunter rejected this key: ${errText(json, text)}`);
          break;
        }
        const s = (json?.data as { requests?: { searches?: { used: number; available: number } } })?.requests?.searches;
        result = ok(s ? `Key works · ${s.available - s.used} of ${s.available} searches left this month` : "Key works");
        break;
      }
      case "serper": {
        // Serper has no free account endpoint; this uses 1 search credit.
        const { res, json, text } = await getJson("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": b.key, "Content-Type": "application/json" },
          body: JSON.stringify({ q: "investment banking analyst", num: 10 }),
        });
        result = res.ok ? ok("Key works (used 1 search credit to check)") : bad(`Serper rejected this key: ${errText(json, text)}`);
        break;
      }
      case "brave": {
        const { res, json, text } = await getJson("https://api.search.brave.com/res/v1/web/search?q=investment%20banking%20analyst&count=1", {
          headers: { "X-Subscription-Token": b.key, Accept: "application/json" },
        });
        result = res.ok ? ok("Key works (used 1 query to check)") : bad(`Brave rejected this key: ${errText(json, text)}`);
        break;
      }
      case "ai": {
        const baseURL = b.baseURL?.trim() || undefined;
        result = await testAi(b.provider, b.key.trim(), baseURL);
        if (result.ok && b.model) {
          try {
            await generateText({ model: makeModel(b.provider, b.key.trim(), b.model, baseURL), prompt: "Reply OK", maxOutputTokens: 5 });
            result = { ...result, note: `${b.model} responds` };
          } catch (e) {
            result = bad(`${b.model} failed: ${(e as Error).message.slice(0, 200)}`);
          }
        }
        break;
      }
      case "twilio": {
        const { res, json, text } = await getJson(`https://api.twilio.com/2010-04-01/Accounts/${b.sid}.json`, {
          headers: { Authorization: `Basic ${Buffer.from(`${b.sid}:${b.token}`).toString("base64")}` },
        });
        if (!res.ok) result = bad(`Twilio rejected these credentials: ${errText(json, text)}`);
        else {
          const acct = json as { friendly_name?: string; type?: string; status?: string };
          result = ok(`Connected to “${acct.friendly_name}” (${acct.type === "Trial" ? "trial: can only text verified numbers" : acct.type}, ${acct.status})`);
        }
        break;
      }
    }
    return Response.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) return errorResponse(new HttpError(400, e.issues[0]?.message ?? "Invalid input"));
    return errorResponse(e);
  }
}
