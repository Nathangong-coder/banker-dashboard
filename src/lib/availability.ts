import { zonedDate } from "./sendWindow";

/**
 * Your availability for calls, in YOUR time zone: weekly hours, changed for specific dates (a week that's different),
 * minus what's on your Google Calendar. Shown to a banker in THEIR time zone ("10:00 AM – 1:00 PM ET" for 7–10 AM PT),
 * so nobody converts by hand. Pure: the calendar's busy times are passed in (lib/gcal.ts fetches them).
 */

/** Minutes from midnight. */
export interface Range {
  start: number;
  end: number;
}

export interface Availability {
  /** Your time zone (IANA), e.g. America/Los_Angeles. */
  tz: string;
  /** Weekly hours by weekday, 0 = Sunday. */
  weekly: Record<number, Range[]>;
  /** Specific dates (YYYY-MM-DD in your zone) that differ from the week: [] = unavailable that day. */
  overrides: Record<string, Range[]>;
  /** How long a call is, in minutes (shorter free gaps aren't offered). */
  meetingMinutes: number;
  /** Don't offer anything sooner than this many hours from now. */
  minNoticeHours: number;
  /** Look this many days ahead when nothing narrower was asked for. */
  horizonDays: number;
}

const h = (x: number) => x * 60;
export const DEFAULT_AVAILABILITY = (tz: string): Availability => ({
  tz,
  weekly: { 0: [], 1: [{ start: h(9), end: h(17) }], 2: [{ start: h(9), end: h(17) }], 3: [{ start: h(9), end: h(17) }], 4: [{ start: h(9), end: h(17) }], 5: [{ start: h(9), end: h(17) }], 6: [] },
  overrides: {},
  meetingMinutes: 30,
  minNoticeHours: 12,
  horizonDays: 7,
});

export interface Window {
  start: Date;
  end: Date;
}

/* ---------------- time zones ---------------- */

function partsIn(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd, h: Number(p.hour), min: Number(p.minute) };
}

export const ymdIn = (at: Date, tz: string) => {
  const p = partsIn(at, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

/** "ET" / "CT" / "MT" / "PT" for US zones (what bankers write), else the zone's short name. */
export function tzLabel(tz: string, at = new Date()) {
  const map: Record<string, string> = {
    "America/New_York": "ET", "America/Detroit": "ET", "America/Toronto": "ET",
    "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MT",
    "America/Los_Angeles": "PT", "America/Vancouver": "PT",
  };
  if (map[tz]) return map[tz];
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? tz;
}

export const COMMON_ZONES: [string, string][] = [
  ["America/Los_Angeles", "Pacific (PT)"],
  ["America/Denver", "Mountain (MT)"],
  ["America/Chicago", "Central (CT)"],
  ["America/New_York", "Eastern (ET)"],
  ["Europe/London", "London"],
  ["Asia/Hong_Kong", "Hong Kong"],
];

/* ---------------- free windows ---------------- */

function subtract(w: Window, busy: Window[]): Window[] {
  let pieces: Window[] = [w];
  for (const b of busy) {
    const next: Window[] = [];
    for (const p of pieces) {
      if (b.end <= p.start || b.start >= p.end) next.push(p);
      else {
        if (b.start > p.start) next.push({ start: p.start, end: b.start });
        if (b.end < p.end) next.push({ start: b.end, end: p.end });
      }
    }
    pieces = next;
  }
  return pieces;
}

/**
 * When you're free between `from` and `to`: your hours for each day (override, else weekly) in your zone, minus busy
 * calendar times and anything before the notice period; gaps shorter than a call are dropped. Edges snap to :00/:30.
 */
export function freeWindows(av: Availability, busy: Window[], from: Date, to: Date, now = new Date()): Window[] {
  const out: Window[] = [];
  const earliest = new Date(Math.max(from.getTime(), now.getTime() + av.minNoticeHours * 3_600_000));
  const first = partsIn(from, av.tz);
  for (let add = 0; add < 62; add++) {
    const noon = zonedDate(first.y, first.m, first.d + add, 12, 0, av.tz);
    if (noon.getTime() - 12 * 3_600_000 > to.getTime()) break;
    const p = partsIn(noon, av.tz);
    const key = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    const ranges = av.overrides[key] ?? av.weekly[p.wd] ?? [];
    for (const r of ranges) {
      const start = zonedDate(p.y, p.m, p.d, Math.floor(r.start / 60), r.start % 60, av.tz);
      const end = zonedDate(p.y, p.m, p.d, Math.floor(r.end / 60), r.end % 60, av.tz);
      for (const piece of subtract({ start, end }, busy)) {
        // Round the start up / end down to the half hour so offers read cleanly.
        const s = new Date(Math.ceil(Math.max(piece.start.getTime(), earliest.getTime()) / 1_800_000) * 1_800_000);
        const e = new Date(Math.floor(Math.min(piece.end.getTime(), to.getTime()) / 1_800_000) * 1_800_000);
        if (e.getTime() - s.getTime() >= av.meetingMinutes * 60_000) out.push({ start: s, end: e });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** What the banker asked for, in THEIR terms (lib/server parse, or the defaults). */
export interface AskedFor {
  /** YYYY-MM-DD in their zone, inclusive. */
  fromDate?: string;
  toDate?: string;
  /** 0 = Sunday. Empty = any weekday. */
  weekdays?: number[];
  /** Minutes from midnight in their zone ("afternoons" = 12:00–17:00). */
  earliest?: number;
  latest?: number;
}

/** Narrow free windows to what they asked for, judged in their time zone. Weekends are left out unless asked for. */
export function narrowTo(windows: Window[], ask: AskedFor, theirTz: string): Window[] {
  const out: Window[] = [];
  for (const w of windows) {
    const s = partsIn(w.start, theirTz);
    const day = `${s.y}-${String(s.m).padStart(2, "0")}-${String(s.d).padStart(2, "0")}`;
    if (ask.fromDate && day < ask.fromDate) continue;
    if (ask.toDate && day > ask.toDate) continue;
    if (ask.weekdays?.length ? !ask.weekdays.includes(s.wd) : s.wd === 0 || s.wd === 6) continue;
    let start = w.start;
    let end = w.end;
    if (ask.earliest !== undefined) {
      const lo = zonedDate(s.y, s.m, s.d, Math.floor(ask.earliest / 60), ask.earliest % 60, theirTz);
      if (lo > start) start = lo;
    }
    if (ask.latest !== undefined) {
      const hi = zonedDate(s.y, s.m, s.d, Math.floor(ask.latest / 60), ask.latest % 60, theirTz);
      if (hi < end) end = hi;
    }
    if (end > start) out.push({ start, end });
  }
  return out;
}

/* ---------------- words ---------------- */

const clock = (d: Date, tz: string) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).replace(":00 ", " ");

/** "Tuesday, Oct 13: 10 AM – 1 PM ET", one line per day in THEIR zone (a window crossing midnight there splits). */
export function formatWindows(windows: Window[], tz: string, opts: { maxDays?: number } = {}) {
  const byDay = new Map<string, string[]>();
  for (const w of windows) {
    const day = w.start.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
    const span = `${clock(w.start, tz)} – ${clock(w.end, tz)}`;
    byDay.set(day, [...(byDay.get(day) ?? []), span]);
  }
  const label = tzLabel(tz, windows[0]?.start);
  return [...byDay.entries()].slice(0, opts.maxDays ?? 5).map(([day, spans]) => `${day}: ${spans.join(", ")} ${label}`);
}

/** "10 AM PT" / "Tuesday, Oct 13 at 10 AM PT" for an invite. */
export const timeLabel = (at: Date, tz: string) => `${clock(at, tz)} ${tzLabel(tz, at)}`;
export const dateTimeLabel = (at: Date, tz: string) => `${at.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" })} at ${timeLabel(at, tz)}`;

/* ---------------- editing ranges as text ---------------- */

const toMin = (raw: string, ampmHint?: string) => {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  const ap = m[3] ?? ampmHint;
  if (hh > 24 || mm > 59) return null;
  if (ap?.startsWith("p") && hh < 12) hh += 12;
  if (ap?.startsWith("a") && hh === 12) hh = 0;
  return hh * 60 + mm;
};

/** "7-10am, 2:30pm-5pm" / "9:00-12:00" → ranges. Throws with a readable message on nonsense. */
export function parseRanges(text: string): Range[] {
  const t = text.trim();
  if (!t || /^(off|none|busy|unavailable|-)$/i.test(t)) return [];
  return t.split(/[,;]+/).map((part) => {
    const m = part.trim().match(/^(.+?)\s*(?:-|–|to)\s*(.+)$/i);
    if (!m) throw new Error(`"${part.trim()}" isn't a range (try 9am-12pm)`);
    const endAp = m[2].trim().toLowerCase().match(/(am|pm|a|p)$/)?.[1];
    const end = toMin(m[2]);
    let start = toMin(m[1], m[1].match(/(am|pm|a|p)$/i) ? undefined : endAp);
    // "11-1pm": a start later than the end on the same half of the day means it was in the morning.
    if (start !== null && end !== null && start >= end && endAp && !/(am|pm|a|p)$/i.test(m[1].trim())) start = toMin(m[1], endAp === "pm" || endAp === "p" ? "am" : "pm");
    if (start === null || end === null) throw new Error(`Couldn't read the time in "${part.trim()}"`);
    if (end <= start) throw new Error(`"${part.trim()}" ends before it starts`);
    return { start, end };
  });
}

const fmt = (m: number) => {
  const hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${hh % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${hh < 12 ? "am" : "pm"}`;
};
export const rangesText = (rs: Range[]) => (rs.length ? rs.map((r) => `${fmt(r.start)}-${fmt(r.end)}`).join(", ") : "off");

/* ---------------- phone numbers ---------------- */

/** Phone numbers in an email (their signature), formatted 415-701-1213; `exclude` = your own. */
export function phonesIn(text: string, exclude: string[] = []) {
  const mine = new Set(exclude.map((x) => x.replace(/\D/g, "").slice(-10)).filter(Boolean));
  const out: string[] = [];
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g)) {
    const ten = `${m[1]}${m[2]}${m[3]}`;
    if (mine.has(ten) || /^(\d)\1+$/.test(ten)) continue;
    const f = `${m[1]}-${m[2]}-${m[3]}`;
    if (!out.includes(f)) out.push(f);
  }
  return out;
}
