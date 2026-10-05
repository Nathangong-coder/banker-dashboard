/**
 * The "Contacted" column on contact tables: when each person was actually emailed, so the dates live in the workbook
 * (follow-ups are timed from them) instead of only in this browser.
 *
 *   9/17/2026                          first email only
 *   9/17/2026 · last 9/25/2026         first email, and the latest follow-up
 *   Scheduled 10/6/2026 9:00 AM        queued in Gmail, not sent yet
 *
 * Reading is lenient (Excel dates, 9/17, 2026-09-17, "Sep 17"): the first date is the first email, a later one the
 * last touch, and "sched" anywhere marks a scheduled send.
 */

export interface Contacted {
  sentAt?: string;
  lastTouchAt?: string;
  scheduledAt?: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Two-digit or missing years: the most recent such date that isn't more than a week in the future. */
function pickYear(m: number, d: number, y: number | undefined, now: Date) {
  if (y !== undefined) return y < 100 ? 2000 + y : y;
  const guess = new Date(now.getFullYear(), m, d);
  return guess.getTime() - now.getTime() > 7 * 86_400_000 ? now.getFullYear() - 1 : now.getFullYear();
}

function timeOf(rest: string) {
  const t = rest.match(/^\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i) ?? rest.match(/^\s*(?:at\s*)?(\d{1,2}):(\d{2})(?!\d)/);
  if (!t) return { h: 0, min: 0 };
  let h = Number(t[1]) % 24;
  if (t[3]) h = (h % 12) + (/p/i.test(t[3]) ? 12 : 0);
  return { h, min: Number(t[2] ?? 0) };
}

/** Every date in a cell, in order, as local Date objects. */
export function datesIn(text: string, now = new Date()): Date[] {
  const out: { at: number; d: Date }[] = [];
  const s = text.replace(/\s+/g, " ");
  const add = (index: number, len: number, y: number | undefined, m: number, d: number) => {
    if (m < 0 || m > 11 || d < 1 || d > 31) return;
    const { h, min } = timeOf(s.slice(index + len));
    out.push({ at: index, d: new Date(pickYear(m, d, y, now), m, d, h, min) });
  };
  for (const x of s.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/g)) {
    const d = new Date(Number(x[1]), Number(x[2]) - 1, Number(x[3]), Number(x[4] ?? 0), Number(x[5] ?? 0));
    out.push({ at: x.index!, d });
  }
  for (const x of s.matchAll(/(?<![\d-])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/g)) add(x.index!, x[0].length, x[3] ? Number(x[3]) : undefined, Number(x[1]) - 1, Number(x[2]));
  for (const x of s.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b/gi))
    add(x.index!, x[0].length, x[3] ? Number(x[3]) : undefined, MONTHS.indexOf(x[1].toLowerCase()), Number(x[2]));
  return out
    .sort((a, b) => a.at - b.at)
    .map((x) => x.d)
    .filter((d) => !Number.isNaN(d.getTime()));
}

export function parseContacted(text: string | undefined, now = new Date()): Contacted {
  const raw = (text ?? "").trim();
  if (!raw) return {};
  // ExcelJS hands real date cells over as Date.toString() text or an ISO string.
  const native = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{4}/.test(raw) || /^\d{4}-\d{2}-\d{2}T/.test(raw) ? new Date(raw) : null;
  if (native && !Number.isNaN(native.getTime())) return { sentAt: native.toISOString() };
  const dates = datesIn(raw, now);
  if (!dates.length) return {};
  if (/sched/i.test(raw)) {
    // "9/17/2026 · Scheduled 10/6/2026": dates before the word were sent, the one after it is queued.
    const cut = raw.search(/sched/i);
    const before = datesIn(raw.slice(0, cut), now);
    const after = datesIn(raw.slice(cut), now);
    return {
      ...(before.length ? { sentAt: before[0].toISOString(), lastTouchAt: before[before.length - 1].toISOString() } : {}),
      ...(after.length ? { scheduledAt: after[0].toISOString() } : {}),
    };
  }
  return { sentAt: dates[0].toISOString(), lastTouchAt: dates[dates.length - 1].toISOString() };
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const sameDay = (a?: string, b?: string) => (!a && !b) || (!!a && !!b && day(a) === day(b));

/** What the Contacted cell should say for these dates ("" = nothing known). */
export function formatContacted(c: Contacted): string {
  const parts: string[] = [];
  if (c.sentAt) {
    parts.push(day(c.sentAt));
    if (c.lastTouchAt && !sameDay(c.lastTouchAt, c.sentAt)) parts.push(`last ${day(c.lastTouchAt)}`);
  }
  if (c.scheduledAt && (!c.sentAt || c.scheduledAt > (c.lastTouchAt ?? c.sentAt))) parts.push(`Scheduled ${day(c.scheduledAt)} ${clock(c.scheduledAt)}`);
  return parts.join(" · ");
}

/** Same dates (to the day; scheduled to the minute)? Untouched cells in the owner's own format aren't rewritten. */
export function sameContacted(a: Contacted, b: Contacted) {
  const lastA = a.lastTouchAt ?? a.sentAt;
  const lastB = b.lastTouchAt ?? b.sentAt;
  const sched = (x?: string) => (x ? `${day(x)} ${clock(x)}` : "");
  return sameDay(a.sentAt, b.sentAt) && sameDay(lastA, lastB) && sched(a.scheduledAt) === sched(b.scheduledAt);
}

/** Header synonyms for the column (workbook.ts#HEADERS). */
export const CONTACTED_HEADERS = ["contacted", "date contacted", "last contacted", "emailed", "date emailed", "date sent", "sent on", "sent date"];
