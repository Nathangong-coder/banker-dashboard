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

const GAP_MIN = 6;

/**
 * Send times for a batch, in order: each person gets the first window (today if it's still open, else the next
 * weekday) with a free spot, spots `GAP_MIN` minutes apart (+0–2 min so they don't look machine-timed).
 * `taken` = times already queued for other people, which keep their spots.
 */
export function planSends<C extends Pick<Contact, "id" | "region" | "location">>(people: C[], w: SendWindow, opts: { now?: Date; taken?: Date[]; jitter?: () => number } = {}) {
  const now = opts.now ?? new Date();
  const jitter = opts.jitter ?? (() => Math.floor(Math.random() * 3));
  const mine = myTz();
  const used = new Map<string, number[]>();
  const keyFor = (tz: string, y: number, m: number, d: number) => `${tz}|${y}-${m}-${d}`;
  for (const t of opts.taken ?? [])
    for (const tz of new Set(["America/New_York", "America/Chicago", "America/Los_Angeles", mine])) {
      const p = partsIn(t, tz);
      used.set(keyFor(tz, p.y, p.m, p.d), [...(used.get(keyFor(tz, p.y, p.m, p.d)) ?? []), t.getTime()]);
    }
  const out = new Map<string, Date>();
  const earliest = now.getTime() + 10 * 60_000;
  for (const c of people) {
    const tz = tzOf(c, w, mine);
    const today = partsIn(now, tz);
    for (let add = 0; add < 21; add++) {
      const day = partsIn(zonedDate(today.y, today.m, today.d + add, 12, 0, tz), tz);
      if (!w.days.includes(WD.indexOf(day.wd))) continue;
      const open = zonedDate(day.y, day.m, day.d, w.start, 0, tz).getTime();
      const close = zonedDate(day.y, day.m, day.d, w.end, 0, tz).getTime();
      const k = keyFor(tz, day.y, day.m, day.d);
      const spots = used.get(k) ?? [];
      let at = Math.max(open, earliest);
      // Next free spot: GAP_MIN after anything already there.
      for (const s of [...spots].sort((a, b) => a - b)) if (Math.abs(s - at) < GAP_MIN * 60_000) at = s + GAP_MIN * 60_000;
      at += jitter() * 60_000;
      if (at >= close) continue;
      out.set(c.id, new Date(at));
      used.set(k, [...spots, at]);
      break;
    }
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
export function planBatch<C extends Pick<Contact, "id" | "region" | "location">>(people: C[], opts: BatchOptions, w: SendWindow, current: Map<string, Date>, now = new Date()): Map<string, BatchPlan> {
  const mine = myTz();
  const out = new Map<string, BatchPlan>();
  const autoPlan = opts.day.mode === "auto" ? planSends(people, { ...w, basis: opts.basis }, { now, jitter: () => 0 }) : new Map<string, Date>();
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
    else day = ymdOf(autoPlan.get(c.id) ?? planSends([c], { ...w, basis: opts.basis }, { now, jitter: () => 0 }).get(c.id) ?? now, tz);
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
    out.set(c.id, { at, tz, warn });
  }
  return out;
}
