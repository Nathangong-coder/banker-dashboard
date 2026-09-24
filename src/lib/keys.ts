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

/** Header payload for the server: all usable keys for the selected provider (tried in order). */
export function aiHeader(s: Settings) {
  const keys = aiKeysFor(s);
  if (!keys.length) return undefined;
  return JSON.stringify({
    provider: s.ai.provider,
    model: s.ai.model,
    keys: keys.map((k) => k.value),
    baseURL: keys[0].baseURL || AI_PROVIDERS[s.ai.provider].defaultBaseURL,
  });
}

export function mask(v: string) {
  return v.length <= 8 ? "••••" : `${v.slice(0, 4)}…${v.slice(-4)}`;
}

/**
 * Sensible default from a provider's model list: skip previews/specialty models, prefer the highest
 * version number, and within a version prefer the balanced tier (sonnet / flash / chat / non-mini).
 */
export function pickDefaultModel(models: string[], suggested: string[] = []): string | undefined {
  if (suggested.length) return suggested[0];
  const usable = models.filter((m) => !/(preview|exp|tts|audio|image|embed|vision|realtime|search|transcribe|instruct|thinking|lite|nano|001$)/i.test(m));
  const version = (m: string) => Number(m.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const tier = (m: string) => (/-mini|haiku|small/.test(m) ? 1 : /opus|-pro\b|large|max/.test(m) ? 2 : 0);
  return [...(usable.length ? usable : models)].sort((a, b) => version(b) - version(a) || tier(a) - tier(b) || a.length - b.length)[0];
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
