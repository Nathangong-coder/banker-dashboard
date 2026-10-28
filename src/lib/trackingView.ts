import { labelHits, openRate, openSummary, type TrackedMessage } from "./opens";
import { tzLabel } from "./availability";
import { recipientTz } from "./sendWindow";
import { lastEmailOf } from "./followups";
import type { Contact } from "./types";

/**
 * What the Email tracking page, the opened badges and the lab show, derived from `state.tracking` (pure: no store, no
 * fetch). Only `person` opens count (lib/opens.ts#labelHits decides).
 */

type Mx = Record<string, "google" | "other">;
export type OpenInfo = ReturnType<typeof openSummary>;

export const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

/** The recipient's zone: their office when they're a contact, else yours. */
export const tzFor = (c: Pick<Contact, "region" | "location"> | undefined) => (c ? recipientTz(c) : myTz());

/** "Tue 9:14 AM ET" in a zone. */
export function whenIn(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).format(d)} ${tzLabel(tz, d)}`;
  } catch {
    // an unknown zone: your own time, labelled
    const mine = myTz();
    return `${new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(d)} ${tzLabel(mine, d)}`;
  }
}

/** "Tue, Oct 27, 9:14 AM PT" in your zone (hover text). */
export const whenMine = (iso: string) => {
  const tz = myTz();
  return `${new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ${tzLabel(tz, new Date(iso))}`;
};

export function kindLabel(m: Pick<TrackedMessage, "kind" | "step">): string {
  if (m.kind === "first") return "First email";
  if (m.kind === "follow-up") return `Follow-up #${m.step ?? 1}`;
  if (m.kind === "thank-you") return "Thank-you";
  if (m.kind === "reply") return "Reply";
  return "Sent from Gmail";
}

/** Did they write back after this email went out? */
export function repliedAfter(m: Pick<TrackedMessage, "sentAt">, c: Pick<Contact, "repliedAt" | "lastHeardAt"> | undefined): boolean {
  if (!m.sentAt || !c) return false;
  const sent = Date.parse(m.sentAt);
  return [c.repliedAt, c.lastHeardAt].some((x) => !!x && Date.parse(x) >= sent);
}

/** Firm for a row: the contact's bank, else the recipient's domain ("gs.com"). */
export function firmOf(m: Pick<TrackedMessage, "to">, c: Pick<Contact, "bank"> | undefined): string {
  if (c?.bank) return c.bank;
  return m.to[0]?.split("@")[1]?.toLowerCase() ?? "";
}

/* ---------------- per-contact index (badges) ---------------- */

const latestCache = new WeakMap<TrackedMessage[], Map<string, TrackedMessage>>();
/** Each contact's most recently sent tracked email. Cached per messages array (the store replaces it on change). */
export function latestByContact(messages: TrackedMessage[]): Map<string, TrackedMessage> {
  const hit = latestCache.get(messages);
  if (hit) return hit;
  const out = new Map<string, TrackedMessage>();
  for (const m of messages) {
    if (!m.contactId || !m.sentAt) continue;
    const prev = out.get(m.contactId);
    if (!prev || Date.parse(m.sentAt) > Date.parse(prev.sentAt!)) out.set(m.contactId, m);
  }
  latestCache.set(messages, out);
  return out;
}

/**
 * The badge for a contact's latest email, or undefined when that email isn't tracked (an untracked email went out
 * after the last tracked one, or nothing tracked was sent).
 */
export function contactOpenBadge(
  c: Contact,
  messages: TrackedMessage[],
  mx: Mx,
): { text: string; title: string; opened: boolean; message: TrackedMessage } | undefined {
  const m = latestByContact(messages).get(c.id);
  if (!m?.sentAt) return undefined;
  const last = lastEmailOf(c);
  if (last && Date.parse(last) > Date.parse(m.sentAt) + 120_000) return undefined;
  const s = openSummary(m, mx);
  const tz = tzFor(c);
  const what = kindLabel(m).toLowerCase();
  if (!s.opens || !s.firstAt) return { text: "Not opened yet", title: `${kindLabel(m)}: no open seen yet. Some mail apps block images, so this isn't proof they didn't read it.`, opened: false, message: m };
  return {
    text: `Opened ${s.opens}× · ${whenIn(s.firstAt, tz)}`,
    title: `Their ${what}: first opened ${whenIn(s.firstAt, tz)}${s.lastAt && s.lastAt !== s.firstAt ? `, last ${whenIn(s.lastAt, tz)}` : ""}${s.forwarded ? " · possibly forwarded" : ""}`,
    opened: true,
    message: m,
  };
}

/* ---------------- table + KPIs ---------------- */

export interface TrackedRow {
  m: TrackedMessage;
  c?: Contact;
  s: OpenInfo;
  firm: string;
  replied: boolean;
  /** Hits that aren't a person (scanner / Apple privacy / you). */
  other: number;
}

export function trackedRows(messages: TrackedMessage[], contacts: Contact[], mx: Mx): TrackedRow[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return messages
    .map((m) => {
      const c = m.contactId ? byId.get(m.contactId) : undefined;
      const labels = labelHits(m, mx);
      return { m, c, s: openSummary(m, mx), firm: firmOf(m, c), replied: repliedAfter(m, c), other: labels.filter((l) => l.label !== "person").length };
    })
    .sort((a, b) => (b.m.sentAt ?? b.m.createdAt).localeCompare(a.m.sentAt ?? a.m.createdAt));
}

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** "3 min" / "4.5 h" / "2 days". */
export function durationLabel(ms?: number): string {
  if (ms === undefined) return "–";
  const min = ms / 60_000;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = min / 60;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export function trackingKpis(rows: TrackedRow[], mx: Mx) {
  const sent = rows.filter((r) => r.m.sentAt);
  const rate = openRate(
    sent.map((r) => r.m),
    mx,
  );
  const toFirst = sent.filter((r) => r.s.firstAt).map((r) => Date.parse(r.s.firstAt!) - Date.parse(r.m.sentAt!)).filter((x) => x >= 0);
  return {
    sent: rate.sent,
    opened: rate.opened,
    share: rate.sent ? rate.opened / rate.sent : undefined,
    replied: sent.filter((r) => r.replied).length,
    medianToOpen: median(toFirst),
    forwarded: sent.filter((r) => r.s.forwarded).length,
  };
}

/* ---------------- insights ---------------- */

export interface RateRow {
  key: string;
  label: string;
  sent: number;
  opened: number;
  low: number;
  high: number;
}

/** Open rate per group of sent tracked emails (groups with no key are left out). */
export function openRateBy(rows: TrackedRow[], mx: Mx, keyOf: (r: TrackedRow) => { key: string; label: string } | undefined, order?: string[]): RateRow[] {
  const groups = new Map<string, { label: string; ms: TrackedMessage[] }>();
  for (const r of rows) {
    if (!r.m.sentAt) continue;
    const k = keyOf(r);
    if (!k) continue;
    const g = groups.get(k.key) ?? { label: k.label, ms: [] };
    g.ms.push(r.m);
    groups.set(k.key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, ...openRate(g.ms, mx) }))
    .sort((a, b) => (order ? order.indexOf(a.key) - order.indexOf(b.key) : b.sent - a.sent));
}

/** Firms where ≥ 3 tracked emails went out and none was ever seen opened: their mail probably blocks images. */
export function silentFirms(rows: TrackedRow[], min = 3): { firm: string; sent: number }[] {
  const by = new Map<string, { sent: number; opened: number }>();
  for (const r of rows) {
    if (!r.m.sentAt || !r.firm) continue;
    const g = by.get(r.firm) ?? { sent: 0, opened: 0 };
    g.sent++;
    if (r.s.opens) g.opened++;
    by.set(r.firm, g);
  }
  return [...by.entries()]
    .filter(([, g]) => g.sent >= min && g.opened === 0)
    .map(([firm, g]) => ({ firm, sent: g.sent }))
    .sort((a, b) => b.sent - a.sent);
}

/** Hour (0–23) and weekday of an instant in a zone. */
export function hourDayIn(iso: string, tz: string): { hour: number; day: string } {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
  } catch {
    f = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", hourCycle: "h23" });
  }
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour) % 24, day: p.weekday as string };
}

/* ---------------- Email lab ---------------- */

const labCache = new WeakMap<TrackedMessage[], { mx: Mx; map: Map<string, boolean> }>();
/**
 * contactId → whether their tracked FIRST email was opened (only contacts whose first email was tracked and sent), for
 * the lab's open-rate line. Cached per messages array + mx.
 */
export function firstEmailOpens(messages: TrackedMessage[], mx: Mx): Map<string, boolean> {
  const hit = labCache.get(messages);
  if (hit && hit.mx === mx) return hit.map;
  const out = new Map<string, boolean>();
  for (const m of messages) {
    if (!m.contactId || !m.sentAt || m.kind !== "first") continue;
    out.set(m.contactId, (out.get(m.contactId) ?? false) || openSummary(m, mx).opens > 0);
  }
  labCache.set(messages, { mx, map: out });
  return out;
}

/** Async results for the detail panel: keep `next` only when it's for the message the panel still shows. */
export function settleFor<T extends { for: string }>(prev: T, next: T): T {
  return prev.for === next.for ? next : prev;
}
