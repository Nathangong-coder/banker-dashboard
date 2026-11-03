import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { db, type Account } from "./accounts";
import { accessToken, gmail } from "./google";

/**
 * Gmail push (owner, 2026-11-02): Gmail tells us when a mailbox changes (users.watch → Google Pub/Sub → a push
 * subscription that POSTs to /api/gmail/push), so replies are read within a minute instead of at the next hourly
 * tick. Off unless GMAIL_PUSH_TOPIC ("projects/<project>/topics/<topic>") and GMAIL_PUSH_SECRET are set; the hourly
 * tick (incremental history read) stays as the safety net either way.
 *
 * Redis: `gwatch:<id>` = when this account's watch runs out (Gmail stops after 7 days unless renewed), and
 * `gmailacct:<sha256(email)>` → account id, so a notification (which only names the mailbox) finds its account.
 */

const WATCH = (id: string) => `gwatch:${id}`;
const BY_EMAIL = (email: string) => `gmailacct:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
/** Renew when less than this is left (the tick runs hourly, so a day is plenty). */
const RENEW_BEFORE = 24 * 3600_000;

export const pushOn = () => !!process.env.GMAIL_PUSH_TOPIC && !!process.env.GMAIL_PUSH_SECRET;

/** Start or renew this account's Gmail watch when it's missing or about to run out. Called from the hourly tick. */
export async function ensureWatch(a: Account) {
  if (!pushOn() || !a.google?.read) return false;
  const exp = await db().get<number>(WATCH(a.id));
  if (exp && exp - Date.now() > RENEW_BEFORE) return false;
  const r = await gmail<{ historyId: string; expiration: string }>(await accessToken(a), "/watch", {
    method: "POST",
    // Inbox + sent: replies to you and what you send (thank-yous). Promotions etc. still carry INBOX, which is fine:
    // a change nobody tracked costs one history call.
    body: JSON.stringify({ topicName: process.env.GMAIL_PUSH_TOPIC, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "include" }),
  });
  const until = Number(r.expiration);
  const ttl = Math.max(60, Math.ceil((until - Date.now()) / 1000) + 3600);
  await Promise.all([db().set(WATCH(a.id), until, { ex: ttl }), db().set(BY_EMAIL(a.google.email), a.id, { ex: ttl })]);
  return true;
}

/** The account a notification is about (null for a mailbox we don't watch). */
export const accountForMailbox = (email: string) => db().get<string>(BY_EMAIL(email));

/** The push subscription's URL carries ?k=<GMAIL_PUSH_SECRET>; compare in constant time. */
export function pushSecretOk(k: string | null) {
  const want = process.env.GMAIL_PUSH_SECRET ?? "";
  if (!want || !k) return false;
  const a = Buffer.from(k);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

