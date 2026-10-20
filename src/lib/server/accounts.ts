import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { HttpError } from "./http";
import type { DigestItem } from "../digestFormat";
import type { CaptureItem } from "../infoSessions";

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
  /** `calendar`: read-only Calendar access was granted too (today's calls for the 9 PM text). */
  google?: { refresh: string; email: string; connectedAt: string; calendar?: boolean };
  whatsapp?: { phone: string; apiKey: string };
  /** Local day (YYYY-MM-DD in `tz`) → what the 9 PM text says. */
  digests: Record<string, { items: DigestItem[]; queued: number }>;
  /** People today's calendar events are matched against (name + email only). */
  people?: CalPerson[];
  /**
   * Phone capture (info sessions): sha256 of a random capture token (auth for /capture and the share target) and the
   * same token sealed, so the server can put the link into reminder texts. Separate from the account token: it only
   * lets a phone drop items into the inbox and list info sessions.
   */
  capture?: { hash: string; sealed: string };
  /** Your own Twilio number for texting photos / names in: sid + token sealed; only `myPhone` is accepted as sender. */
  twilio?: { sid: string; token: string; number: string; myPhone: string };
}

export interface CalPerson {
  contactId: string;
  name: string;
  email?: string;
  /** Last email you sent them, so a call that was already thanked isn't listed. */
  thankedAt?: string;
  /** For the "after today's calls" lines: the LinkedIn link (else a search for name + bank). */
  bank?: string;
  linkedin?: string;
  /** Your latest logged conversation with them (Activity log): no "log how it went" once today's is logged. */
  loggedAt?: string;
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
  const a = await loadAccount(id);
  const itemIds = ((await db().hkeys(INBOX(id))) ?? []) as string[];
  if (itemIds.length) await db().del(...itemIds.map((i) => CAPIMG(id, i)));
  if (a?.twilio && (await db().get<string>(TWNUM(a.twilio.number))) === id) await db().del(TWNUM(a.twilio.number));
  await db().del(KEY(id), SENDS(id), DIGEST_DAY(id), DIGEST_ERR(id), INBOX(id));
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

// ---- Phone capture (info sessions): capture token, inbox, Twilio number index ----

export const INBOX = (id: string) => `inbox:${id}`;
export const CAPIMG = (id: string, itemId: string) => `capimg:${id}:${itemId}`;
export const TWNUM = (number: string) => `twnum:${number}`;
/** Items wait this long for the dashboard to pull them. */
export const INBOX_TTL = 14 * 86400;
export const INBOX_MAX = 200;

/**
 * The account's capture token: made on first use, or replaced (`rotate`, which breaks the old link). Saves the account
 * only when it changes. Returns the plain token.
 */
export async function ensureCaptureToken(a: Account, rotate = false) {
  if (a.capture && !rotate) return unseal(a.capture.sealed);
  const token = randomBytes(24).toString("base64url");
  a.capture = { hash: sha(token), sealed: seal(token) };
  await saveAccount(a);
  return token;
}

/** The phone page link with its key (in the hash, so it never reaches server logs or the Referer). */
export async function captureUrl(a: Account, req?: Request, rotate = false) {
  return `${appUrl(req)}/capture#k=${a.id}.${await ensureCaptureToken(a, rotate)}`;
}

/** The account for a capture key "<id>.<captureToken>" (from the phone page's header or the share cookie). */
export async function captureAccount(raw: string) {
  const m = raw.trim().match(/^([^.\s]+)\.(\S+)$/);
  const bad = new HttpError(401, "This capture link is no longer valid. Open the newest link from your dashboard (Follow-ups → Reminders → Info sessions).");
  if (!m || !ID.test(m[1]) || m[2].length < 20) throw bad;
  const a = await loadAccount(m[1]);
  if (!a?.capture) throw bad;
  const x = Buffer.from(a.capture.hash, "hex");
  const y = Buffer.from(sha(m[2]), "hex");
  if (x.length !== y.length || !timingSafeEqual(x, y)) throw bad;
  return a;
}

/** `Authorization: Bearer <id>.<captureToken>`. */
export function authCapture(req: Request) {
  return captureAccount((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
}

/** Put one item in the inbox (image in its own key). Both expire after 14 days; each write resets the hash's TTL. */
export async function addInboxItem(id: string, item: CaptureItem) {
  const r = db();
  if ((await r.hlen(INBOX(id))) >= INBOX_MAX) throw new HttpError(429, `Your capture inbox is full (${INBOX_MAX} items). Open Coverage → Info sessions on your computer to pull them in, then try again.`);
  const { image, ...meta } = item;
  if (image) await r.set(CAPIMG(id, item.id), image, { ex: INBOX_TTL });
  await r.hset(INBOX(id), { [item.id]: { ...meta, ...(image ? { hasImage: true } : {}) } });
  await r.expire(INBOX(id), INBOX_TTL);
}

export const newItemId = () => `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;

/**
 * Drop acknowledged items, then return the oldest waiting ones with their images: at most `max`, and about 3.5 MB of
 * images per call (Vercel caps responses at 4.5 MB), but always at least one. `more` = call again (after acking).
 */
export async function readInbox(id: string, ack: string[], max = 30) {
  const r = db();
  if (ack.length) {
    await r.hdel(INBOX(id), ...ack);
    await r.del(...ack.map((i) => CAPIMG(id, i)));
  }
  const all = Object.values(((await r.hgetall<Record<string, CaptureItem & { hasImage?: boolean }>>(INBOX(id))) ?? {}) as Record<string, CaptureItem & { hasImage?: boolean }>);
  all.sort((p, q) => p.at.localeCompare(q.at) || p.id.localeCompare(q.id));
  const items: CaptureItem[] = [];
  let bytes = 0;
  for (const it of all.slice(0, max)) {
    const { hasImage, ...item } = it;
    if (hasImage) {
      const image = await r.get<string>(CAPIMG(id, it.id));
      if (image) {
        if (items.length && bytes + image.length > 3_500_000) break;
        bytes += image.length;
        item.image = image;
      }
    }
    items.push(item);
  }
  return { items, more: all.length > items.length };
}

/** The deployment's public URL, for Google's redirect and QStash callbacks. */
export function appUrl(req?: Request) {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && prod) return `https://${prod}`;
  if (req) return new URL(req.url).origin;
  if (prod) return `https://${prod}`;
  throw new HttpError(500, "Can't tell this deployment's URL.");
}
