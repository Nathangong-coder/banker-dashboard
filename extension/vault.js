// Saved logins for application sites (opt-in, off by default; owner, 2026-10-24). The extension signs you in to a
// Workday (or other application site) account you already have, so a batch fill doesn't stop at every login.
//
// How it's kept safe:
// - Encrypted at rest (AES-GCM, key from your PIN via PBKDF2-SHA-256, 600,000 rounds) in chrome.storage.local.
// - Unlocked with your PIN once per browser session: the key sits in chrome.storage.session, which is in memory
//   only, cleared when the browser closes, and not readable by content scripts or web pages.
// - A login is used ONLY on the exact site (origin) it was saved for, only in a sign-in form, by fixed rules.
//   No AI ever sees it, it never goes to the dashboard or any server, and Chrome's saved passwords are never read
//   (there's no API for that). With "Create accounts for me" on (Options, test build), background.js#makeAccount
//   saves a generated password here BEFORE using it on that site's create-account form.

const ROUNDS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** https origin of a login page, or null (only https sites can hold a saved login; http only for a local dev server). */
export function loginOrigin(url) {
  try {
    const u = new URL(String(url).trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    return u.protocol === "https:" || (u.protocol === "http:" && local) ? u.origin : null;
  } catch {
    return null;
  }
}

async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ROUNDS }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function sessionKey() {
  const { vaultKey } = await chrome.storage.session.get("vaultKey");
  if (!vaultKey) return null;
  return crypto.subtle.importKey("raw", unb64(vaultKey), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(key, logins) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(logins)));
  return { iv: b64(iv), data: b64(data) };
}

async function open(key, box) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.data));
  return JSON.parse(dec.decode(plain));
}

export async function vaultStatus() {
  const { vault, vaultOn } = await chrome.storage.local.get(["vault", "vaultOn"]);
  const unlocked = !!(await sessionKey());
  return { on: vaultOn === true, hasPin: !!vault, unlocked };
}

export async function setVaultOn(on) {
  await chrome.storage.local.set({ vaultOn: !!on });
  if (!on) await chrome.storage.session.remove("vaultKey");
}

/** First time: choose a PIN (6+ characters). Starts with no logins. */
export async function createVault(pin) {
  if (typeof pin !== "string" || pin.length < 6) throw new Error("Use a PIN of at least 6 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  const box = await seal(key, []);
  await chrome.storage.local.set({ vault: { v: 1, salt: b64(salt), ...box } });
  await chrome.storage.session.set({ vaultKey: b64(await crypto.subtle.exportKey("raw", key)) });
}

export async function unlockVault(pin) {
  const { vault } = await chrome.storage.local.get("vault");
  if (!vault) throw new Error("Set a PIN first.");
  const key = await deriveKey(String(pin), unb64(vault.salt));
  try {
    await open(key, vault);
  } catch {
    throw new Error("Wrong PIN.");
  }
  await chrome.storage.session.set({ vaultKey: b64(await crypto.subtle.exportKey("raw", key)) });
}

export const lockVault = () => chrome.storage.session.remove("vaultKey");

async function readAll() {
  const { vault } = await chrome.storage.local.get("vault");
  const key = await sessionKey();
  if (!vault || !key) throw new Error("Unlock your saved logins first (extension Options).");
  return { key, vault, logins: await open(key, vault) };
}

/** Sites and usernames only (never the passwords), for the Options page. */
export async function listLogins() {
  const { logins } = await readAll();
  return logins.map((l) => ({ origin: l.origin, username: l.username, added: l.added }));
}

export async function saveLogin(url, username, password) {
  const origin = loginOrigin(url);
  if (!origin) throw new Error("Use the sign-in page's https:// address (for example https://bank.wd5.myworkdayjobs.com).");
  if (!username || !password) throw new Error("Add the email / username and the password.");
  const { key, vault, logins } = await readAll();
  const rest = logins.filter((l) => !(l.origin === origin && l.username === username));
  const box = await seal(key, [...rest, { origin, username: String(username).slice(0, 200), password: String(password).slice(0, 500), added: new Date().toISOString() }]);
  await chrome.storage.local.set({ vault: { ...vault, ...box } });
  return origin;
}

export async function deleteLogin(origin, username) {
  const { key, vault, logins } = await readAll();
  const box = await seal(key, logins.filter((l) => !(l.origin === origin && l.username === username)));
  await chrome.storage.local.set({ vault: { ...vault, ...box } });
}

export async function deleteVault() {
  await chrome.storage.local.remove(["vault", "vaultOn"]);
  await chrome.storage.session.remove("vaultKey");
}

/**
 * The login for this exact page origin, if saved logins are on and unlocked. Background worker only.
 * Returns { username, password } | { why }.
 */
export async function loginFor(pageUrl) {
  const st = await vaultStatus();
  if (!st.on || !st.hasPin) return { why: "off" };
  if (!st.unlocked) return { why: "locked" };
  const origin = loginOrigin(pageUrl);
  if (!origin) return { why: "none" };
  const { logins } = await readAll();
  const hit = logins.filter((l) => l.origin === origin);
  if (hit.length !== 1) return { why: hit.length ? "several" : "none" };
  return { username: hit[0].username, password: hit[0].password };
}
