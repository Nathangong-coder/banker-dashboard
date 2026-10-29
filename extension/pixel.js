// Twin of src/lib/pixel.ts (mint / url / regex): the extension has no bundler, so keep the two in step.
const enc = new TextEncoder();

function b64url(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

export async function mintPixelId(accountId, key, now = Date.now()) {
  const day = Math.floor(now / 86_400_000).toString(36);
  const rand = b64url(crypto.getRandomValues(new Uint8Array(9)).buffer).slice(0, 12);
  const mac = b64url(await hmac(key, `${accountId}.${day}.${rand}`)).slice(0, 11);
  return `${accountId}.${day}.${rand}.${mac}`;
}

export const pixelUrl = (base, id) => `${base}/api/o/${id}.gif`;

export const PIXEL_PATH_RE = /\/api\/o\/([A-Za-z0-9_-]+\.(?:[0-9a-z]{3,6}\.)?[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{11})\.gif/;

export const ownPixelId = (id, accountId) => !!accountId && typeof id === "string" && id.startsWith(accountId + ".");
