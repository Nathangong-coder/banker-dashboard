import type { Contact, Settings } from "./types";

/**
 * When automatic / suggested sends go out: a window of hours (default 9–11 AM) in the recipient's time zone (NY → Eastern,
 * Chicago / Texas → Central, everyone else → Pacific) or yours, on weekdays only by default. A batch is spread through the
 * window a few minutes apart, so 15 follow-ups don't all leave at 9:00 sharp.
 *
 * Replaces the old fixed rule (NY 5 PM PT, else 7 PM PT; docs/outreach-rules.md A5): the owner asked for 9–11 AM on 2026-10-06.
 */
export interface SendWindow {
  /** Hour the window opens, 0–23. */
  start: number;
  /** Hour it closes (exclusive), 1–24. */
  end: number;
  basis: "recipient" | "mine";
  /** Days sends may go out, 0 = Sunday (in the zone of `basis`). The owner's default: Tuesday–Thursday. */
  days: number[];
}

export const DEFAULT_SEND_WINDOW: SendWindow = { start: 9, end: 11, basis: "recipient", days: [2, 3, 4] };

/** The saved window, or the default. Older saves had `weekdaysOnly` instead of `days`: they get Tuesday–Thursday. */
export const windowOf = (s: Pick<Settings, "sendWindow">): SendWindow => {
  const saved = (s.sendWindow ?? {}) as Partial<SendWindow> & { weekdaysOnly?: boolean };
  const days = Array.isArray(saved.days) && saved.days.length ? saved.days : DEFAULT_SEND_WINDOW.days;
  return { start: saved.start ?? DEFAULT_SEND_WINDOW.start, end: saved.end ?? DEFAULT_SEND_WINDOW.end, basis: saved.basis ?? DEFAULT_SEND_WINDOW.basis, days };
};

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue–Thu", "Mon, Wed, Fri", "every day". */
export function daysLabel(days: number[]) {
  const d = [...new Set(days)].sort();
  if (d.length === 7) return "every day";
  const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return run ? `${WD[d[0]]}–${WD[d[d.length - 1]]}` : d.map((x) => WD[x]).join(", ");
}

const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

/** The recipient's time zone from their office. */
export function recipientTz(c: Pick<Contact, "region" | "location">) {
  if (c.region === "NY") return "America/New_York";
  if (c.region === "CHI" || /\b(tx|texas|houston|dallas|austin)\b/i.test(c.location ?? "")) return "America/Chicago";
  return "America/Los_Angeles";
}

const tzOf = (c: Pick<Contact, "region" | "location">, w: SendWindow, mine = myTz()) => (w.basis === "recipient" ? recipientTz(c) : mine);

/** y-m-d and weekday of an instant in a zone. */
function partsIn(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd: p.weekday as string, h: Number(p.hour), min: Number(p.minute) };
}

/** The calendar day of an instant in a zone, as a sortable number (20261022). */
const dayNum = (at: Date, tz: string) => {
  const p = partsIn(at, tz);
  return p.y * 10_000 + p.m * 100 + p.d;
};

/**
 * Follow-up spacing is in calendar days, in the recipient's zone: "7 days after Thursday 10/15" = any time on Thursday
 * 10/22. It used to be to the minute, so a first email sent at 10:42 AM couldn't take a 9:30 slot a week later, and the
 * end of a 9–11 AM batch (or anything first sent after 11) slid past Thursday to the next allowed day (Tue 10/27).
 */
export function tooSoon(at: Date, notBefore: Date | undefined, c: Pick<Contact, "region" | "location">, w: SendWindow) {
  if (!notBefore) return false;
  const tz = tzOf(c, w);
  return dayNum(at, tz) < dayNum(notBefore, tz);
}

/** Past the follow-up range: more than 2 × FOLLOW_UP_SPREAD days after the earliest allowed day (8+ days for a 7-day setting). */
export function pastRange(at: Date, notBefore: Date, c: Pick<Contact, "region" | "location">, w: SendWindow) {
  const tz = tzOf(c, w);
  return daysBetween(dayNum(notBefore, tz), dayNum(at, tz)) > 2 * FOLLOW_UP_SPREAD;
}

/** The instant that reads y-m-d h:min on a wall clock in `tz` (DST-safe: corrects by the zone's offset twice). */
export function zonedDate(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const want = Date.UTC(y, m - 1, d, h, min);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(t), tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    t += want - seen;
  }
  return new Date(t);
}

/**
 * Follow-ups go out 6, 7 or 8 days after your last email (`firstAfterDays` ± this, at least 6), and first emails on one
 * of the next few send days, picked at random: replies can then be compared by gap and by weekday (owner, 2026-10-20).
 */
export const FOLLOW_UP_SPREAD = 1;
/** First emails: a random one of this many next allowed send days (Tue / Wed / Thu by default). */
const FIRST_EMAIL_DAYS = 3;
/** Sends to one zone on one day are at least this far apart, so two never leave in the same minute. */
const MIN_APART_MIN = 3;

const MINUTE = 60_000;
const DAY_MS = 86_400_000;
const daysBetween = (a: number, b: number) => {
  const utc = (n: number) => Date.UTC(Math.floor(n / 10_000), (Math.floor(n / 100) % 100) - 1, n % 100);
  return Math.round((utc(b) - utc(a)) / DAY_MS);
};

/**
 * Send times for a batch (owner, 2026-10-20): no per-day cap and no fixed grid. Each person gets a random day (a
 * follow-up: any allowed day from `notBefore` to 2 days after it, i.e. 6-8 days after your last email; a first email:
 * one of the next FIRST_EMAIL_DAYS allowed days) and a random minute in the window that isn't a round :00 / :05 / :10…
 * (round times look scheduled) and is MIN_APART_MIN from other sends in that zone that day. `taken` = times already
 * queued for other people. `notBefore` = followups.ts#earliestSend. `why` gets a short reason per person.
 * `random` (0..1) makes it testable; passing `jitter` (the old option) means "deterministic": earliest day, earliest minute.
 */
export function planSends<C extends Pick<Contact, "id" | "region" | "location">>(
  people: C[],
  w: SendWindow,
  opts: {
    now?: Date;
    taken?: Date[];
    jitter?: () => number;
    random?: () => number;
    notBefore?: (c: C) => Date | undefined;
    why?: Map<string, string>;
    /** How many days after `notBefore` a follow-up may land (default 2: 6, 7 or 8 days after the last email). */
    spreadDays?: number;
    /** The gap `notBefore` stands for (default 6), for the `why` text only. */
    minGapDays?: number;
  } = {},
) {
  const now = opts.now ?? new Date();
  const rand = opts.random ?? (opts.jitter ? () => 0 : Math.random);
  const spread = opts.spreadDays ?? 2 * FOLLOW_UP_SPREAD;
  const mine = myTz();
  const used = new Map<string, number[]>();
  const keyFor = (tz: string, n: number) => `${tz}|${n}`;
  const mark = (t: number) => {
    for (const tz of new Set(["America/New_York", "America/Chicago", "America/Los_Angeles", mine])) {
      const k = keyFor(tz, dayNum(new Date(t), tz));
      used.set(k, [...(used.get(k) ?? []), t]);
    }
  };
  for (const t of opts.taken ?? []) mark(t.getTime());
  const out = new Map<string, Date>();
  const earliest = now.getTime() + 10 * MINUTE;
  for (const c of people) {
    const tz = tzOf(c, w, mine);
    const notBefore = opts.notBefore?.(c)?.getTime() ?? 0;
    const nbDay = notBefore ? dayNum(new Date(notBefore), tz) : 0;
    const first = partsIn(new Date(Math.max(now.getTime(), notBefore)), tz);
    // Allowed days with the window still open, from the first possible one on.
    const days: { n: number; wd: string; from: number; close: number }[] = [];
    for (let add = 0; add < 40 && days.length < 12; add++) {
      const day = partsIn(zonedDate(first.y, first.m, first.d + add, 12, 0, tz), tz);
      const n = day.y * 10_000 + day.m * 100 + day.d;
      if (!w.days.includes(WD.indexOf(day.wd)) || n < nbDay) continue;
      const from = Math.max(zonedDate(day.y, day.m, day.d, w.start, 0, tz).getTime(), earliest);
      const close = zonedDate(day.y, day.m, day.d, w.end, 0, tz).getTime();
      if (from < close - MINUTE) days.push({ n, wd: day.wd, from, close });
    }
    if (!days.length) continue;
    const inRange = notBefore ? days.filter((d) => daysBetween(nbDay, d.n) <= spread) : days.slice(0, FIRST_EMAIL_DAYS);
    const pool = inRange.length ? inRange : days.slice(0, 1);
    const day = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
    const spots = used.get(keyFor(tz, day.n)) ?? [];
    const ok = (t: number) => t < day.close && new Date(t).getUTCMinutes() % 5 !== 0 && spots.every((s) => Math.abs(s - t) >= MIN_APART_MIN * MINUTE);
    const minutes = Math.floor((day.close - day.from) / MINUTE);
    const base = Math.ceil(day.from / MINUTE) * MINUTE;
    // A random minute, else the first free one from a random point (wrapping), so a busy day still fits.
    let at: number | undefined;
    const startAt = Math.floor(rand() * minutes);
    for (let i = 0; i < minutes && at === undefined; i++) {
      const t = base + ((startAt + i) % minutes) * MINUTE;
      if (ok(t)) at = t;
    }
    // Every minute taken (hundreds of sends in one zone and day): any non-round minute will do.
    at ??= base + MINUTE;
    out.set(c.id, new Date(at));
    mark(at);
    if (notBefore) {
      const gap = (opts.minGapDays ?? 6) + daysBetween(nbDay, day.n);
      opts.why?.set(c.id, `${day.wd}, ${gap} days after your last email${inRange.length ? "" : " (first send day after the 6-8 day range)"}`);
    } else if (pool.length > 1) opts.why?.set(c.id, `${day.wd} (picked at random from your next ${pool.length} send days)`);
  }
  return out;
}

/** "Tue 9:06 AM ET", plus your own time when it differs. */
export function sendLabelFor(at: Date, c: Pick<Contact, "region" | "location">, w: SendWindow) {
  const tz = tzOf(c, w);
  const fmt = (zone: string) => at.toLocaleString("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const theirs = fmt(tz);
  const mine = myTz();
  return tz === mine ? theirs : `${theirs} (${at.toLocaleTimeString("en-US", { timeZone: mine, hour: "numeric", minute: "2-digit" })} your time)`;
}

/** The window in words: "9–11 AM their time, weekdays". */
export function windowLabel(w: SendWindow) {
  const h = (x: number) => `${x % 12 || 12}${x < 12 || x === 24 ? " AM" : " PM"}`;
  const range = `${h(w.start).replace(/ (AM|PM)$/, (m) => (h(w.end).endsWith(m.trim()) ? "" : m))}–${h(w.end)}`;
  return `${range} ${w.basis === "recipient" ? "their time" : "your time"}, ${daysLabel(w.days)}`;
}

/** One person's next slot (for labels); the real batch plan comes from `planSends`. */
export function nextSendSlot(c: Pick<Contact, "id" | "region" | "location">, w: SendWindow, now = new Date()) {
  const at = planSends([c], w, { now, jitter: () => 0 }).get(c.id) ?? new Date(now.getTime() + 86_400_000);
  return { at, label: sendLabelFor(at, c, w) };
}

/* ---------------- batch scheduling with overrides ---------------- */

export interface BatchOptions {
  /** keep = each email's current day; date = everyone on this date; auto = the next allowed day in your window. */
  day: { mode: "keep" | "date" | "auto"; date?: string };
  /** keep = each email's current time of day; spread = from `start` to `end`, `gap` minutes apart; exact = everyone at `at` (+gap each). */
  time: { mode: "keep" | "spread" | "exact"; start?: number; end?: number; at?: number };
  basis: "recipient" | "mine";
  /** Minutes between sends in the same zone on the same day (0 = all at once). */
  gap: number;
}

export interface BatchPlan {
  at: Date;
  /** Their zone (or yours) for display. */
  tz: string;
  warn?: string;
}

const ymdOf = (d: Date, tz: string) => {
  const p = partsIn(d, tz);
  return { y: p.y, m: p.m, d: p.d, wd: WD.indexOf(p.wd), h: p.h, min: p.min };
};

/**
 * New send times for a batch, with you overriding the day and/or time. Unlike `planSends`, a day you pick is never moved:
 * if the spread runs past `end`, the extra sends keep going later that day (and say so) instead of rolling to another day.
 * `current` = each person's queued time, for "keep".
 */
export function planBatch<C extends Pick<Contact, "id" | "region" | "location">>(
  people: C[],
  opts: BatchOptions,
  w: SendWindow,
  current: Map<string, Date>,
  now = new Date(),
  notBefore?: (c: C) => Date | undefined,
): Map<string, BatchPlan> {
  const mine = myTz();
  const out = new Map<string, BatchPlan>();
  const autoPlan = opts.day.mode === "auto" ? planSends(people, { ...w, basis: opts.basis }, { now, jitter: () => 0, notBefore }) : new Map<string, Date>();
  const counts = new Map<string, number>();
  for (const c of people) {
    const tz = opts.basis === "recipient" ? recipientTz(c) : mine;
    const cur = current.get(c.id);
    // The day.
    let day: { y: number; m: number; d: number };
    if (opts.day.mode === "date" && opts.day.date) {
      const [y, m, d] = opts.day.date.split("-").map(Number);
      day = { y, m, d };
    } else if (opts.day.mode === "keep" && cur) day = ymdOf(cur, tz);
    else day = ymdOf(autoPlan.get(c.id) ?? planSends([c], { ...w, basis: opts.basis }, { now, jitter: () => 0, notBefore }).get(c.id) ?? now, tz);
    // The time.
    const key = `${tz}|${day.y}-${day.m}-${day.d}`;
    const i = counts.get(key) ?? 0;
    counts.set(key, i + 1);
    let minutes: number;
    let warn: string | undefined;
    if (opts.time.mode === "keep" && cur) {
      const t = ymdOf(cur, tz);
      minutes = t.h * 60 + t.min;
    } else if (opts.time.mode === "exact" && opts.time.at !== undefined) {
      minutes = opts.time.at + i * opts.gap;
    } else {
      const start = opts.time.start ?? w.start * 60;
      const end = opts.time.end ?? w.end * 60;
      minutes = start + i * opts.gap;
      if (minutes >= end) warn = `past ${Math.floor(end / 60) % 12 || 12}${end % 60 ? `:${String(end % 60).padStart(2, "0")}` : ""}${end < 720 ? " AM" : " PM"} (too many for the window at this spacing)`;
    }
    const at = zonedDate(day.y, day.m, day.d, Math.floor(minutes / 60), minutes % 60, tz);
    if (at.getTime() < now.getTime() + 5 * 60_000) warn = "that time has already passed";
    const wd = ymdOf(at, tz).wd;
    if (!warn && opts.day.mode !== "auto" && !w.days.includes(wd)) warn = `${WD[wd]} is outside your usual days (${daysLabel(w.days)})`;
    const nb = notBefore?.(c);
    if (!warn && nb && dayNum(at, tz) < dayNum(nb, tz)) {
      const early = Math.max(1, Math.ceil((nb.getTime() - at.getTime()) / 86_400_000));
      warn = `too soon: ${early} day${early > 1 ? "s" : ""} before the follow-up spacing allows (due ${nb.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "numeric", day: "numeric" })})`;
    }
    out.set(c.id, { at, tz, warn });
  }
  return out;
}
