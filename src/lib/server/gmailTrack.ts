import "server-only";
import { TRACK, db, type Account, type TrackedPerson } from "./accounts";
import { accessToken, gmail } from "./google";
import { analyzePerson, parseAddrs, personQuery, stripQuotedText, type MailMsg, type TrackResult } from "../replyTracking";

/**
 * The server's hourly Gmail read (owner, 2026-10-22): for each person the dashboard tracks, every thread to or from
 * them → lib/replyTracking.ts decides when you last emailed them (the thank-you), whether / when they replied, new
 * addresses of theirs, and intros. Needs the optional read-only Gmail scope (`account.google.read`).
 * Stored per person in `track:<id>`: the result (dates, ids, addresses) plus the text of their newest replies (≤1,500
 * characters each) until the dashboard has read them with AI (`ackTexts`), and at most 14 days.
 */

export interface TrackState {
  result: TrackResult;
  checkedAt: string;
  /** Their replies' new text (quoted history cut), waiting for the dashboard's AI read. messageId → text. */
  texts?: Record<string, { at: string; text: string }>;
  /** Reply ids whose text was already handed over (not fetched again). */
  seen?: string[];
}

const HOT_EVERY = 55 * 60_000;
const COLD_EVERY = 6 * 3600_000;
const TEXT_DAYS = 14;

type RawMsg = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate: string; payload?: RawPart & { headers?: { name: string; value: string }[] } };
type RawPart = { mimeType?: string; body?: { data?: string }; parts?: RawPart[] };

const header = (m: RawMsg, n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
const decode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function toMsg(m: RawMsg): MailMsg {
  return {
    id: m.id,
    threadId: m.threadId,
    at: Number(m.internalDate),
    labels: m.labelIds ?? [],
    from: parseAddrs(header(m, "from"))[0] ?? { name: "", email: "" },
    to: parseAddrs(header(m, "to")),
    cc: parseAddrs(header(m, "cc")),
    bcc: parseAddrs(header(m, "bcc")),
    subject: header(m, "subject") ?? "",
    snippet: unescape(m.snippet ?? ""),
  };
}

function plainText(p: RawPart | undefined): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return decode(p.body.data);
  for (const c of p.parts ?? []) {
    const t = plainText(c);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data)
    return unescape(
      decode(p.body.data)
        .replace(/<(br|\/div|\/p)[^>]*>/gi, "\n")
        .replace(/<blockquote[\s\S]*$/i, "")
        .replace(/<[^>]+>/g, ""),
    );
  return "";
}

const META = ["From", "To", "Cc", "Bcc", "Subject"].map((h) => `metadataHeaders=${h}`).join("&");

/** Every message in the threads that involve this person (newest 15 threads since `since`). */
async function messagesFor(access: string, p: TrackedPerson): Promise<MailMsg[]> {
  const q = personQuery(p.emails, p.since);
  const list = await gmail<{ threads?: { id: string }[] }>(access, `/threads?q=${encodeURIComponent(q)}&maxResults=15`);
  const threads = await Promise.all(
    (list.threads ?? []).map((t) => gmail<{ messages?: RawMsg[] }>(access, `/threads/${t.id}?format=metadata&${META}`)),
  );
  return threads.flatMap((t) => (t.messages ?? []).filter((m) => !m.labelIds?.includes("DRAFT")).map(toMsg));
}

/** Check the people who are due (hot hourly, the rest every 6 h), within `budgetMs`. Returns how many were checked. */
export async function trackAccount(a: Account, budgetMs = 120_000) {
  if (!a.google?.read || !a.track?.length) return 0;
  const start = Date.now();
  const states = ((await db().hgetall<Record<string, TrackState>>(TRACK(a.id))) ?? {}) as Record<string, TrackState>;
  const due = a.track
    .filter((p) => {
      const at = states[p.contactId]?.checkedAt;
      return !at || Date.now() - Date.parse(at) > (p.hot ? HOT_EVERY : COLD_EVERY);
    })
    .sort((x, y) => Number(!!y.hot) - Number(!!x.hot) || (states[x.contactId]?.checkedAt ?? "").localeCompare(states[y.contactId]?.checkedAt ?? ""));
  if (!due.length) return 0;
  const access = await accessToken(a);
  const me = [a.google.email];
  let n = 0;
  for (const p of due) {
    if (Date.now() - start > budgetMs) break;
    try {
      const msgs = await messagesFor(access, p);
      const result = analyzePerson(p, msgs, me);
      const prev = states[p.contactId];
      const cutoff = Date.now() - TEXT_DAYS * 86_400_000;
      const texts = Object.fromEntries(Object.entries(prev?.texts ?? {}).filter(([, t]) => Date.parse(t.at) > cutoff));
      const seen = new Set(prev?.seen ?? []);
      // The text of new replies from the last 2 weeks, for the dashboard's AI read (referrals, promises, a "no").
      for (const r of result.replies) {
        if (seen.has(r.id) || texts[r.id] || Date.parse(r.at) < cutoff) continue;
        const full = await gmail<RawMsg>(access, `/messages/${r.id}?format=full`);
        texts[r.id] = { at: r.at, text: stripQuotedText(plainText(full.payload)).slice(0, 1500) };
      }
      const state: TrackState = { result, checkedAt: new Date().toISOString(), texts, seen: [...seen].slice(-50) };
      await db().hset(TRACK(a.id), { [p.contactId]: state });
      states[p.contactId] = state;
      n++;
    } catch (e) {
      // A revoked token stops the run; anything else skips this person until the next hour.
      if (/401|revoked/i.test((e as Error).message)) throw e;
    }
  }
  return n;
}

/** Everything tracked for this account (for the sync response). */
export async function trackStates(id: string) {
  return ((await db().hgetall<Record<string, TrackState>>(TRACK(id))) ?? {}) as Record<string, TrackState>;
}

/** The dashboard has read these replies: drop their text (only the ids stay, so they aren't fetched again). */
export async function ackTexts(id: string, ack: { contactId: string; ids: string[] }[]) {
  if (!ack.length) return;
  const states = await trackStates(id);
  for (const { contactId, ids } of ack) {
    const s = states[contactId];
    if (!s?.texts) continue;
    for (const i of ids) delete s.texts[i];
    s.seen = [...new Set([...(s.seen ?? []), ...ids])].slice(-50);
    await db().hset(TRACK(id), { [contactId]: s });
  }
}

/** Drop people the dashboard no longer tracks. */
export async function pruneTracked(id: string, keep: Set<string>) {
  const ids = ((await db().hkeys(TRACK(id))) ?? []) as string[];
  const gone = ids.filter((x) => !keep.has(x));
  if (gone.length) await db().hdel(TRACK(id), ...gone);
}
