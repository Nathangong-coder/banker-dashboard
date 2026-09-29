import type { Contact, EmailBase, EmailFont, Experiment, Settings, Template } from "./types";
import { BASE_PLACEHOLDERS, ORIGINAL_BASE } from "./defaults";

/**
 * Email A/B testing. Each draft records which template and base produced it (`contact.draftMeta`). New drafts go to
 * whichever active base / template variant has been used least, so arms stay balanced, and the reply rate of each arm
 * is compared once enough emails have gone out.
 */

const REPLIED = new Set(["replied", "call_scheduled", "done"]);
export const wasSent = (c: Contact) => !!c.sentAt || ["sent", "followed_up", "replied", "call_scheduled", "done"].includes(c.status);
export const gotReply = (c: Contact) => !!c.repliedAt || REPLIED.has(c.status);

export function activeBases(s: Settings): EmailBase[] {
  const bases = s.emailBases?.length ? s.emailBases : [ORIGINAL_BASE];
  const on = bases.filter((b) => b.active);
  return on.length ? on : [bases[0]];
}

/** Usage so far (drafts made) per base and per template, used to keep test arms balanced. */
export function usageTally(contacts: Contact[]) {
  const base = new Map<string, number>();
  const template = new Map<string, number>();
  for (const c of contacts) {
    if (!c.draftMeta) continue;
    base.set(c.draftMeta.baseId, (base.get(c.draftMeta.baseId) ?? 0) + 1);
    template.set(c.draftMeta.templateId, (template.get(c.draftMeta.templateId) ?? 0) + 1);
  }
  return { base, template };
}

const leastUsed = <T extends { id: string }>(list: T[], tally: Map<string, number>) =>
  [...list].sort((a, b) => (tally.get(a.id) ?? 0) - (tally.get(b.id) ?? 0) || Math.random() - 0.5)[0];

/** Base for the next draft (the least-used active one), and count it. */
export function pickBase(s: Settings, tally: Map<string, number>): EmailBase {
  const b = leastUsed(activeBases(s), tally);
  tally.set(b.id, (tally.get(b.id) ?? 0) + 1);
  return b;
}

/** If the chosen template has A/B variants, use the least-used one of the group, and count it. */
export function pickVariant(t: Template, templates: Template[], tally: Map<string, number>): Template {
  const group = t.variantGroup ? templates.filter((x) => x.variantGroup === t.variantGroup && x.kind === t.kind) : [];
  const pick = group.length > 1 ? leastUsed(group, tally) : t;
  tally.set(pick.id, (tally.get(pick.id) ?? 0) + 1);
  return pick;
}

/* ---------------- results ---------------- */

/** 95% Wilson interval for k successes out of n (honest for small n, unlike ±1.96·√(p(1−p)/n)). */
export function wilson(k: number, n: number) {
  if (!n) return { lo: 0, hi: 0 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

/** Two-sided p-value for "these two reply rates differ" (two-proportion z-test). */
export function twoProportionP(k1: number, n1: number, k2: number, n2: number) {
  if (!n1 || !n2) return 1;
  const p = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return 1;
  const z = Math.abs(k1 / n1 - k2 / n2) / se;
  // Normal tail via the Abramowitz–Stegun erf approximation (plenty for a dashboard).
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  return Math.max(0, Math.min(1, 1 - erf));
}

export interface Arm {
  id: string;
  label: string;
  drafted: number;
  sent: number;
  replied: number;
  rate: number;
  lo: number;
  hi: number;
  /** Median days from first email to reply. */
  medianDays?: number;
}

export function arm(id: string, label: string, list: Contact[]): Arm {
  const sent = list.filter(wasSent);
  const replied = sent.filter(gotReply);
  const days = replied
    .map((c) => (c.repliedAt && c.sentAt ? (Date.parse(c.repliedAt) - Date.parse(c.sentAt)) / 86_400_000 : NaN))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const { lo, hi } = wilson(replied.length, sent.length);
  return {
    id,
    label,
    drafted: list.length,
    sent: sent.length,
    replied: replied.length,
    rate: sent.length ? replied.length / sent.length : 0,
    lo,
    hi,
    medianDays: days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : undefined,
  };
}

/** Reply rates per base (only drafts made since tracking started) and per template (all first emails). */
export function experimentResults(contacts: Contact[], s: Settings, templates: Template[]) {
  const bases = s.emailBases?.length ? s.emailBases : [ORIGINAL_BASE];
  const tracked = contacts.filter((c) => c.draftMeta);
  const byBase = bases.map((b) => arm(b.id, b.name, tracked.filter((c) => c.draftMeta!.baseId === b.id))).filter((a) => a.drafted > 0);
  const byTemplate = templates
    .filter((t) => t.kind === "initial")
    .map((t) => arm(t.id, t.name, contacts.filter((c) => (c.draftMeta?.templateId ?? c.templateId) === t.id)))
    .filter((a) => a.drafted > 0)
    .sort((a, b) => b.sent - a.sent);
  return { byBase, byTemplate, tracked: tracked.length };
}

/** Plain-English read of an A/B comparison, careful not to call a winner early. */
export function verdict(a: Arm, b: Arm, minPerArm = 30): string {
  if (a.sent < minPerArm || b.sent < minPerArm) {
    const need = Math.max(minPerArm - a.sent, minPerArm - b.sent, 0);
    return `Too early to call: ${a.sent} vs ${b.sent} sent. Aim for ${minPerArm}+ each (about ${need} more on the smaller side).`;
  }
  const p = twoProportionP(a.replied, a.sent, b.replied, b.sent);
  const [lead, lag] = a.rate >= b.rate ? [a, b] : [b, a];
  const pts = Math.round((lead.rate - lag.rate) * 100);
  if (p < 0.05) return `${lead.label} is winning: ${Math.round(lead.rate * 100)}% vs ${Math.round(lag.rate * 100)}% replies (+${pts} pts, p=${p.toFixed(3)}). Safe to make it the only active one.`;
  return `${lead.label} leads by ${pts} pts, but that could still be chance (p=${p.toFixed(2)}). Keep both running.`;
}

/* ---------------- base ↔ templates ---------------- */

const flexible = (text: string) =>
  new RegExp(
    text
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+"),
    "g",
  );

/**
 * Swap a template's word-for-word copy of the base (as it was written before bases existed) for the base
 * placeholders, so it follows the Email lab from now on. Reports templates that didn't contain the base text.
 */
export function applyBaseToTemplates(templates: Template[], base: EmailBase = ORIGINAL_BASE) {
  const changed: Template[] = [];
  const untouched: string[] = [];
  for (const t of templates) {
    if (t.kind !== "initial") continue;
    let body = t.body;
    for (const k of ["intro", "ask", "close", "opener"] as const) {
      if (base[k].trim()) body = body.replace(flexible(base[k]), BASE_PLACEHOLDERS[k]);
    }
    if (body !== t.body) changed.push({ ...t, body });
    else if (!/\{\{\s*base_/.test(t.body)) untouched.push(t.name || "Untitled");
  }
  return { changed, untouched };
}

/* ---------------- self-run experiments (fonts, custom) ---------------- */

export const runningExperiments = (s: Settings) => (s.experiments ?? []).filter((e) => e.status === "running");

/** How many drafts each arm of each running experiment already has, for balancing "alternate" experiments. */
export function trialTally(contacts: Contact[]) {
  const t = new Map<string, Map<string, number>>();
  for (const c of contacts)
    for (const [exp, armId] of Object.entries(c.trial?.arms ?? {})) {
      const m = t.get(exp) ?? new Map<string, number>();
      m.set(armId, (m.get(armId) ?? 0) + 1);
      t.set(exp, m);
    }
  return t;
}

/**
 * The font and experiment arms for a Gmail draft. A contact that already has a trial keeps it (updating a draft or
 * sending a follow-up doesn't switch fonts mid-conversation or move them to another arm).
 */
export function assignTrial(c: Contact, s: Settings, tally: Map<string, Map<string, number>>): NonNullable<Contact["trial"]> & { font: EmailFont } {
  if (c.trial?.font) return { ...c.trial, font: c.trial.font };
  let font: EmailFont = s.emailStyle.font;
  const arms: Record<string, string> = { ...(c.trial?.arms ?? {}) };
  for (const e of runningExperiments(s)) {
    if (!e.arms.length || arms[e.id]) continue;
    const counts = tally.get(e.id) ?? new Map<string, number>();
    const a = e.mode === "wave" ? (e.arms.find((x) => x.id === e.currentArm) ?? e.arms[0]) : leastUsed(e.arms, counts);
    counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
    tally.set(e.id, counts);
    arms[e.id] = a.id;
    if (e.kind === "font" && a.font) font = a.font;
  }
  return { at: new Date().toISOString(), font, fontSource: "draft", arms };
}

/** Reply rates per arm of one experiment. */
export function experimentArms(e: Experiment, contacts: Contact[]): Arm[] {
  return e.arms.map((a) => arm(a.id, a.label, contacts.filter((c) => c.trial?.arms[e.id] === a.id)));
}

/** Reply rate by the font emails actually went out in (every tracked Gmail draft, experiment or not). */
export function resultsByFont(contacts: Contact[], labels: Record<string, string>): Arm[] {
  const fonts = [...new Set(contacts.map((c) => c.trial?.font).filter((f): f is EmailFont => !!f))];
  return fonts.map((f) => arm(f, labels[f] ?? f, contacts.filter((c) => c.trial?.font === f))).sort((a, b) => b.sent - a.sent);
}
