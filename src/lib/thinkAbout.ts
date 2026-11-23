import type { Contact } from "./types";
import { DAY, latestIso } from "./util";
import { chatDayKey, chatRecords } from "./chatEvidence";
import { lastExchange } from "./mailLedger";

/**
 * Things to think about (owner, 2026-11-21): replies you haven't answered, people who replied and then went quiet
 * (Colin Bryant at Deutsche Bank: re-follow up sooner than the usual week), and dated reminders ("reach out in
 * January"), found in replies and chat notes or added by hand. Pure; app/think shows it and the 9 PM text uses it.
 */

/** A reminder you added, or your decision on one Coverage found (`coverage.reminders`, one sync doc each). */
export interface Reminder {
  id: string;
  /** Due day, "YYYY-MM-DD" (local). */
  due: string;
  note: string;
  bank?: string;
  contactId?: string;
  createdAt: string;
  /** Done or dismissed (ISO). */
  done?: string;
  /** "manual" = added by you; otherwise it overrides a found one with the same id. */
  source?: "manual" | "found";
}

export interface ReminderRow {
  id: string;
  due: string;
  note: string;
  bank?: string;
  contactId?: string;
  name?: string;
  /** The sentence it came from. */
  quote?: string;
  /** Where Coverage found it: "their reply", "your chat notes 11/3", "Comment column"… */
  from: string;
  found: boolean;
  done?: string;
}

/* ---------------- "reach out in January" ---------------- */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
/** Something about getting back in touch, in the same sentence as the time. */
const CUE =
  /\b(reach(ing)? (back )?out|follow(ing)?[- ]up|touch(ing)? base|circle back|check(ing)? (back|in)|ping (me|him|her|them)|reconnect|(get|be|keep) (back )?in touch|connect (again|then|later)|email (me|him|her|them)|shoot (me|him|her|them)|send (me|him|her|them) (a|an) (note|email|message)|try (me|him|her|them|again)|revisit|hop on (a|another) call|chat (again|then|more|later)|talk (again|then|more|later)|let'?s (talk|chat|connect)|reach back)\b/i;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The next date on/after `from` with this month/day (this year, else next year). */
function nextMonthDay(from: Date, month: number, day: number) {
  const y = from.getFullYear();
  const thisYear = new Date(y, month, day);
  // The month we're in counts as now ("reach out in November" said in November = start now).
  if (month === from.getMonth()) return new Date(Math.max(thisYear.getTime(), new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()));
  return thisYear.getTime() >= new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime() ? thisYear : new Date(y + 1, month, day);
}
function thanksgivingMonday(year: number) {
  const nov1 = new Date(year, 10, 1);
  const firstThu = 1 + ((4 - nov1.getDay() + 7) % 7);
  return new Date(year, 10, firstThu + 21 + 4);
}
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, few: 3, "a few": 3, couple: 2, "a couple": 2, "a couple of": 2, "couple of": 2 };

/** A time phrase in `sentence` → the day it means, relative to when it was said. Undefined = no time phrase. */
export function laterDate(sentence: string, said: Date): { due: string; phrase: string } | undefined {
  const s = sentence.toLowerCase();
  let m: RegExpMatchArray | null;
  // The phrase as written (same offsets: lowercasing ASCII keeps the length).
  const out = (d: Date, mm: RegExpMatchArray) => ({ due: ymd(d), phrase: sentence.substr(mm.index ?? 0, mm[0].length).trim() });
  if ((m = s.match(/\bafter (the )?(new year|holidays|holiday season|winter break|break)\b|\b(beginning|start) of (the )?(next |new )?year\b|\bnew year\b/))) return out(nextMonthDay(said, 0, 5), m);
  if ((m = s.match(/\bafter thanksgiving\b/))) {
    let d = thanksgivingMonday(said.getFullYear());
    if (d < said) d = thanksgivingMonday(said.getFullYear() + 1);
    return out(d, m);
  }
  if ((m = s.match(new RegExp(`\\b(early|mid|late|end of|beginning of|start of)?[- ]?${MONTH_RE}\\b(?:,? (20\\d{2}))?`)))) {
    const word = m[2];
    // "may" is also a verb: only a month when "in / early / by…" is right before it.
    if (word === "may" && !new RegExp(`\\b(in|by|early|mid|late|of|until|around|before|after) (early |mid |late )?may\\b`).test(s)) return undefined;
    const month = MONTHS.indexOf(word.slice(0, 3));
    const day = m[1] === "mid" ? 15 : m[1] === "late" || m[1] === "end of" ? 22 : month === 0 ? 5 : 1;
    let d = nextMonthDay(said, month, day);
    if (m[3]) d = new Date(Number(m[3]), month, day);
    return out(d, m);
  }
  if ((m = s.match(/\b(next|in the|this coming|in) (spring|summer|fall|autumn)\b/))) {
    const month = { spring: 2, summer: 5, fall: 8, autumn: 8 }[m[2] as "spring"];
    return out(nextMonthDay(said, month, 1), m);
  }
  if ((m = s.match(/\bend of (the )?year\b/))) return out(nextMonthDay(said, 11, 1), m);
  if ((m = s.match(/\bnext week\b/))) return out(new Date(said.getTime() + 7 * DAY), m);
  if ((m = s.match(/\bnext month\b/))) return out(new Date(said.getFullYear(), said.getMonth() + 1, 1), m);
  if ((m = s.match(/\bin (a|an|one|two|three|four|a few|few|a couple of|a couple|couple of) (week|weeks|month|months)\b/))) {
    const n = NUM[m[1]] ?? 1;
    const d = m[2].startsWith("week") ? new Date(said.getTime() + n * 7 * DAY) : new Date(said.getFullYear(), said.getMonth() + n, said.getDate());
    return out(d, m);
  }
  return undefined;
}

/** Every "get back in touch at <time>" sentence in a text. */
export function laterMentions(text: string, said: Date): { due: string; phrase: string; quote: string }[] {
  const out: { due: string; phrase: string; quote: string }[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.replace(/^[\s>•*-]+/, "").trim();
    if (sentence.length < 8 || sentence.length > 400 || !CUE.test(sentence)) continue;
    // The time that follows the reach-out words wins ("busy through December, so reach out in January" = January).
    const d = laterDate(sentence.slice(Math.max(0, sentence.search(CUE))), said) ?? laterDate(sentence, said);
    if (d) out.push({ ...d, quote: sentence });
  }
  return out;
}

/** "January" → "Reach out in January"; "after the new year" stays as written. */
export const reachNote = (phrase: string) => `Reach out ${/^(next|after|in|end|beginning|start|this)\b/i.test(phrase) ? "" : "in "}${phrase}`;

/** djb2, for stable ids of found reminders. */
function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const md = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

/**
 * Reminders: the ones you added, plus "reach out in <time>" found in their last reply, the AI's read of it, your chat
 * notes / grades and the Comment column. Your decision on a found one (done, a new date) is kept under its id.
 */
export function reminderRows(contacts: Contact[], mine: Record<string, Reminder> | undefined): ReminderRow[] {
  const rows = new Map<string, ReminderRow>();
  const add = (c: Contact, key: string, text: string, said: string | undefined, from: string) => {
    if (!text) return;
    const when = said ? new Date(said) : new Date();
    for (const x of laterMentions(text, when)) {
      const id = `auto:${c.id}:${key}:${hash(x.quote)}`;
      if (!rows.has(id)) rows.set(id, { id, due: x.due, note: reachNote(x.phrase), bank: c.bank, contactId: c.id, name: c.name, quote: x.quote, from, found: true });
    }
  };
  for (const c of contacts) {
    if (c.status === "ignored" && c.outcome?.kind !== "no_reply") continue;
    if (c.lastReply) {
      add(c, `reply:${c.lastReply.messageId}`, c.lastReply.text, c.lastReply.at, `their email ${md(c.lastReply.at)}`);
      if (c.lastReply.later) add(c, `later:${c.lastReply.messageId}`, `Reach out ${c.lastReply.later}.`, c.lastReply.at, `their email ${md(c.lastReply.at)}`);
    }
    for (const s of c.signals ?? []) add(c, `sig:${s.id}`, s.text, s.at, `their email ${md(s.at)}`);
    for (const ch of c.chats ?? []) {
      add(c, `chat:${ch.id}`, ch.notes ?? "", ch.at, `your chat notes ${md(ch.at)}`);
      const g = ch.grade;
      if (g) add(c, `grade:${ch.id}`, [...g.commitments, ...(g.theirAdvice ?? []), g.summary].join("\n"), ch.at, `the chat ${md(ch.at)}`);
    }
    add(c, "comment", c.comment, c.lastHeardAt ?? c.lastEmailedAt ?? c.sentAt, "the Comment column");
  }
  // Two sources saying the same thing about one person (their reply + the AI's read of it): keep one per person + day.
  const seen = new Set<string>();
  for (const [id, r] of [...rows]) {
    const k = `${r.contactId}|${r.due}`;
    if (seen.has(k)) rows.delete(id);
    else seen.add(k);
  }
  for (const [id, r] of Object.entries(mine ?? {})) {
    const found = rows.get(id);
    const name = r.contactId ? contacts.find((c) => c.id === r.contactId)?.name : undefined;
    if (found) rows.set(id, { ...found, due: r.due || found.due, note: r.note || found.note, done: r.done });
    else if (r.source === "manual" || !id.startsWith("auto:")) rows.set(id, { id, due: r.due, note: r.note, bank: r.bank, contactId: r.contactId, name, from: "added by you", found: false, done: r.done });
  }
  return [...rows.values()].sort((a, b) => a.due.localeCompare(b.due));
}

/** Not done and due on or before `day` (YYYY-MM-DD): what the 9 PM text lists. */
export const dueReminders = (rows: ReminderRow[], day: string) => rows.filter((r) => !r.done && r.due <= day);

/* ---------------- one list for the page and the 9 PM text ---------------- */

export type Age = "day" | "week" | "longer";
/** Last day (< 2 days), this week (2–7 days), longer. */
export function ageOf(at: string, now = Date.now()): Age {
  const d = (now - Date.parse(at)) / DAY;
  return d < 2 ? "day" : d <= 7 ? "week" : "longer";
}

export const RANK_OF: Record<string, number> = { new: 0, drafted: 1, sent: 2, followed_up: 3, replied: 4, call_scheduled: 5, done: 6 };

/** Replied, met, chatted, referred or was referred: someone in a conversation with you, not just cold outreach. */
export const isEngaged = (c: Contact) =>
  !!(c.repliedAt || c.lastHeardAt || c.chats?.length || c.call || c.chatEvidence?.length || c.referral || c.referredBy || c.metAt?.length || c.mail?.messages.some((m) => m.dir === "in"));

/** Your last email (Gmail, else the outreach dates) or "done by hand", whichever is later. */
export const lastFromYou = (c: Contact) => latestIso(latestIso(c.lastEmailedAt, c.lastTouchAt ?? c.sentAt), c.handledAt);

/** Out of the picture: done, moved on by hand / bounced / left / a confirmed no. (Moved on for no reply still counts: they may have written since.) */
const closed = (c: Contact) =>
  c.status === "done" || (c.status === "ignored" && c.outcome?.kind !== "no_reply") || !!(c.outcome && c.outcome.kind !== "no_reply" && (c.outcome.kind !== "declined" || c.outcome.confirmed));

/** Nudge after this many days when they replied but you haven't talked yet (owner: re-follow up earlier). */
export const QUIET_DAYS = 4;
export const CHECK_IN_DAYS = 7;

export type TodoKind = "thank" | "reply" | "quiet" | "check_in";

/**
 * The AI's read of one item (api/think/triage), for the message it was asked about (`key`). `kept` = you said "keep
 * it" (it's never hidden again for that message, by the AI or a rule).
 */
export interface Triage {
  key: string;
  at: string;
  needed: boolean;
  reason: string;
  why: string;
  confidence: number;
  /** Their last email asks you something / proposes times. */
  asks?: boolean;
  kept?: boolean;
}

/** Reasons the AI (or a rule) may hide an item for. Anything else stays listed. */
export const HIDEABLE = new Set(["already_thanked", "conversation_closed", "referral_done", "acknowledgement_only", "not_networking", "handled_elsewhere"]);
export const REASON_LABEL: Record<string, string> = {
  already_thanked: "Already thanked",
  conversation_closed: "Conversation wrapped up",
  referral_done: "They already referred you",
  acknowledgement_only: "Just a thanks / good luck",
  not_networking: "Not a networking contact",
  handled_elsewhere: "Handled another way",
};
/** The AI must be at least this sure to hide something. */
export const HIDE_CONFIDENCE = 0.8;

/** Times, availability, a call / resume / application / referral: never hidden, whatever the AI says. */
const SIGNAL =
  /\b(availability|available|times? (that )?work|what times?|free (on|this|next)|calendar invite|zoom|teams link|phone number|call (you|me)|hop on|grab (a )?(call|coffee)|(mon|tues|wednes|thurs|fri)day|tomorrow|next week|\d{1,2}(:\d{2})?\s?(am|pm)|resume|application|apply|superday|interview|referr\w*|recruiter|introduc\w*|connect you|forward(ed)?)\b/i;
/** One filler sentence: thanks / you're welcome / good luck / a sign-off / a name. */
const ACK_SENTENCE =
  /^((hi|hey|hello)( \w+)?|(many |again )?(thanks|thank you)( so much| again| for reaching out| for the note| for the kind words| for your note| for the update)?|you'?re (very )?welcome|no problem|no worries|of course|my pleasure|anytime|likewise|cheers|best|regards|best regards|all the best|(great|nice|good) (chatting|talking|speaking|meeting|connecting)( with you)?|(good|best of) luck( with (everything|recruiting|the process))?|glad (i could|to) help|happy to help|take care)( [a-z]+)?$/i;
/** Their whole email is filler, with no question: nothing to answer. */
export function isAckOnly(text: string) {
  const t = text.trim();
  if (!t || t.length > 300 || /\?/.test(t)) return false;
  // Pieces between punctuation: each must be filler, maybe with a name after it ("Thanks Nathan"), or just a name.
  const parts = t.split(/[.!,;]+\s*|\n+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((s) => ACK_SENTENCE.test(s) || /^[A-Z][a-z]{1,14}$/.test(s));
}

export interface TodoRow {
  c: Contact;
  kind: TodoKind;
  /** What it hangs on: the call (thank), their email (reply), your email (quiet / check-in). */
  at: string;
  /** When it's due (thank / reply: now). */
  due: string;
  age: Age;
  days: number;
  /** Identifies the item for the AI's verdict and "keep it": a new email makes a new item. */
  key: string;
  /** Their last email's text, when we have it. */
  text?: string;
  summary?: string;
  /** One line: why it's listed. */
  why: string;
  chatted: boolean;
  /** Hidden, and why (shown under "Filtered out" with a way back). */
  hidden?: { by: "ai" | "rule"; reason: string; why: string };
}


/** People who referred you to someone: their `referral`, someone else's `referredBy`, or an intro / referral found in their email. */
export function referrers(contacts: Contact[]) {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const c of contacts) {
    if (c.referral || c.signals?.some((s) => (s.kind === "intro" || s.kind === "referral") && s.status !== "dismissed")) ids.add(c.id);
    if (c.referredBy?.contactId) ids.add(c.referredBy.contactId);
    else if (c.referredBy?.name) names.add(c.referredBy.name.toLowerCase());
  }
  return (c: Contact) => ids.has(c.id) || names.has(c.name.toLowerCase());
}

/** Their last email's own text, when we have it for that email (the conversation read, else the tracked reply). */
function theirText(c: Contact, heard: string | undefined) {
  if (!heard) return undefined;
  const near = (at: string) => Date.parse(at) >= Date.parse(heard) - 60_000;
  if (c.mail?.lastIn && near(c.mail.lastIn.at))
    return { text: c.mail.lastIn.text, summary: c.lastReply?.messageId === c.mail.lastIn.id ? c.lastReply.summary : undefined, id: c.mail.lastIn.id };
  if (c.lastReply && near(c.lastReply.at)) return { text: c.lastReply.text, summary: c.lastReply.summary, id: c.lastReply.messageId };
  return undefined;
}

/**
 * What you owe this person, if anything, as of `now`: a thank-you for a call (14 days), a reply (they wrote last), a
 * nudge (they replied, you answered, they went quiet: 4 days before a chat, 7 after one), or nothing. Uses the email
 * conversation (lib/mailLedger.ts) when we have it. Resolved (until they write again), referrers (for nudges), and
 * the AI / rule filter decide `hidden`; the caller decides whether hidden rows show.
 */
export function todoFor(c: Contact, now: number, isReferrer: (c: Contact) => boolean = () => false): TodoRow | null {
  if (closed(c) || c.mail?.otherPerson) return null;
  const ex = lastExchange(c);
  const heard = ex.heard && Date.parse(ex.heard) <= now ? ex.heard : undefined;
  const you = ex.you;
  const resolvedAt = c.resolved?.at;
  // Resolved: nothing until they write after it.
  if (resolvedAt && (!heard || heard <= resolvedAt)) return null;
  const calls = [c.call?.at, ...(c.chats ?? []).map((x) => x.at), ...(c.chatEvidence ?? []).filter((e) => e.source === "calendar").map((e) => e.at)]
    // A chat you said didn't happen (Chats to confirm → No) isn't owed a thank-you.
    .filter((x): x is string => !!x && Date.parse(x) <= now && c.chatVerdicts?.[chatDayKey(x)] !== "no")
    .sort();
  const lastCall = calls[calls.length - 1];
  // Any meeting you didn't rule out (an unconfirmed one still means you talked, for the nudge timing).
  const chatted = !!lastCall || chatRecords(c, now).some((r) => r.state !== "rejected");
  const mk = (kind: TodoKind, at: string, due: string, key: string, why: string, t?: { text: string; summary?: string }): TodoRow => ({
    c,
    kind,
    at,
    due,
    age: ageOf(at, now),
    days: Math.max(0, Math.floor((now - Date.parse(at)) / DAY)),
    key,
    text: t?.text,
    summary: t?.summary,
    why,
    chatted,
  });
  // A thank-you for a call / chat in the last 2 weeks with no email since.
  if (lastCall && !(you && you > lastCall) && now - Date.parse(lastCall) < 14 * DAY) return mk("thank", lastCall, lastCall, `thank:${lastCall}`, `You talked ${md(lastCall)}; no email to them since.`);
  // A call still ahead: nothing to chase.
  if (c.call && Date.parse(c.call.at) > now) return null;
  const t = theirText(c, heard);
  // They wrote last. (Only a real email date counts here, not the "Replied" status.)
  if (heard && (!you || heard > you)) {
    const row = mk("reply", heard, heard, `reply:${t?.id ?? heard}`, `They wrote ${md(heard)}${you ? `; your last email was ${md(you)}` : ""}.`, t);
    return withHidden(row, c, t?.text);
  }
  // A chat set up outside email (LinkedIn, text, a referral) counts as them engaging (owner, 2026-11-22: the BMO chat
  // with Rohan Desai wasn't on the list: he never replied by email, so after the thank-you nothing tracked him).
  const replied = heard ?? c.repliedAt ?? (chatted ? lastCall : undefined);
  if (!replied || !you || you <= replied) return null;
  let due = Date.parse(you) + (chatted ? CHECK_IN_DAYS : QUIET_DAYS) * DAY;
  if (c.snoozeUntil && Date.parse(c.snoozeUntil) > due) due = Date.parse(c.snoozeUntil);
  const kind: TodoKind = chatted ? "check_in" : "quiet";
  const theirs = theirText(c, replied);
  const row = mk(kind, you, new Date(due).toISOString(), `${kind}:${c.mail?.lastOut?.id ?? you}`, `They last wrote ${md(replied)}; you wrote ${md(you)} and haven't heard back.`, theirs);
  if (c.referral || isReferrer(c)) return withHidden(row, c, row.text, { by: "rule", reason: "referral_done", why: "They already referred you to someone." });
  return withHidden(row, c, row.text);
}

/** Never hidden: their email asks something, or has times / a call / a resume / a referral in it. */
export function hasSignal(row: Pick<TodoRow, "kind">, text: string | undefined, asks?: boolean) {
  if (asks) return true;
  if (!text) return false;
  const own = text.split(/\n\s*(best|thanks|regards|sincerely|cheers)[,!.]?\s*\n/i)[0];
  if (row.kind === "reply" && /\?/.test(own)) return true;
  // A stalled scheduling thread (no chat yet) is exactly what to chase.
  if (row.kind === "quiet" || row.kind === "reply") return SIGNAL.test(own);
  return false;
}

function withHidden(row: TodoRow, c: Contact, text: string | undefined, rule?: TodoRow["hidden"]): TodoRow {
  const tr = c.triage?.key === row.key ? c.triage : undefined;
  if (tr?.kept) return row;
  if (hasSignal(row, text, tr?.asks)) return row;
  if (rule) return { ...row, hidden: rule };
  if (row.kind === "reply" && text && isAckOnly(text))
    return { ...row, hidden: { by: "rule", reason: "acknowledgement_only", why: "A short thanks / good luck with nothing to answer." } };
  if (tr && !tr.needed && tr.confidence >= HIDE_CONFIDENCE && HIDEABLE.has(tr.reason)) return { ...row, hidden: { by: "ai", reason: tr.reason, why: tr.why } };
  return row;
}

/** Every open item (hidden ones included; filter on `hidden`). Newest first. */
export function todoRows(contacts: Contact[], now = Date.now()): TodoRow[] {
  const isRef = referrers(contacts);
  return contacts
    .map((c) => todoFor(c, now, isRef))
    .filter((r): r is TodoRow => !!r)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** People you resolved who haven't written since. */
export function resolvedPeople(contacts: Contact[]) {
  return contacts
    .filter((c) => {
      if (!c.resolved) return false;
      const { heard } = lastExchange(c);
      return !heard || heard <= c.resolved.at;
    })
    .sort((a, b) => b.resolved!.at.localeCompare(a.resolved!.at));
}

/** The address on file is someone else's (by the names Gmail shows on it). */
export const wrongAddress = (contacts: Contact[]) => contacts.filter((c) => c.mail?.otherPerson && !closed(c));

/**
 * Where someone you've talked with stands, and why they are or aren't on Warm follow-ups (owner, 2026-11-22: "the BMO
 * chat with Rohan Desai is not there, which is really weird"). `engaged` = replied, met you, or referred you.
 */
export function standing(c: Contact, now: number, isReferrer: (c: Contact) => boolean = () => false): { engaged: boolean; listed: boolean; text: string } {
  const met = chatRecords(c, now).some((r) => r.state !== "rejected") || !!c.call;
  const engaged = !!(c.repliedAt || c.lastHeardAt || c.mail?.lastIn || met || c.referral || isReferrer(c));
  const row = todoFor(c, now, isReferrer);
  if (row) {
    const what = row.kind === "thank" ? "Thank-you owed" : row.kind === "reply" ? "They wrote last: reply" : Date.parse(row.due) <= now ? "Nudge now" : `Next nudge ${md(row.due)}`;
    return { engaged, listed: !row.hidden, text: row.hidden ? `Filtered out as noise: ${row.hidden.why}` : `${what}. ${row.why}` };
  }
  if (c.mail?.otherPerson) return { engaged, listed: false, text: `The address on file belongs to ${c.mail.otherPerson}: fix it to track them.` };
  if (c.status === "done") return { engaged, listed: false, text: "Status is Done, so they're not tracked. Change the status to track them again." };
  if (c.status === "ignored") return { engaged, listed: false, text: "Moved on. Bring them back on Bank coverage to track them again." };
  if (c.outcome) return { engaged, listed: false, text: `Closed: ${c.outcome.kind.replace("_", " ")}.` };
  if (c.resolved) return { engaged, listed: false, text: `Resolved by you ${md(c.resolved.at)}: ${c.resolved.note}. Back on the list when they write again.` };
  if (c.call && Date.parse(c.call.at) > now) return { engaged, listed: false, text: `Call on ${md(c.call.at)}: nothing to chase before it.` };
  if (!engaged) return { engaged, listed: false, text: "No reply or chat yet: they're on Cold outreach." };
  const ex = lastExchange(c);
  if (!ex.you) return { engaged, listed: false, text: "You haven't emailed them since you talked: send a thank-you or note (it shows here once a chat or reply is on record)." };
  return { engaged, listed: false, text: `You wrote last (${md(ex.you)}); nothing to follow up on yet.` };
}
