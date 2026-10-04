import type { BankMeta, Contact, Region, Settings } from "./types";
import type { ContactTable } from "./workbook";
import { STARTER_TARGETS, canonBank, type Application, type TargetBank } from "./banks";
import { LIVE_STATUSES, nextAction } from "./followups";
import { DAY } from "./util";
import { DEFAULT_OFFICES_PER_BANK, activeDesks, deskOffice, deskStatus, inScope, pickOffices, targetAppliesTo, type DeskStatus, type DeskTarget } from "./desks";
import { applyNote } from "./offices";

export type Bucket = "reached" | "ready" | "cold" | "hidden";

export interface CoverageRow {
  key: string;
  name: string;
  tier?: string;
  bucket: Bucket;
  /** Contacts on the checked desks (every contact at the bank when no desk is checked). Counts below are over these. */
  contacts: Contact[];
  /** Every contact at the bank, whatever their desk. */
  allContacts: Contact[];
  /** Unscoped totals, so a card can say "+3 contacts on other desks". */
  all: { reached: number; contacts: number };
  reached: number;
  replied: number;
  live: number;
  withEmail: number;
  regions: Record<Region, number>;
  lastOutreach?: string;
  due: number;
  /** Reached out, but nobody replied and nothing's in flight for 3+ weeks. */
  quiet: boolean;
  /** The recruiting plan's desks that apply to this bank, and where each stands. */
  desks: DeskStatus[];
  /** Every checked desk that applies here is at an office the bank doesn't hire into. Left out of the counts. */
  notOffered: boolean;
  /**
   * Offices the checked desks reach at this bank (only ones it hires into), and the ones being applied to: at most
   * `cap` (you can usually apply to 2). `note` = the COVERAGE tab's "# offices/groups you can apply to".
   */
  offices: { all: string[]; picked: string[]; cap: number; note?: string };
  /** Submitted summer analyst applications to this firm (from the applications tab). */
  applied?: Application[];
}

export type CoverageSettings = {
  hidden: string[];
  added: TargetBank[];
  includeStarter: boolean;
  plan?: DeskTarget[];
  /** How many offices you can apply to per bank (default 2). */
  officesPerBank?: number;
  /** Offices picked by hand per bank (canonBank key → ["SF", "NY"]); otherwise picked automatically. */
  officePick?: Record<string, string[]>;
  /** Banks whose auto-created tab was undone: not created again automatically (canonBank keys). */
  skipTabs?: string[];
};

const REACHED = new Set(["sent", "followed_up", "replied", "call_scheduled", "done"]);
const REPLIED = new Set(["replied", "call_scheduled", "done"]);

/** An email actually went out (a known sent date, or a status that implies one). */
const wasReached = (c: Contact) => !!c.sentAt || REACHED.has(c.status);

/**
 * Every bank the user could be recruiting at, from: contacts, bank tabs (even empty ones), target-list tabs,
 * hand-added banks, and (optionally) the starter IB list. Merged by canonical name.
 *
 * With desks checked in the plan, the view is scoped to them: banks no checked desk applies to drop out, and the
 * bucket and counts come only from contacts on a checked desk (a bank with NY Generalist people but nobody on
 * SF Tech is cold in an SF-Tech-only view). With nothing checked, every contact counts.
 */
export function buildCoverage(args: {
  contacts: Contact[];
  tables: ContactTable[];
  targets: TargetBank[];
  coverage: CoverageSettings;
  banks: Record<string, BankMeta>;
  followUp: Settings["followUp"];
}): CoverageRow[] {
  const { contacts, tables, targets, coverage, banks, followUp } = args;
  const rows = new Map<string, CoverageRow>();
  const ensure = (name: string, tier?: string) => {
    const key = canonBank(name);
    let r = rows.get(key);
    if (!r) {
      r = {
        key, name, tier, bucket: "cold", contacts: [], allContacts: [], all: { reached: 0, contacts: 0 }, reached: 0, replied: 0, live: 0, withEmail: 0,
        regions: { SF: 0, LA: 0, NY: 0, CHI: 0, Other: 0 }, due: 0, quiet: false, desks: [], notOffered: false,
        offices: { all: [], picked: [], cap: DEFAULT_OFFICES_PER_BANK },
      };
      rows.set(key, r);
    }
    if (!r.tier && tier) r.tier = tier;
    return r;
  };

  // Names from contacts win for display (that's how the user spells them).
  for (const c of contacts) ensure(c.bank).allContacts.push(c);
  for (const t of tables) if (!/^prospects$/i.test(t.sheet)) ensure(t.bank);
  for (const t of targets) {
    const r = ensure(t.name, t.tier);
    if (t.applied?.length) r.applied = [...(r.applied ?? []), ...t.applied];
  }
  for (const t of coverage.added) ensure(t.name, t.tier);
  if (coverage.includeStarter) for (const t of STARTER_TARGETS) ensure(t.name, t.tier);

  const hidden = new Set(coverage.hidden);
  const active = activeDesks(coverage.plan);
  const cap = coverage.officesPerBank ?? DEFAULT_OFFICES_PER_BANK;
  const now = Date.now();
  const out: CoverageRow[] = [];
  for (const r of rows.values()) {
    const applicable = active.filter((t) => targetAppliesTo(t, r));
    if (active.length && !applicable.length && !hidden.has(r.key)) continue;
    // Only ~2 offices per bank: desks at offices you aren't applying to drop out of the scope and the counts.
    const statuses = applicable.map((t) => deskStatus(t, r.allContacts, r.name));
    // A desk that isn't offered here (no seats, or the office recruits another team) doesn't use up an office pick.
    const offered = applicable.filter((_, i) => statuses[i].state !== "not_offered");
    const picked = pickOffices(offered, r.allContacts, cap, coverage.officePick?.[r.key]);
    r.offices = { all: [...new Set(offered.map(deskOffice))], picked, cap, note: applyNote(r.name) };
    const applying = applicable.filter((t) => !offered.includes(t) || picked.includes(deskOffice(t)));
    r.contacts = active.length ? r.allContacts.filter((c) => inScope(c, applying)) : r.allContacts;
    r.all = { reached: r.allContacts.filter(wasReached).length, contacts: r.allContacts.length };
    let last = 0;
    for (const c of r.contacts) {
      if (wasReached(c)) r.reached++;
      if (REPLIED.has(c.status) || c.repliedAt) r.replied++;
      if (LIVE_STATUSES.has(c.status)) r.live++;
      if (c.email) r.withEmail++;
      r.regions[c.region]++;
      const t = new Date(c.lastTouchAt ?? c.sentAt ?? 0).getTime();
      if (t > last) last = t;
      const a = nextAction(c, followUp, banks[`${c.bank}|${c.region}`]);
      if (a.isDue && (a.kind === "follow_up" || a.kind === "move_on")) r.due++;
    }
    if (last) r.lastOutreach = new Date(last).toISOString();
    r.quiet = r.reached > 0 && r.replied === 0 && r.live === 0 && !!last && now - last > 21 * DAY;
    r.desks = statuses.map((d, i) => (applying.includes(applicable[i]) ? d : { ...d, state: "not_applying" as const }));
    r.notOffered = r.desks.length > 0 && r.desks.every((d) => d.state === "not_offered" || d.state === "not_applying");
    const working = r.contacts.filter((c) => c.status !== "ignored");
    r.bucket = hidden.has(r.key) ? "hidden" : r.reached > 0 ? "reached" : working.length > 0 ? "ready" : "cold";
    out.push(r);
  }
  return out;
}

export type ScoreUnit = "banks" | "desks";

/**
 * The scoreboard numbers. "banks" counts each bank once by its bucket. "desks" counts every (bank × checked desk)
 * pair once: emailed/replied = reached, ready/needs-email = ready, empty = cold ("not offered" desks don't count).
 */
export function scoreboard(rows: CoverageRow[], unit: ScoreUnit) {
  const visible = rows.filter((r) => r.bucket !== "hidden" && !r.notOffered);
  const counts = { reached: 0, ready: 0, cold: 0 };
  if (unit === "banks") for (const r of visible) counts[r.bucket as keyof typeof counts]++;
  else
    for (const r of visible)
      for (const d of r.desks) {
        if (d.state === "emailed" || d.state === "replied") counts.reached++;
        else if (d.state === "ready" || d.state === "needs_email") counts.ready++;
        else if (d.state === "empty") counts.cold++;
      }
  const total = counts.reached + counts.ready + counts.cold;
  const replied = unit === "banks" ? visible.filter((r) => r.replied > 0).length : visible.reduce((n, r) => n + r.desks.filter((d) => d.state === "replied").length, 0);
  return { ...counts, total, replied, pct: total ? Math.round((counts.reached / total) * 100) : 0 };
}

export const TIER_ORDER = ["Bulge Bracket", "Elite Boutique", "Middle Market", "Investment Bank", "Private Equity"];

export function tierRank(t?: string) {
  const i = t ? TIER_ORDER.indexOf(t) : -1;
  return i < 0 ? TIER_ORDER.length : i;
}

/** Emails that went out in [from, to): first emails by `sentAt`, plus the latest follow-up by `lastTouchAt`. */
export function outreachBetween(contacts: Contact[], from: number, to: number) {
  const inside = (d?: string) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    return t >= from && t < to;
  };
  let n = 0;
  for (const c of contacts) {
    if (inside(c.sentAt)) n++;
    if (c.followUps > 0 && c.lastTouchAt !== c.sentAt && inside(c.lastTouchAt)) n++;
  }
  return n;
}
