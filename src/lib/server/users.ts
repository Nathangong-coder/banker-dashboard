import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "./http";
import { appUrl, db } from "./accounts";

/**
 * Coverage accounts (owner, 2026-10-25): one user per Google account (`sub`), signed in with "Sign in with Google".
 * The session is an HttpOnly cookie holding a random token; Redis keeps only its sha256 (`sess:<hash>` → user id),
 * expiring after 30 days of not being used. The user's dashboard data lives in lib/server/userData.ts; their
 * automatic-sending account (acct:<id>, lib/server/accounts.ts) is linked by `accountId`.
 */

export interface User {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  createdAt: string;
  lastSignInAt?: string;
  /** The server account (automatic sending, captures, connector) this user's browsers share. */
  accountId?: string;
}

export const SESSION_COOKIE = "coverage_session";
export const SIGNIN_COOKIE = "coverage_signin";
const SESSION_DAYS = 30;
const USER = (id: string) => `user:${id}`;
const SESS = (hash: string) => `sess:${hash}`;
const USER_SESSIONS = (id: string) => `usersess:${id}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function loadUser(id: string) {
  return (await db().get<User>(USER(id))) ?? null;
}
export async function saveUser(u: User) {
  await db().set(USER(u.id), u);
}

export function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

const secure = (req: Request) => new URL(req.url).protocol === "https:" || process.env.VERCEL === "1";
export function cookie(req: Request, name: string, value: string, maxAge: number, path = "/") {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? "; Secure" : ""}`;
}

/** A new session for the user: returns the Set-Cookie header value. */
export async function createSession(req: Request, uid: string) {
  const token = randomBytes(32).toString("base64url");
  const hash = sha(token);
  await db().set(SESS(hash), { uid, at: new Date().toISOString() }, { ex: SESSION_DAYS * 86400 });
  await db().sadd(USER_SESSIONS(uid), hash);
  return cookie(req, SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

/** Sign out this browser: deletes its session. Returns the Set-Cookie header that clears the cookie. */
export async function endSession(req: Request) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const hash = sha(token);
    const s = await db().get<{ uid: string }>(SESS(hash));
    await db().del(SESS(hash));
    if (s) await db().srem(USER_SESSIONS(s.uid), hash);
  }
  return cookie(req, SESSION_COOKIE, "", 0);
}

/** Sign out everywhere (account deletion). */
export async function endAllSessions(uid: string) {
  const hashes = ((await db().smembers(USER_SESSIONS(uid))) ?? []) as string[];
  if (hashes.length) await db().del(...hashes.map(SESS));
  await db().del(USER_SESSIONS(uid));
}

/**
 * Cookies ride along on cross-site requests in some cases (top-level GET navigations with SameSite=Lax), so anything
 * that changes data also checks the Origin header against this deployment.
 */
function sameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers, server-to-server: no cookie anyway
  // The host the browser asked for (Vercel passes it on as x-forwarded-host); req.url can name another one locally.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host || origin === appUrl(req);
  } catch {
    return false;
  }
}

/** The signed-in user, or null. Slides the session's expiry forward when it's past half its life. */
export async function currentUser(req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length < 32) return null;
  if (!sameOrigin(req)) throw new HttpError(403, "This request came from another site.");
  const hash = sha(token);
  const s = await db().get<{ uid: string; at?: string }>(SESS(hash));
  if (!s) return null;
  // Slide the expiry forward at most once a day, from the date stored in the session (no TTL read per request:
  // every request was costing an extra Redis command, owner 2026-10-26 hit the Upstash plan limit).
  if (!s.at || Date.now() - Date.parse(s.at) > 86_400_000) await db().set(SESS(hash), { uid: s.uid, at: new Date().toISOString() }, { ex: SESSION_DAYS * 86400 });
  return loadUser(s.uid);
}

export async function requireUser(req: Request) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, "Sign in to Coverage first.");
  return u;
}

/** Find or create the user for a Google sign-in. */
export async function upsertGoogleUser(p: { sub: string; email: string; name?: string; picture?: string }) {
  const id = `g:${p.sub}`;
  const now = new Date().toISOString();
  const existing = await loadUser(id);
  const u: User = existing
    ? { ...existing, email: p.email, name: p.name ?? existing.name, picture: p.picture ?? existing.picture, lastSignInAt: now }
    : { id, email: p.email, name: p.name, picture: p.picture, createdAt: now, lastSignInAt: now };
  await saveUser(u);
  return u;
}

export async function deleteUserRecord(uid: string) {
  await endAllSessions(uid);
  await db().del(USER(uid));
}

export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name ?? null, picture: u.picture ?? null });
