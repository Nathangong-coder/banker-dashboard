/**
 * Email open tracking: decide which pixel hits are a real person (pure, no store / fetch / clock).
 * Checks: npm run check:opens
 */
import { wilson } from "./experiments";

export type Net = "apple" | "google-proxy" | "microsoft" | "scanner" | "other";
export interface RawHit {
  id: string;
  at: string;
  ua: string;
  city?: string;
  country?: string;
  ipHash: string;
  net: Net;
}
export type HitLabel = "person" | "scanner" | "apple-privacy" | "you";
export type TrackedKind = "first" | "follow-up" | "thank-you" | "reply" | "gmail";
export interface TrackedMessage {
  id: string;
  to: string[];
  subject: string;
  kind: TrackedKind;
  step?: number;
  contactId?: string;
  createdAt: string;
  sentAt?: string;
  gmailDraftId?: string;
  threadId?: string;
  source: "coverage" | "gmail" | "claude";
  hits: RawHit[];
  /** ISO times the owner had this message on screen. */
  seen: string[];
}
type Mx = Record<string, "google" | "other">;

// reviewed 2026-10
const NETS = {
  apple: ["17.0.0.0/8"],
  // Exchange Online mail ranges: 40.92-40.107.x and 52.100-52.103.x
  microsoft: ["40.92.0.0/14", "40.96.0.0/13", "40.104.0.0/14", "52.100.0.0/14"],
  // Proofpoint, Mimecast
  scanner: ["148.163.128.0/19", "67.231.144.0/20", "205.139.110.0/24", "207.211.30.0/24", "170.10.128.0/21"],
};
const BROWSER_TOKEN = /Mozilla\/|Outlook|Thunderbird|Airmail|Spark|AppleMail|Mail\//i;

function ipv4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
function inRanges(ip: string, cidrs: string[]): boolean {
  const n = ipv4(ip);
  if (n === null) return false;
  return cidrs.some((c) => {
    const [base, bits] = c.split("/");
    const b = ipv4(base)!;
    const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return ((n & mask) >>> 0) === ((b & mask) >>> 0);
  });
}

export function netOf(ip: string, ua: string): Net {
  if (inRanges(ip, NETS.apple)) return "apple";
  if (/GoogleImageProxy/i.test(ua)) return "google-proxy";
  if (inRanges(ip, NETS.microsoft)) return "microsoft";
  if (inRanges(ip, NETS.scanner)) return "scanner";
  if (!BROWSER_TOKEN.test(ua)) return "scanner";
  return "other";
}

export function clientOf(ua: string): { family: "outlook" | "gmail" | "apple-mail" | "other"; device: "phone" | "desktop" | "unknown" } {
  const family = /Outlook/i.test(ua)
    ? "outlook"
    : /GoogleImageProxy/i.test(ua)
      ? "gmail"
      : /(iPhone|iPad|Macintosh).*AppleWebKit/i.test(ua) && !/Safari|Version\//i.test(ua)
        ? "apple-mail"
        : "other";
  const device = /iPhone|iPad|Android|Mobile|iOS/i.test(ua) ? "phone" : /Windows|Macintosh|X11|Linux/i.test(ua) ? "desktop" : "unknown";
  return { family, device };
}

const ms = (iso: string) => Date.parse(iso);

export function labelHits(m: TrackedMessage, mx: Mx): { hit: RawHit; label: HitLabel }[] {
  const hits = m.hits.filter((h) => !Number.isNaN(Date.parse(h.at))).sort((a, b) => ms(a.at) - ms(b.at));
  const sentRaw = m.sentAt ? ms(m.sentAt) : undefined;
  const sent = sentRaw !== undefined && !Number.isNaN(sentRaw) ? sentRaw : undefined;
  const seen = m.seen.map(ms).filter((t) => !Number.isNaN(t));
  const domains = m.to.map((a) => a.split("@")[1]?.toLowerCase()).filter(Boolean) as string[];
  const allOther = domains.length > 0 && domains.every((d) => mx[d] === "other");
  const inSeen = (h: RawHit) => seen.some((s) => Math.abs(ms(h.at) - s) <= 120_000);
  const youIps = new Set(hits.filter(inSeen).map((h) => h.ipHash));

  const base: { hit: RawHit; label: HitLabel | null }[] = hits.map((hit) => {
    const t = ms(hit.at);
    if (inSeen(hit)) return { hit, label: "you" };
    if (sent !== undefined && t <= sent) return { hit, label: "you" };
    if (sent === undefined && youIps.has(hit.ipHash)) return { hit, label: "you" };
    if (hit.net === "google-proxy" && allOther) return { hit, label: "you" };
    if (hit.net === "apple") return { hit, label: "apple-privacy" };
    if (hit.net === "microsoft" || hit.net === "scanner") return { hit, label: "scanner" };
    if (sent !== undefined && t - sent <= 60_000) return { hit, label: "scanner" };
    return { hit, label: null };
  });

  // two or more remaining hits within 2 s of each other are a scanner burst
  const rest = base.filter((b) => b.label === null);
  for (let i = 0; i < rest.length; i++) {
    const near = (j: number) => j >= 0 && j < rest.length && Math.abs(ms(rest[i].hit.at) - ms(rest[j].hit.at)) <= 2000;
    if (near(i - 1) || near(i + 1)) rest[i].label = "scanner";
  }

  // one entry per run of scanner hits closer than 2 s
  const out: { hit: RawHit; label: HitLabel }[] = [];
  let lastScanner: number | undefined;
  for (const b of base) {
    const label = b.label ?? "person";
    if (label === "scanner") {
      const t = ms(b.hit.at);
      if (lastScanner !== undefined && t - lastScanner <= 2000) {
        lastScanner = t;
        continue;
      }
      lastScanner = t;
    }
    out.push({ hit: b.hit, label });
  }
  return out;
}

export function openSummary(m: TrackedMessage, mx: Mx): { opens: number; firstAt?: string; lastAt?: string; forwarded: boolean; lastClient?: string; lastCity?: string } {
  const people = labelHits(m, mx).filter((l) => l.label === "person").map((l) => l.hit);
  if (!people.length) return { opens: 0, forwarded: false };
  const first = people[0];
  const fc = clientOf(first.ua).family;
  const forwarded = people.slice(1).some((h) => {
    if (first.country && h.country && first.country !== h.country) return true;
    return !!(first.city && h.city && first.city !== h.city && clientOf(h.ua).family !== fc);
  });
  const last = people[people.length - 1];
  return { opens: people.length, firstAt: first.at, lastAt: last.at, forwarded, lastClient: clientOf(last.ua).family, lastCity: last.city };
}

/** Only messages with a sentAt count as sent; stubs that were never sent are ignored. */
export function openRate(ms_: TrackedMessage[], mx: Mx): { sent: number; opened: number; low: number; high: number } {
  const sentMsgs = ms_.filter((m) => !!m.sentAt);
  const sent = sentMsgs.length;
  const opened = sentMsgs.filter((m) => openSummary(m, mx).opens > 0).length;
  const { lo, hi } = wilson(opened, sent);
  return { sent, opened, low: lo, high: hi };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function readingHeatmap(ms_: TrackedMessage[], mx: Mx, tzOf: (m: TrackedMessage) => string): number[][] {
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const fmts = new Map<string, Intl.DateTimeFormat>();
  for (const m of ms_) {
    const tz = tzOf(m);
    let f = fmts.get(tz);
    if (!f) {
      const make = (timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" });
      try {
        f = make(tz);
      } catch {
        f = make("UTC");
      }
      fmts.set(tz, f);
    }
    for (const { hit, label } of labelHits(m, mx)) {
      if (label !== "person") continue;
      const parts = f.formatToParts(new Date(hit.at));
      const d = DAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
      const h = Number(parts.find((p) => p.type === "hour")?.value) % 24;
      if (d >= 0 && Number.isFinite(h)) heat[d][h]++;
    }
  }
  return heat;
}

/** Hits kept per tracked email: the first ones (when it was opened) and the latest ones (still being read). */
export const HITS_FIRST = 50;
export const HITS_LAST = 150;
/** Caps a time-sorted hit list (a replayed pixel URL can't grow the synced doc without limit). */
export function capHits(hits: RawHit[]): RawHit[] {
  if (hits.length <= HITS_FIRST + HITS_LAST) return hits;
  return [...hits.slice(0, HITS_FIRST), ...hits.slice(-HITS_LAST)];
}

/**
 * In-memory limiter for the pixel route: at most `limit` stored hits per id per window, per server instance. Costs no
 * Redis; a replayed URL still gets the same GIF, it just isn't recorded again. `now` is for checks.
 */
export function hitThrottle(limit = 20, windowMs = 10 * 60_000, maxIds = 5000) {
  const seen = new Map<string, { start: number; n: number }>();
  return (id: string, now = Date.now()): boolean => {
    const cur = seen.get(id);
    if (!cur || now - cur.start >= windowMs) {
      if (!cur && seen.size >= maxIds) {
        for (const [k, v] of seen) if (now - v.start >= windowMs) seen.delete(k);
        if (seen.size >= maxIds) seen.delete(seen.keys().next().value as string);
      }
      seen.set(id, { start: now, n: 1 });
      return true;
    }
    if (cur.n >= limit) return false;
    cur.n++;
    return true;
  };
}

/**
 * In-memory collapse for the pixel route, keyed by email + reader (`id|ipHash`): the same reader opening the same
 * email again within `windowMs` is one open, not several (no Redis cost). Hits within `burstMs` of the reader's
 * first one still pass, so a scanner's burst keeps the 2-second signal `labelHits` relies on. `now` is for checks.
 */
export function repeatGate(windowMs = 30 * 60_000, burstMs = 10_000, maxKeys = 5000) {
  const first = new Map<string, number>();
  return (key: string, now = Date.now()): boolean => {
    const at = first.get(key);
    if (at !== undefined && now - at < windowMs) return now - at <= burstMs;
    if (at === undefined && first.size >= maxKeys) {
      for (const [k, v] of first) if (now - v >= windowMs) first.delete(k);
      if (first.size >= maxKeys) first.delete(first.keys().next().value as string);
    }
    first.set(key, now);
    return true;
  };
}
