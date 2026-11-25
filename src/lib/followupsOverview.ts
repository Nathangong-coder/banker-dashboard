import { canonBank } from "./banks";
import { nextAction } from "./followups";
import { isEngaged, lastFromYou, queuedFor, todoFor, type TodoKind } from "./thinkAbout";
import { chatRecords } from "./chatEvidence";
import { teamOf } from "./locationTeam";
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

/**
 * The calendar for the month that `monthStart` falls in (and a week either side, for the grid's edge days).
 * - cold (owner, 2026-11-24: "each date only has the most recent email sent to them / unaddressed email in that
 *   chain"): green = your LATEST email to someone who hasn't written since; red = their latest email you haven't answered.
 * - warm: green = days you had a chat (logged, a call, a confirmed meeting); red = a chat you haven't followed up on
 *   (thank-you owed) or a conversation that needs a check-in, on that chat's day (else your last email's).
 */
export function calendarDays(contacts: Contact[], monthStart: Date, now = Date.now(), mode: "cold" | "warm" = "cold"): Map<string, CalDay> {
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
    const t = todoFor(c, now);
    if (mode === "cold") {
      if (!outOfPlay(c)) {
        const heard = [c.lastHeardAt, c.repliedAt].filter((x): x is string => !!x).sort().pop();
        const last = yourEmailDays(c).filter((x) => Date.parse(x) <= now).sort().pop();
        if (last && inRange(last) && !(heard && heard > last)) cell(dayKey(last)).green.push(c);
      }
      if (t?.kind === "reply" && !t.hidden && inRange(t.at)) cell(dayKey(t.at)).red.push(c);
      continue;
    }
    const chats = chatRecords(c, now).filter((r) => r.state !== "rejected" && r.state !== "check");
    const days = new Set(chats.map((r) => dayKey(r.at)).filter((k) => chats.some((r) => dayKey(r.at) === k && inRange(r.at))));
    for (const k of days) cell(k).green.push(c);
    if (t && !t.hidden && (t.kind === "thank" || t.kind === "check_in" || t.kind === "quiet") && Date.parse(t.due) <= now) {
      const anchor = chats.map((r) => r.at).sort().pop() ?? t.at;
      if (inRange(anchor)) cell(dayKey(anchor)).red.push(c);
    }
  }
  return out;
}

/* ---- Cold by bank: office · team → who you emailed and where each stands ---- */

export interface ColdPerson {
  c: Contact;
  /** "Follow-up #2 sent 11/24", "Replied 11/20", "Scheduled Tue 11/25", "Emailed 11/17". */
  state: string;
  /** The date that state is from (sorting). */
  at: string;
  tone: "waiting" | "replied" | "scheduled" | "done";
}
export interface ColdBank {
  key: string;
  bank: string;
  emailed: number;
  waiting: number;
  replied: number;
  lastAt: string;
  teams: { label: string; people: ColdPerson[] }[];
}

/** Everyone you've emailed, by bank → office · team (like Bank coverage's expanded rows). */
export function coldBankPeople(contacts: Contact[], now = Date.now()): ColdBank[] {
  const by = new Map<string, ColdBank & { byTeam: Map<string, ColdPerson[]> }>();
  for (const c of contacts) {
    const last = yourEmailDays(c).filter((x) => Date.parse(x) <= now).sort().pop();
    const queued = queuedFor(c, now);
    if (!last && !queued) continue;
    const heard = [c.lastHeardAt, c.repliedAt].filter((x): x is string => !!x).sort().pop();
    let p: ColdPerson;
    if (queued) p = { c, state: `Scheduled ${md(queued)}`, at: queued, tone: "scheduled" };
    else if (heard && (!last || heard > last)) p = { c, state: `Replied ${md(heard)}`, at: heard, tone: "replied" };
    else if (outOfPlay(c)) p = { c, state: `Moved on · last email ${md(last!)}`, at: last!, tone: "done" };
    else if (c.followUps > 0) p = { c, state: `Follow-up #${c.followUps} sent ${md(last!)}`, at: last!, tone: "waiting" };
    else p = { c, state: `Emailed ${md(last!)}`, at: last!, tone: heard ? "replied" : "waiting" };
    const key = canonBank(c.bank || "Unknown") || "unknown";
    let b = by.get(key);
    if (!b) by.set(key, (b = { key, bank: c.bank || "Unknown", emailed: 0, waiting: 0, replied: 0, lastAt: "", teams: [], byTeam: new Map() }));
    b.emailed++;
    if (p.tone === "waiting") b.waiting++;
    if (heard) b.replied++;
    if (p.at > b.lastAt) b.lastAt = p.at;
    const team = teamOf(c);
    const label = [c.region !== "Other" ? c.region : c.location || "", team || "Team unknown"].filter(Boolean).join(" · ");
    b.byTeam.set(label, [...(b.byTeam.get(label) ?? []), p]);
  }
  return [...by.values()]
    .map(({ byTeam, ...b }) => ({
      ...b,
      teams: [...byTeam.entries()].map(([label, people]) => ({ label, people: people.sort((x, y) => y.at.localeCompare(x.at)) })).sort((x, y) => x.label.localeCompare(y.label)),
    }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
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
