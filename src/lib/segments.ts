import type { Contact, EmailFont, Experiment, Region, Settings, Template } from "./types";
import { EMAIL_FONTS, regionInfo } from "./types";
import { STARTER_TARGETS, canonBank, type TargetBank } from "./banks";
import { hooksOf } from "./hooks";
import { fillPlaceholders } from "./template";
import { ORIGINAL_BASE } from "./defaults";
import { gotReply, wasSent } from "./experiments";

/**
 * Slicing outreach results: "compare by" a dimension (font, send time, wording…) and "split by" a segment (bank type,
 * team, location). Everything is derived from what's already recorded, so emails sent before tracking started are
 * tagged automatically where possible (send time from Gmail, template/hook/wording from the draft text).
 */

/* ---------------- segments ---------------- */

export type Segment = "none" | "tier" | "team" | "region";
export const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "none", label: "Everyone" },
  { id: "tier", label: "Bank type" },
  { id: "team", label: "Team" },
  { id: "region", label: "Location" },
];

const TIER_SHORT: Record<string, string> = {
  "Bulge Bracket": "Bulge bracket",
  "Elite Boutique": "Elite boutique",
  "Middle Market": "Middle market",
  "Investment Bank": "Boutique / other bank",
  "Private Equity": "Private equity",
};

/** Bank → tier, from the workbook's target lists, banks added on Bank coverage, then the built-in list. */
export function tierIndex(targets: TargetBank[], added: TargetBank[]) {
  const m = new Map<string, string>();
  for (const t of [...targets, ...added, ...STARTER_TARGETS]) {
    const k = canonBank(t.name);
    if (t.tier && !m.has(k)) m.set(k, t.tier);
  }
  return m;
}

export function segmentOf(c: Contact, seg: Segment, tiers: Map<string, string>): string {
  if (seg === "tier") {
    const t = tiers.get(canonBank(c.bank));
    return t ? (TIER_SHORT[t] ?? t) : "Tier unknown";
  }
  if (seg === "team") return c.team?.trim() || "Team not set";
  if (seg === "region") return regionInfo(c.region).label;
  return "Everyone";
}

/* ---------------- send time, in the recipient's time zone ---------------- */

const TZ: Partial<Record<Region, string>> = { NY: "America/New_York", CHI: "America/Chicago", SF: "America/Los_Angeles", LA: "America/Los_Angeles" };

/** Hour (0–23) and weekday when an email landed, in the recipient's local time (their region), else the viewer's. */
export function localTime(iso: string, region: Region) {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ[region], hour: "numeric", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return { hour: Number(parts.hour) % 24, day: parts.weekday as string };
}

export const TIME_BUCKETS = [
  { id: "t0", label: "Before 8am", from: 0, to: 8 },
  { id: "t8", label: "8–10am", from: 8, to: 10 },
  { id: "t10", label: "10am–12pm", from: 10, to: 12 },
  { id: "t12", label: "12–2pm", from: 12, to: 14 },
  { id: "t14", label: "2–5pm", from: 14, to: 17 },
  { id: "t17", label: "5–8pm", from: 17, to: 20 },
  { id: "t20", label: "After 8pm", from: 20, to: 24 },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Windows offered for send-time experiments (recipient's local time). */
export const TIME_WINDOWS = [
  { label: "7–9am", from: 7, to: 9 },
  { label: "9–11am", from: 9, to: 11 },
  { label: "12–2pm", from: 12, to: 14 },
  { label: "3–5pm", from: 15, to: 17 },
  { label: "6–8pm", from: 18, to: 20 },
  { label: "8–10pm", from: 20, to: 22 },
];

/* ---------------- dimensions ---------------- */

export type Dimension = "font" | "time" | "day" | "wording" | "template" | "hook" | `exp:${string}`;

export interface DimCtx {
  settings: Settings;
  templates: Template[];
}

export function dimensions(s: Settings): { id: Dimension; label: string }[] {
  return [
    { id: "font", label: "Font" },
    { id: "time", label: "Send time" },
    { id: "day", label: "Day sent" },
    { id: "hook", label: "Hook" },
    { id: "template", label: "Template" },
    { id: "wording", label: "Shared wording" },
    ...(s.experiments ?? []).map((e) => ({ id: `exp:${e.id}` as Dimension, label: `Experiment: ${e.name}` })),
  ];
}

const fontLabel = (f: EmailFont) => EMAIL_FONTS[f]?.label.split(" (")[0] ?? f;

/** Which hook an email used: recorded on the draft, else found in the draft text, else none. */
export function hookUsed(c: Contact, s: Settings) {
  const hooks = hooksOf(s);
  const recorded = c.draftMeta?.hookId && hooks.find((h) => h.id === c.draftMeta!.hookId);
  if (recorded) return recorded;
  if (!c.draft?.body) return undefined;
  const body = c.draft.body.replace(/\s+/g, " ");
  return hooks.find((h) => h.text.trim() && body.includes(h.text.trim().replace(/\s+/g, " "))) ?? hooks.find((h) => h.fallback);
}

/** Which shared-wording version: recorded, else the one whose ask appears in the draft. */
function wordingUsed(c: Contact, s: Settings) {
  const bases = s.emailBases?.length ? s.emailBases : [ORIGINAL_BASE];
  const recorded = c.draftMeta?.baseId && bases.find((b) => b.id === c.draftMeta!.baseId);
  if (recorded) return recorded;
  if (!c.draft?.body) return undefined;
  const body = c.draft.body.replace(/\s+/g, " ");
  return bases.find((b) => b.ask.trim() && body.includes(fillPlaceholders(b.ask, c, s, {}, b).replace(/\s+/g, " ").slice(0, 60)));
}

/** The value of a dimension for one sent email ({key, label}), or undefined if it can't be told. */
export function dimensionOf(c: Contact, dim: Dimension, ctx: DimCtx): { key: string; label: string } | undefined {
  const s = ctx.settings;
  if (dim === "font") return c.trial?.font ? { key: c.trial.font, label: fontLabel(c.trial.font) } : undefined;
  if (dim === "time" || dim === "day") {
    if (!c.sentAt) return undefined;
    const { hour, day } = localTime(c.sentAt, c.region);
    if (dim === "day") return { key: day, label: day };
    const b = TIME_BUCKETS.find((x) => hour >= x.from && hour < x.to)!;
    return { key: b.id, label: b.label };
  }
  if (dim === "hook") {
    const h = hookUsed(c, s);
    return h ? { key: h.id, label: h.name } : undefined;
  }
  if (dim === "template") {
    const id = c.draftMeta?.templateId ?? c.templateId;
    const t = id ? ctx.templates.find((x) => x.id === id) : undefined;
    return t ? { key: t.id, label: t.name } : undefined;
  }
  if (dim === "wording") {
    const b = wordingUsed(c, s);
    return b ? { key: b.id, label: b.name } : undefined;
  }
  const e = (s.experiments ?? []).find((x) => `exp:${x.id}` === dim);
  return e ? experimentArmOf(c, e) : undefined;
}

/**
 * Which arm of an experiment an email belongs to. Send-time experiments are tagged automatically from when the email
 * actually went out (so emails sent before the experiment count too); the others from the draft's recorded arm.
 */
export function experimentArmOf(c: Contact, e: Experiment): { key: string; label: string } | undefined {
  if (e.kind === "time") {
    if (!c.sentAt) return undefined;
    const { hour } = localTime(c.sentAt, c.region);
    const a = e.arms.find((x) => x.from !== undefined && x.to !== undefined && hour >= x.from && hour < x.to);
    return a ? { key: a.id, label: a.label } : { key: "_outside", label: "Outside these windows" };
  }
  const id = c.trial?.arms[e.id];
  const a = id ? e.arms.find((x) => x.id === id) : undefined;
  return a ? { key: a.id, label: a.label } : undefined;
}

/* ---------------- cross-tab ---------------- */

export interface Cell {
  sent: number;
  replied: number;
}

/** Reply counts for every (segment value × dimension value) among sent emails. */
export function crossTab(contacts: Contact[], dim: Dimension, seg: Segment, ctx: DimCtx, tiers: Map<string, string>) {
  const cols = new Map<string, string>();
  const rows = new Map<string, Map<string, Cell>>();
  const totals = new Map<string, Cell>();
  let untagged = 0;
  const order = dim === "day" ? DAYS : dim === "time" ? TIME_BUCKETS.map((b) => b.id) : undefined;
  for (const c of contacts) {
    if (!wasSent(c)) continue;
    const v = dimensionOf(c, dim, ctx);
    if (!v) {
      untagged++;
      continue;
    }
    cols.set(v.key, v.label);
    const r = segmentOf(c, seg, tiers);
    const row = rows.get(r) ?? new Map<string, Cell>();
    for (const [m, key] of [
      [row, v.key],
      [totals, v.key],
    ] as const) {
      const cell = m.get(key) ?? { sent: 0, replied: 0 };
      cell.sent++;
      if (gotReply(c)) cell.replied++;
      m.set(key, cell);
    }
    rows.set(r, row);
  }
  const colList = [...cols.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort(
      (a, b) =>
        Number(a.key === "_outside") - Number(b.key === "_outside") ||
        (order ? order.indexOf(a.key) - order.indexOf(b.key) : (totals.get(b.key)?.sent ?? 0) - (totals.get(a.key)?.sent ?? 0)),
    );
  const rowList = [...rows.entries()]
    .map(([label, cells]) => ({ label, cells, n: [...cells.values()].reduce((x, c) => x + c.sent, 0) }))
    .sort((a, b) => b.n - a.n);
  return { cols: colList, rows: rowList, totals, untagged };
}

/** "Tue 8:42 AM EDT": when an email landed, in the recipient's time zone. */
export function recipientTimeLabel(iso: string, region: Region) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ[region], weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}
