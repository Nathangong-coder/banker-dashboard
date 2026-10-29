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

/** `<accountId>.<12 random>.<11 mac>`; the mac covers the account and the random part. */
export async function mintPixelId(accountId: string, key: string): Promise<string> {
  const rand = b64url(crypto.getRandomValues(new Uint8Array(9)).buffer).slice(0, 12);
  const mac = b64url(await hmac(key, accountId + "." + rand)).slice(0, 11);
  return `${accountId}.${rand}.${mac}`;
}

/** Account behind a genuine id, else null. The mac comparison doesn't stop at the first difference. */
export async function verifyPixelId(
  id: string,
  keyFor: (accountId: string) => Promise<string>,
): Promise<{ accountId: string } | null> {
  if (id.length > 200) return null;
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{11})$/.exec(id);
  if (!m) return null;
  const want = b64url(await hmac(await keyFor(m[1]), m[1] + "." + m[2])).slice(0, 11);
  let diff = want.length ^ m[3].length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (m[3].charCodeAt(i) || 0);
  return diff === 0 ? { accountId: m[1] } : null;
}

export const pixelUrl = (base: string, id: string) => `${base}/api/o/${id}.gif`;

/** Finds a pixel in HTML or in a Gmail image-proxy URL (`…#https://site/api/o/<id>.gif`); group 1 is the id. */
export const PIXEL_PATH_RE = /\/api\/o\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{11})\.gif/;

/** Is this pixel id one of this account's? (Another Coverage user's tracked email opened in your Gmail isn't.) */
export const ownPixelId = (id: string, accountId: string | undefined) => !!accountId && id.startsWith(accountId + ".");
