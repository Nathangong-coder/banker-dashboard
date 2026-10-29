/**
 * Open-tracking pixel ids. The dashboard and extension mint them offline with a per-account key; the server
 * derives the same key from its secret, so verifying needs no database read. WebCrypto only (Node, browsers,
 * the extension worker). extension/pixel.js is the twin of mint / url / regex: keep them in step.
 */

const enc = new TextEncoder();

function b64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const raw = typeof key === "string" ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

/** The account's pixel key. Server only: it needs the server secret. */
export async function pixelKeyFor(serverSecret: string, accountId: string): Promise<string> {
  return b64url(await hmac(serverSecret, "pixel:" + accountId));
}

/** Opens are recorded for this many days after the pixel was made (the server checks the day in the id, no Redis). */
export const OPEN_DAYS = 60;
const DAY_MS = 86_400_000;

/**
 * `<accountId>.<day>.<12 random>.<11 mac>`; day = days since 1970 in base 36. The mac covers the account, the day and
 * the random part, so the day can't be moved forward. Ids from before the day existed (3 parts) still verify.
 */
export async function mintPixelId(accountId: string, key: string, now = Date.now()): Promise<string> {
  const day = Math.floor(now / DAY_MS).toString(36);
  const rand = b64url(crypto.getRandomValues(new Uint8Array(9)).buffer).slice(0, 12);
  const mac = b64url(await hmac(key, `${accountId}.${day}.${rand}`)).slice(0, 11);
  return `${accountId}.${day}.${rand}.${mac}`;
}

/** Account (and mint day, if the id has one) behind a genuine id, else null. The mac comparison doesn't stop early. */
export async function verifyPixelId(
  id: string,
  keyFor: (accountId: string) => Promise<string>,
): Promise<{ accountId: string; day?: number } | null> {
  if (id.length > 200) return null;
  const m = /^([A-Za-z0-9_-]+)\.(?:([0-9a-z]{3,6})\.)?([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{11})$/.exec(id);
  if (!m) return null;
  const signed = m[2] ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[3]}`;
  const want = b64url(await hmac(await keyFor(m[1]), signed)).slice(0, 11);
  let diff = want.length ^ m[4].length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (m[4].charCodeAt(i) || 0);
  if (diff !== 0) return null;
  return m[2] ? { accountId: m[1], day: parseInt(m[2], 36) } : { accountId: m[1] };
}

/** Past the recording window? Ids without a day (the first version) never expire here; the hit list's TTL covers them. */
export const pixelExpired = (day: number | undefined, now = Date.now()) => day !== undefined && Math.floor(now / DAY_MS) - day > OPEN_DAYS;

export const pixelUrl = (base: string, id: string) => `${base}/api/o/${id}.gif`;

/** Finds a pixel in HTML or in a Gmail image-proxy URL (`…#https://site/api/o/<id>.gif`); group 1 is the id. */
export const PIXEL_PATH_RE = /\/api\/o\/([A-Za-z0-9_-]+\.(?:[0-9a-z]{3,6}\.)?[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{11})\.gif/;

/** Is this pixel id one of this account's? (Another Coverage user's tracked email opened in your Gmail isn't.) */
export const ownPixelId = (id: string, accountId: string | undefined) => !!accountId && id.startsWith(accountId + ".");
