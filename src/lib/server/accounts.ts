import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { HttpError } from "./http";
import type { DigestItem } from "../digestFormat";

/**
 * Server-side state for automatic sending (Upstash Redis). One record per browser "account": a random id + secret
 * token the browser made (only a hash of the token is kept). Secrets the server needs while the user is away (the
 * Google refresh token, the CallMeBot key) are AES-256-GCM encrypted with SERVER_ENC_KEY. Nothing else of the user's
 * data is stored: digests are names / emails / labels, sends are draft ids + times.
 */

export interface QueuedSend {
  draftId: string;
  contactId: string;
  name: string;
  step: number;
  sendAt: string;
  status: "queued" | "sent" | "failed" | "missing";
  /** Gmail ids of the sent message (for the dashboard to thread the next follow-up). */
  messageId?: string;
  threadId?: string;
  doneAt?: string;
  error?: string;
}

export interface Account {
  id: string;
  tokenHash: string;
  createdAt: string;
  tz: string;
  google?: { refresh: string; email: string; connectedAt: string };
  whatsapp?: { phone: string; apiKey: string };
  /** Local day (YYYY-MM-DD in `tz`) → what the 9am text says. */
  digests: Record<string, { items: DigestItem[]; queued: number }>;
}

let redis: Redis | null = null;
export function db() {
  if (!redis) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new HttpError(503, "The server isn't set up for automatic sending (no storage connected).");
    redis = new Redis({ url, token });
  }
  return redis;
}

const KEY = (id: string) => `acct:${id}`;
const ACCOUNTS = "accts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function encKey() {
  const k = Buffer.from(process.env.SERVER_ENC_KEY ?? "", "base64");
  if (k.length !== 32) throw new HttpError(503, "The server isn't set up for automatic sending (SERVER_ENC_KEY).");
  return k;
}
export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}
export function unseal(sealed: string) {
  const [iv, tag, body] = sealed.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

export async function loadAccount(id: string) {
  return (await db().get<Account>(KEY(id))) ?? null;
}
export async function saveAccount(a: Account) {
  await db().set(KEY(a.id), a);
  await db().sadd(ACCOUNTS, a.id);
}
export async function deleteAccount(id: string) {
  await db().del(KEY(id), SENDS(id), DIGEST_DAY(id), DIGEST_ERR(id));
  await db().srem(ACCOUNTS, id);
}

// Sends and the digest marker live in their own keys: the browser's sync and QStash's jobs write at the same time,
// and a whole-record read-modify-write would let one undo the other.
const SENDS = (id: string) => `sends:${id}`;
export const DIGEST_DAY = (id: string) => `digestday:${id}`;
export const DIGEST_ERR = (id: string) => `digesterr:${id}`;

export async function getSends(id: string) {
  return ((await db().hgetall<Record<string, QueuedSend>>(SENDS(id))) ?? {}) as Record<string, QueuedSend>;
}
export async function getSend(id: string, draftId: string) {
  return (await db().hget<QueuedSend>(SENDS(id), draftId)) ?? null;
}
export async function putSend(id: string, s: QueuedSend) {
  await db().hset(SENDS(id), { [s.draftId]: s });
}
export async function dropSends(id: string, draftIds: string[]) {
  if (draftIds.length) await db().hdel(SENDS(id), ...draftIds);
}
export async function accountIds() {
  return (await db().smembers(ACCOUNTS)) as string[];
}

const ID = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The caller's account from `Authorization: Bearer <id>.<token>`. Creates it on first use (`create`), so the
 * browser never has to register separately. A wrong token for an existing id is a 401.
 */
export async function authAccount(req: Request, opts: { create?: boolean } = {}) {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer ([^.\s]+)\.(\S+)$/);
  if (!m || !ID.test(m[1]) || m[2].length < 32) throw new HttpError(401, "Missing or malformed server credentials. Reconnect automatic sending on Follow-ups.");
  const [, id, token] = m;
  const existing = await loadAccount(id);
  if (existing) {
    const a = Buffer.from(existing.tokenHash, "hex");
    const b = Buffer.from(sha(token), "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "These server credentials don't match. Reconnect automatic sending on Follow-ups.");
    return existing;
  }
  if (!opts.create) throw new HttpError(404, "No server account yet. Connect automatic sending on Follow-ups first.");
  const fresh: Account = { id, tokenHash: sha(token), createdAt: new Date().toISOString(), tz: "America/Los_Angeles", digests: {} };
  await saveAccount(fresh);
  return fresh;
}

/** YYYY-MM-DD and hour in a time zone. */
export function localNow(tz: string, at = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(at));
  return { day, hour };
}

/** The deployment's public URL, for Google's redirect and QStash callbacks. */
export function appUrl(req?: Request) {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && prod) return `https://${prod}`;
  if (req) return new URL(req.url).origin;
  if (prod) return `https://${prod}`;
  throw new HttpError(500, "Can't tell this deployment's URL.");
}
