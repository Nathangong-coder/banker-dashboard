import type { AiProvider, ApiKeyEntry, Settings, VaultService } from "./types";
import { AI_PROVIDERS } from "./types";

/** Keys to try, in priority order. Keys that failed their last test are skipped. */
export function usableKeys(s: Settings, service: VaultService): ApiKeyEntry[] {
  return s.vault[service].filter((k) => k.ok !== false);
}

export function hasKey(s: Settings, service: VaultService) {
  return usableKeys(s, service).length > 0;
}

export function aiKeysFor(s: Settings, provider: AiProvider = s.ai.provider) {
  return usableKeys(s, "ai").filter((k) => k.provider === provider);
}

export function aiReady(s: Settings) {
  return aiKeysFor(s).length > 0 && !!s.ai.model;
}

/** Header payload for the server: the model chain, each with all usable keys for its provider (tried in order). */
export function aiHeader(s: Settings) {
  const chain = modelChain(s).map((m) => {
    const keys = aiKeysFor(s, m.provider);
    return { provider: m.provider, model: m.model, keys: keys.map((k) => k.value), baseURL: keys[0]?.baseURL || AI_PROVIDERS[m.provider].defaultBaseURL };
  });
  return chain.length ? JSON.stringify({ chain }) : undefined;
}

export function mask(v: string) {
  return v.length <= 8 ? "••••" : `${v.slice(0, 4)}…${v.slice(-4)}`;
}

const NOT_TEXT = /(tts|audio|image|embed|vision|realtime|search|transcribe|instruct|computer-use|robotics|live|native-audio|001$)/i;
const version = (m: string) => Number(m.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
const tier = (m: string) => (/-mini|haiku|small/.test(m) ? 1 : /opus|-pro\b|large|max/.test(m) ? 2 : 0);

/** Text-chat models, best-first: newest version, then balanced tier (flash/sonnet/chat) before mini and pro. */
export function rankModels(models: string[], opts: { allowPreview?: boolean } = {}): string[] {
  const text = models.filter((m) => !NOT_TEXT.test(m));
  const stable = opts.allowPreview ? text : text.filter((m) => !/(preview|exp|thinking|lite|nano)/i.test(m));
  return [...(stable.length ? stable : text.length ? text : models)].sort((a, b) => version(b) - version(a) || tier(a) - tier(b) || a.length - b.length);
}

/**
 * Sensible default from a provider's model list: skip previews/specialty models, prefer the highest
 * version number, and within a version prefer the balanced tier (sonnet / flash / chat / non-mini).
 */
export function pickDefaultModel(models: string[], suggested: string[] = []): string | undefined {
  if (suggested.length) return suggested[0];
  return rankModels(models)[0];
}

export type ModelRef = { provider: AiProvider; model: string };

/**
 * Automatic backups: up to 3 other models from the same provider (separate per-model quotas, which is
 * what matters on Gemini's free tier; lite/preview models allowed here), then the top model of every
 * other provider the user has a key for.
 */
export function autoFallbacks(s: Settings): ModelRef[] {
  const out: ModelRef[] = [];
  const same = rankModels(modelOptions(s, s.ai.provider), { allowPreview: true }).filter((m) => m !== s.ai.model);
  for (const m of same.slice(0, 3)) out.push({ provider: s.ai.provider, model: m });
  const others = [...new Set(usableKeys(s, "ai").map((k) => k.provider!))].filter((p) => p !== s.ai.provider);
  for (const p of others) {
    const m = pickDefaultModel(modelOptions(s, p), AI_PROVIDERS[p].suggested);
    if (m) out.push({ provider: p, model: m });
  }
  return out;
}

export function modelChain(s: Settings): ModelRef[] {
  const backups = s.ai.fallbacks ?? autoFallbacks(s);
  const seen = new Set<string>();
  return [{ provider: s.ai.provider, model: s.ai.model }, ...backups].filter((m) => {
    const k = `${m.provider}/${m.model}`;
    if (!m.model || seen.has(k) || !aiKeysFor(s, m.provider).length) return false;
    seen.add(k);
    return true;
  });
}

/** Every model the user's keys unlocked for a provider, plus a few known-good suggestions. */
export function modelOptions(s: Settings, provider: AiProvider) {
  const fromKeys = s.vault.ai.filter((k) => k.provider === provider).flatMap((k) => k.models ?? []);
  return [...new Set([...AI_PROVIDERS[provider].suggested, ...fromKeys])];
}

/** The user's own OAuth client ID, else the deployment's default (NEXT_PUBLIC_GOOGLE_CLIENT_ID; not a secret). */
export function googleClientId(s: Settings) {
  return s.keys.googleClientId || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
}
