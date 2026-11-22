import type { Contact } from "./types";
import { DAY, latestIso } from "./util";
import { chatDays } from "./chatEvidence";

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

/* ---------------- replies you haven't answered / went quiet ---------------- */

export type Age = "day" | "week" | "longer";
/** Last day (< 2 days), this week (2–7 days), longer. */
export function ageOf(at: string, now = Date.now()): Age {
  const d = (now - Date.parse(at)) / DAY;
  return d < 2 ? "day" : d <= 7 ? "week" : "longer";
}

/** Your last email (Gmail, else the outreach dates) or "done by hand", whichever is later. */
export const lastFromYou = (c: Contact) => latestIso(latestIso(c.lastEmailedAt, c.lastTouchAt ?? c.sentAt), c.handledAt);

const out = (c: Contact) => c.status === "ignored" || c.status === "done" || !!(c.outcome && c.outcome.kind !== "no_reply" && (c.outcome.kind !== "declined" || c.outcome.confirmed));

export interface ReplyRow {
  c: Contact;
  /** Their latest email. */
  at: string;
  age: Age;
  days: number;
  /** Their message, when Coverage has it for this email. */
  text?: string;
  summary?: string;
  /** The AI read it as a "thanks, good luck" with nothing to answer. */
  noReplyNeeded?: boolean;
}

/** They wrote after your last email (and you haven't marked it done). Newest first. */
export function unansweredReplies(contacts: Contact[], now = Date.now()): ReplyRow[] {
  return contacts
    .filter((c) => !out(c) && c.lastHeardAt && Date.parse(c.lastHeardAt) <= now)
    .filter((c) => {
      const mine = lastFromYou(c);
      return !mine || c.lastHeardAt! > mine;
    })
    .map((c) => {
      const at = c.lastHeardAt!;
      // The stored text is for this email if it isn't older than it (allow a minute: Gmail vs header dates).
      const r = c.lastReply && Date.parse(c.lastReply.at) >= Date.parse(at) - 60_000 ? c.lastReply : undefined;
      return { c, at, age: ageOf(at, now), days: Math.floor((now - Date.parse(at)) / DAY), text: r?.text, summary: r?.summary, noReplyNeeded: !!r && r.needsReply === false && r.kind === "acknowledgement" };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export interface QuietRow {
  c: Contact;
  /** Their last email to you. */
  heardAt: string;
  /** Your last email after it. */
  youAt: string;
  days: number;
  age: Age;
  /** Chatted yet? Before a chat (scheduling stalled) the nudge is due sooner. */
  chatted: boolean;
  /** When to nudge them: 4 days after your email before a chat, 7 after one (or your snooze). */
  due: string;
}

/** Nudge after this many days when they replied but you haven't talked yet (owner: re-follow up earlier). */
export const QUIET_DAYS = 4;
export const CHECK_IN_DAYS = 7;

/** They replied, you answered, and they've gone quiet (no call ahead, no referral yet). Longest wait first. */
export function wentQuiet(contacts: Contact[], now = Date.now()): QuietRow[] {
  const rows: QuietRow[] = [];
  for (const c of contacts) {
    if (out(c) || !c.lastHeardAt || c.referral) continue;
    if (c.call && Date.parse(c.call.at) > now) continue;
    const you = lastFromYou(c);
    if (!you || you <= c.lastHeardAt || Date.parse(you) > now) continue;
    const chatted = chatDays(c, now).length > 0;
    let due = Date.parse(you) + (chatted ? CHECK_IN_DAYS : QUIET_DAYS) * DAY;
    if (c.snoozeUntil && Date.parse(c.snoozeUntil) > due) due = Date.parse(c.snoozeUntil);
    rows.push({ c, heardAt: c.lastHeardAt, youAt: you, days: Math.floor((now - Date.parse(you)) / DAY), age: ageOf(you, now), chatted, due: new Date(due).toISOString() });
  }
  return rows.sort((a, b) => a.youAt.localeCompare(b.youAt));
}
