"use client";

/**
 * Accounts (owner, 2026-10-25): the dashboard's Gmail / Calendar / Docs calls take their Google access token from the
 * server's "Connect Google" connection when it covers the scopes they need (api/server/google/token), so signed-in
 * users never see Google's popup. gmail.ts / gcal.ts / gdocs.ts fall back to their own popups otherwise (not connected,
 * or an older connection without that permission). Registered in Shell so those files stay store-free for scripts.
 */

type Source = () => Promise<{ access: string | null; scopes: string[]; exp: number } | null>;
type Token = { access: string; scopes: string[]; exp: number };
let source: Source | null = null;
let cached: Token | null = null;
let inflight: Promise<Token | null> | null = null;
/** Not connected: don't ask the server again for a minute. */
let noneUntil = 0;

export function setServerGoogleToken(fn: Source | null) {
  source = fn;
  cached = null;
  noneUntil = 0;
}

/** A server-issued token covering every scope given, or null (then the caller uses its popup). */
export async function serverGoogleToken(scopes: string[]): Promise<string | null> {
  if (!source) return null;
  if ((!cached || cached.exp <= Date.now()) && Date.now() >= noneUntil) {
    inflight ??= source()
      .then((t): Token | null => (t?.access ? { access: t.access, scopes: t.scopes, exp: t.exp } : null))
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
    cached = await inflight;
    if (!cached) noneUntil = Date.now() + 60_000;
  }
  if (!cached) return null;
  return scopes.every((s) => cached!.scopes.includes(s)) ? cached.access : null;
}

/** Google said 401 for a server token: forget it so the next call fetches a fresh one. */
export function dropServerGoogleToken() {
  cached = null;
  noneUntil = 0;
}
