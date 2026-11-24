import { canonBank } from "./banks";
import { nextAction } from "./followups";
import { isEngaged, lastFromYou, todoFor, type TodoKind } from "./thinkAbout";
import type { ScheduledRow } from "./scheduledRows";
import type { BankMeta, Contact, Settings } from "./types";

/**
 * The Overview tabs on Cold outreach and Warm follow-ups (owner, 2026-11-23: "list each bank and how many people I
 * need to follow up with so I know what is contributing to the 74 outstanding"; "lists out everyone at each bank so I
 * know who to email over Thanksgiving"; a calendar with green / red days). Pure, so the numbers can be checked
 * (`npm run check:followups`) and the nav badge and the overview can never disagree.
 */

type FollowUp = Settings["followUp"];
type Banks = Record<string, BankMeta | undefined>;
const metaOf = (banks: Banks, c: Contact) => banks[`${c.bank}|${c.region}`];

/**
 * The Cold outreach count in the nav = the Due list: follow-ups (and move-ons) due now, NOT the ones that went cold
 * (more than a week overdue; they sit in "Went cold" and used to inflate this number).
 */
export function coldDueCount(contacts: Contact[], banks: Banks, fu: FollowUp): number {
  return contacts.filter((c) => {
    const a = nextAction(c, fu, metaOf(banks, c));
    return a.isDue && !a.stale && !a.unknownDate && (a.kind === "follow_up" || a.kind === "move_on");
  }).length;
}

export interface ColdBankRow {
  key: string;
  bank: string;
  due: number;
  drafted: number;
  scheduled: number;
  cold: number;
  total: number;
}
type Totals = Omit<ColdBankRow, "key" | "bank">;

export function coldByBank(contacts: Contact[], banks: Banks, fu: FollowUp, scheduled: ScheduledRow[]): { rows: ColdBankRow[]; totals: Totals } {
  const by = new Map<string, ColdBankRow>();
  const row = (bank: string) => {
    const key = canonBank(bank || "Unknown") || "unknown";
    let r = by.get(key);
    if (!r) by.set(key, (r = { key, bank: bank || "Unknown", due: 0, drafted: 0, scheduled: 0, cold: 0, total: 0 }));
    return r;
  };
  for (const c of contacts) {
    const a = nextAction(c, fu, metaOf(banks, c));
    if (!a.isDue || a.unknownDate) continue;
    if ((a.kind === "follow_up" || a.kind === "move_on") && !a.stale) row(c.bank).due++;
    else if ((a.kind === "follow_up" || a.kind === "move_on") && a.stale) row(c.bank).cold++;
    else if (a.kind === "send") row(c.bank).drafted++;
  }
  for (const s of scheduled) if (s.contact) row(s.contact.bank).scheduled++;
  const rows = [...by.values()].map((r) => ({ ...r, total: r.due + r.drafted + r.scheduled + r.cold }));
  rows.sort((a, b) => b.due - a.due || b.total - a.total || a.bank.localeCompare(b.bank));
  const totals: Totals = { due: 0, drafted: 0, scheduled: 0, cold: 0, total: 0 };
  for (const r of rows) for (const k of ["due", "drafted", "scheduled", "cold", "total"] as const) totals[k] += r[k];
  return { rows, totals };
}

/* ---- Calendar ---- */

/** Local day "YYYY-MM-DD". */
export const dayKey = (d: Date | string) => {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export interface CalDay {
  /** You emailed them that day and they haven't written since. */
  green: Contact[];
  /** They wrote that day and you haven't answered. */
  red: Contact[];
}

/** Moved on, done, bounced, left: nothing to wait for. */
const outOfPlay = (c: Contact) => c.status === "ignored" || c.status === "done" || (!!c.outcome && c.outcome.kind !== "no_reply");

/** Every day you emailed them (Gmail's conversation, the outreach dates, server follow-ups). */
function yourEmailDays(c: Contact): string[] {
  const at = [c.sentAt, c.lastTouchAt, c.lastEmailedAt, ...(c.followUpLog ?? []).map((f) => f.at), ...(c.mail?.messages ?? []).filter((m) => m.dir === "out").map((m) => m.at)];
  return at.filter((x): x is string => !!x);
}

/** The calendar for the month that `monthStart` falls in (and a week either side, for the grid's edge days). */
export function calendarDays(contacts: Contact[], monthStart: Date, now = Date.now()): Map<string, CalDay> {
  const from = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - 7).getTime();
  const to = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 8).getTime();
  const out = new Map<string, CalDay>();
  const cell = (k: string) => {
    let d = out.get(k);
    if (!d) out.set(k, (d = { green: [], red: [] }));
    return d;
  };
  const inRange = (iso: string) => {
    const t = Date.parse(iso);
    return t >= from && t < to && t <= now;
  };
  for (const c of contacts) {
    if (!outOfPlay(c)) {
      const heard = [c.lastHeardAt, c.repliedAt].filter((x): x is string => !!x).sort().pop();
      const days = new Set<string>();
      for (const at of yourEmailDays(c)) if (inRange(at) && !(heard && heard > at)) days.add(dayKey(at));
      for (const k of days) cell(k).green.push(c);
    }
    const t = todoFor(c, now);
    if (t?.kind === "reply" && !t.hidden && inRange(t.at)) cell(dayKey(t.at)).red.push(c);
  }
  return out;
}

/* ---- Warm overview ---- */

export interface WarmPerson {
  c: Contact;
  /** How you know them: "Chat 10/14 · Replied 10/2", "Referred you". */
  how: string;
  /** Last email either way. */
  lastAt?: string;
  /** What you owe them now, if anything. */
  owed?: TodoKind;
}

const md = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function howYouKnow(c: Contact): string {
  const parts: string[] = [];
  if (c.referral) parts.push("Referred you");
  const chats = (c.chats ?? []).map((x) => x.at).filter(Boolean).sort();
  if (chats.length) parts.push(`Chat ${md(chats[chats.length - 1])}`);
  else if (c.call?.at) parts.push(`${Date.parse(c.call.at) > Date.now() ? "Call booked" : "Call"} ${md(c.call.at)}`);
  if (c.metAt?.length) parts.push(`Met at a session ${md(c.metAt[c.metAt.length - 1].at)}`);
  if (c.referredBy) parts.push(`Intro from ${c.referredBy.name}`);
  const replied = c.lastHeardAt ?? c.repliedAt;
  if (replied) parts.push(`Wrote ${md(replied)}`);
  return parts.slice(0, 2).join(" · ") || "In touch";
}

export function warmByBank(contacts: Contact[], now = Date.now()): { key: string; bank: string; people: WarmPerson[] }[] {
  const by = new Map<string, { key: string; bank: string; people: WarmPerson[] }>();
  for (const c of contacts) {
    if (!isEngaged(c) || c.status === "done" || (c.outcome && c.outcome.kind !== "no_reply")) continue;
    const key = canonBank(c.bank || "Unknown") || "unknown";
    let g = by.get(key);
    if (!g) by.set(key, (g = { key, bank: c.bank || "Unknown", people: [] }));
    const t = todoFor(c, now);
    const owed = t && !t.hidden && Date.parse(t.due) <= now ? t.kind : undefined;
    const lastAt = [lastFromYou(c), c.lastHeardAt].filter((x): x is string => !!x).sort().pop();
    g.people.push({ c, how: howYouKnow(c), lastAt, owed });
  }
  const groups = [...by.values()];
  for (const g of groups) g.people.sort((a, b) => (a.lastAt ?? "").localeCompare(b.lastAt ?? ""));
  const owedIn = (g: { people: WarmPerson[] }) => g.people.filter((p) => p.owed).length;
  return groups.sort((a, b) => owedIn(b) - owedIn(a) || b.people.length - a.people.length || a.bank.localeCompare(b.bank));
}
