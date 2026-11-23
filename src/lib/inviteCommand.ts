/**
 * Calendar invites from your phone (owner, 2026-11-22: "send gcal invites… on my phone either via a command or like
 * text"). Pure, so `check:scheduling` covers it:
 *  - `parseInviteText`: a text like "invite Rohan Desai tue 3pm", "invite joe tomorrow 10:30am 45m",
 *    "invite maya 11/25 4pm for 30 min" (Twilio inbound).
 *  - `findPerson`: who that is among the people Coverage's server knows (name + email, `account.people`).
 *  - `startFrom`: an ISO time from Claude (with or without an offset; without = your time zone).
 */
import { zonedDate } from "./sendWindow";

export interface InviteAsk {
  who: string;
  /** Local date + time in your zone. */
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  minutes: number;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Today's date and weekday in `tz`. */
function today(tz: string, now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), wd: DAYS.indexOf(String(parts.weekday).slice(0, 3).toLowerCase()), h: Number(parts.hour), min: Number(parts.minute) };
}

const addDays = (y: number, m: number, d: number, n: number) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

export function parseInviteText(text: string, tz: string, now = new Date()): InviteAsk | { error: string } {
  const body = text.trim().replace(/^invite\s+/i, "");
  if (body === text.trim()) return { error: 'Start with "invite", e.g. "invite Rohan Desai tue 3pm".' };
  let rest = ` ${body.toLowerCase()} `;
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], " ");
    return m;
  };
  const dur = take(/\s(?:for\s+)?(\d{2,3})\s*(?:m|min|mins|minutes)\b/) ?? take(/\s(?:for\s+)?(1|2)\s*(?:h|hr|hour|hours)\b/);
  const minutes = dur ? (/h/.test(dur[0]) ? Number(dur[1]) * 60 : Number(dur[1])) : 30;
  const time = take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ?? take(/\s(?:at\s+)?([01]?\d|2[0-3]):(\d{2})\b/);
  if (!time) return { error: 'Add a time, e.g. "3pm" or "10:30am".' };
  let h = Number(time[1]);
  const min = time[2] ? Number(time[2]) : 0;
  if (time[3] === "pm" && h < 12) h += 12;
  if (time[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return { error: "That time doesn't look right." };
  const t = today(tz, now);
  let date: { y: number; m: number; d: number } | null = null;
  const md = take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (md) {
    const y = md[3] ? (md[3].length === 2 ? 2000 + Number(md[3]) : Number(md[3])) : t.y;
    date = { y, m: Number(md[1]), d: Number(md[2]) };
    // "1/5" in late November is next year.
    if (!md[3] && (date.m < t.m || (date.m === t.m && date.d < t.d))) date.y++;
  } else if (take(/\s(?:on\s+)?today\b/)) date = { y: t.y, m: t.m, d: t.d };
  else if (take(/\s(?:on\s+)?(?:tomorrow|tmrw|tmr)\b/)) date = addDays(t.y, t.m, t.d, 1);
  else {
    const wd = take(/\s(?:on\s+|next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
    if (wd) {
      const want = DAYS.indexOf(wd[1]);
      let n = (want - t.wd + 7) % 7;
      // Same weekday: today if that time is still ahead, else next week; "next tue" always skips this week.
      if (n === 0 && (h < t.h || (h === t.h && min <= t.min))) n = 7;
      if (/next/.test(wd[0]) && n === 0) n = 7;
      date = addDays(t.y, t.m, t.d, n);
    }
  }
  if (!date) return { error: 'Add a day: "today", "tomorrow", a weekday ("tue") or a date ("11/25").' };
  const who = rest.replace(/\s(with|at|on|for)\s/g, " ").replace(/\s+/g, " ").trim();
  if (!who) return { error: "Who is it with? e.g. \"invite Rohan Desai tue 3pm\"." };
  return { who, ...date, h, min, minutes: Math.min(180, Math.max(10, minutes)) };
}

export type Person = { contactId: string; name: string; email?: string; bank?: string; engaged?: boolean };

/** The person a name or email means; several matches = ask which (most engaged first). */
export function findPerson(people: Person[], query: string): { person: Person } | { error: string } {
  const q = query.trim().toLowerCase();
  if (q.includes("@")) {
    const p = people.find((x) => x.email?.toLowerCase() === q);
    return p ? { person: p } : { error: `No one with ${query} is in Coverage.` };
  }
  const words = q.split(/\s+/).filter(Boolean);
  const hits = people.filter((p) => {
    const n = p.name.toLowerCase().split(/\s+/);
    return words.every((w) => n.some((x) => x.startsWith(w)) || (p.bank ?? "").toLowerCase().includes(w));
  });
  if (!hits.length) return { error: `No one called "${query}" is in Coverage (only people you've emailed or talked to).` };
  const engaged = hits.filter((p) => p.engaged);
  const pool = engaged.length ? engaged : hits;
  if (pool.length > 1) return { error: `Which one? ${pool.slice(0, 5).map((p) => `${p.name}${p.bank ? ` (${p.bank})` : ""}`).join(", ")}. Add their last name or bank.` };
  if (!pool[0].email) return { error: `${pool[0].name} has no email in Coverage, so there's no one to invite.` };
  return { person: pool[0] };
}

/** "2026-11-25T15:00" (your zone) or a full ISO time with an offset → a Date. */
export function startFrom(iso: string, tz: string): Date | null {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? zonedDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz) : null;
}

export const whenLabel = (at: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
