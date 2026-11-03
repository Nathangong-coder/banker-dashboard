import "server-only";
import { TRACK, db, type Account, type TrackedPerson } from "./accounts";
import { accessToken, gmail } from "./google";
import { HttpError } from "./http";
import { touchedPeople, type ChangedMsg } from "../gmailHistory";
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

/**
 * Where the incremental read left off (`ghist:<id>`): Gmail's history id, when this cursor started (anyone not checked
 * since gets one full check), the last run, and people a run touched but had no time for.
 */
interface Cursor {
  h: string;
  base: string;
  at: string;
  pending?: string[];
  /** The mailbox the history id belongs to (a reconnect to another Google account starts over). */
  email?: string;
}
const GHIST = (id: string) => `ghist:${id}`;
/** Everyone is still re-read in full weekly, in case a change slipped past the history list. */
const SAFETY_EVERY = 7 * 86_400_000;
/** More new messages than this since the last run: the per-person read is cheaper. */
const MAX_CHANGED = 150;

type HistoryPage = {
  history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
  historyId: string;
  nextPageToken?: string;
};

/** Messages added since `start` (drafts and spam left out), or null when Gmail no longer has that history (about a week). */
async function changesSince(access: string, start: string) {
  const msgs = new Map<string, { id: string; threadId: string }>();
  let historyId = start;
  let page: string | undefined;
  try {
    for (let i = 0; i < 10; i++) {
      const r = await gmail<HistoryPage>(access, `/history?startHistoryId=${start}&historyTypes=messageAdded&maxResults=500${page ? `&pageToken=${page}` : ""}`);
      historyId = r.historyId;
      for (const h of r.history ?? [])
        for (const { message: m } of h.messagesAdded ?? []) if (!m.labelIds?.some((l) => l === "DRAFT" || l === "SPAM")) msgs.set(m.id, m);
      if (!r.nextPageToken) break;
      page = r.nextPageToken;
    }
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
  return { historyId, msgs: [...msgs.values()] };
}

/** From / To / Cc / Bcc of each new message (4 at a time). */
async function addressesOf(access: string, msgs: { id: string; threadId: string }[]): Promise<ChangedMsg[]> {
  const out: ChangedMsg[] = [];
  let i = 0;
  const worker = async () => {
    while (i < msgs.length) {
      const m = msgs[i++];
      try {
        const raw = await gmail<RawMsg>(access, `/messages/${m.id}?format=metadata&${META}`);
        out.push({ id: m.id, threadId: m.threadId, addrs: ["from", "to", "cc", "bcc"].flatMap((h) => parseAddrs(header(raw, h)).map((x) => x.email.toLowerCase())) });
      } catch (e) {
        // Deleted since (404): nothing to read. Anything else: it still touches its thread.
        if (!(e instanceof HttpError && e.status === 404)) out.push({ id: m.id, threadId: m.threadId, addrs: [] });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

/**
 * Check whoever new mail could have changed (owner, 2026-11-02), within `budgetMs`; returns how many were checked.
 * With a saved history id, a run where nothing happened is one Gmail call (it was one search per tracked person).
 * The first run, or one after Gmail dropped the history, reads people the old way (hot hourly, the rest every 6 h).
 * `minGapMs`: skip when the last run was more recent (the dashboard's sync calls this every few minutes).
 */
export async function trackAccount(a: Account, budgetMs = 120_000, opts: { minGapMs?: number } = {}) {
  if (!a.google?.read || !a.track?.length) return 0;
  const start = Date.now();
  const saved = await db().get<Cursor>(GHIST(a.id));
  const cur = saved?.email === a.google.email ? saved : null;
  if (opts.minGapMs && cur?.at && start - Date.parse(cur.at) < opts.minGapMs) return 0;
  const access = await accessToken(a);
  const me = [a.google.email];
  const states = ((await db().hgetall<Record<string, TrackState>>(TRACK(a.id))) ?? {}) as Record<string, TrackState>;
  const changes = cur?.h ? await changesSince(access, cur.h) : null;
  let next: Cursor;
  let due: TrackedPerson[];
  if (cur && changes && changes.msgs.length <= MAX_CHANGED) {
    next = { ...cur, h: changes.historyId, at: new Date().toISOString() };
    const want = new Set(cur.pending ?? []);
    if (changes.msgs.length) {
      const people = a.track.map((p) => ({ contactId: p.contactId, emails: p.emails, threadIds: states[p.contactId]?.result.threadIds }));
      for (const id of touchedPeople(people, await addressesOf(access, changes.msgs), me)) want.add(id);
    }
    due = a.track.filter((p) => {
      const at = states[p.contactId]?.checkedAt;
      return want.has(p.contactId) || !at || at < cur.base || start - Date.parse(at) > SAFETY_EVERY;
    });
  } else {
    // No cursor yet, or the history is gone: note where "now" is first, so nothing after it is missed.
    const now = new Date().toISOString();
    next = { h: (await gmail<{ historyId: string }>(access, "/profile")).historyId, base: now, at: now, email: a.google.email };
    due = a.track.filter((p) => {
      const at = states[p.contactId]?.checkedAt;
      return !at || start - Date.parse(at) > (p.hot ? HOT_EVERY : COLD_EVERY);
    });
  }
  due.sort((x, y) => Number(!!y.hot) - Number(!!x.hot) || (states[x.contactId]?.checkedAt ?? "").localeCompare(states[y.contactId]?.checkedAt ?? ""));
  let n = 0;
  const left: string[] = [];
  for (const p of due) {
    if (Date.now() - start > budgetMs) {
      left.push(p.contactId);
      continue;
    }
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
      // A revoked token stops the run; anything else is tried again next run.
      if (/401|revoked/i.test((e as Error).message)) throw e;
      left.push(p.contactId);
    }
  }
  next.pending = left.length ? left.slice(0, 500) : undefined;
  await db().set(GHIST(a.id), next);
  return n;
}

/** Forget where the incremental read was (Google disconnected or account deleted). */
export const dropCursor = (id: string) => db().del(GHIST(id));

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
