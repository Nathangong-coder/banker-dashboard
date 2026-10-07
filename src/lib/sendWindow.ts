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
  weekdaysOnly: boolean;
}

export const DEFAULT_SEND_WINDOW: SendWindow = { start: 9, end: 11, basis: "recipient", weekdaysOnly: true };

export const windowOf = (s: Pick<Settings, "sendWindow">): SendWindow => ({ ...DEFAULT_SEND_WINDOW, ...(s.sendWindow ?? {}) });

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
      if (w.weekdaysOnly && (day.wd === "Sat" || day.wd === "Sun")) continue;
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
  return `${range} ${w.basis === "recipient" ? "their time" : "your time"}${w.weekdaysOnly ? ", weekdays" : ""}`;
}

/** One person's next slot (for labels); the real batch plan comes from `planSends`. */
export function nextSendSlot(c: Pick<Contact, "id" | "region" | "location">, w: SendWindow, now = new Date()) {
  const at = planSends([c], w, { now, jitter: () => 0 }).get(c.id) ?? new Date(now.getTime() + 86_400_000);
  return { at, label: sendLabelFor(at, c, w) };
}
