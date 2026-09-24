import type { BankMeta, Contact, Settings } from "./types";
import type { ContactTable } from "./workbook";
import { STARTER_TARGETS, canonBank, type TargetBank } from "./banks";
import { LIVE_STATUSES, nextAction } from "./followups";
import { DAY } from "./util";

export type Bucket = "reached" | "ready" | "cold" | "hidden";

export interface CoverageRow {
  key: string;
  name: string;
  tier?: string;
  bucket: Bucket;
  contacts: Contact[];
  reached: number;
  replied: number;
  live: number;
  withEmail: number;
  regions: { SF: number; NY: number; Other: number };
  lastOutreach?: string;
  due: number;
  /** Reached out, but nobody replied and nothing's in flight for 3+ weeks. */
  quiet: boolean;
}

const REACHED = new Set(["sent", "followed_up", "replied", "call_scheduled", "done"]);
const REPLIED = new Set(["replied", "call_scheduled", "done"]);

/** An email actually went out (a known sent date, or a status that implies one). */
const wasReached = (c: Contact) => !!c.sentAt || REACHED.has(c.status);

/**
 * Every bank the user could be recruiting at, from: contacts, bank tabs (even empty ones), target-list tabs,
 * hand-added banks, and (optionally) the starter IB list. Merged by canonical name.
 */
export function buildCoverage(args: {
  contacts: Contact[];
  tables: ContactTable[];
  targets: TargetBank[];
  coverage: { hidden: string[]; added: TargetBank[]; includeStarter: boolean };
  banks: Record<string, BankMeta>;
  followUp: Settings["followUp"];
}): CoverageRow[] {
  const { contacts, tables, targets, coverage, banks, followUp } = args;
  const rows = new Map<string, CoverageRow>();
  const ensure = (name: string, tier?: string) => {
    const key = canonBank(name);
    let r = rows.get(key);
    if (!r) {
      r = { key, name, tier, bucket: "cold", contacts: [], reached: 0, replied: 0, live: 0, withEmail: 0, regions: { SF: 0, NY: 0, Other: 0 }, due: 0, quiet: false };
      rows.set(key, r);
    }
    if (!r.tier && tier) r.tier = tier;
    return r;
  };

  // Names from contacts win for display (that's how the user spells them).
  for (const c of contacts) ensure(c.bank).contacts.push(c);
  for (const t of tables) if (!/^prospects$/i.test(t.sheet)) ensure(t.bank);
  for (const t of targets) ensure(t.name, t.tier);
  for (const t of coverage.added) ensure(t.name, t.tier);
  if (coverage.includeStarter) for (const t of STARTER_TARGETS) ensure(t.name, t.tier);

  const hidden = new Set(coverage.hidden);
  const now = Date.now();
  for (const r of rows.values()) {
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
    const active = r.contacts.filter((c) => c.status !== "ignored");
    r.bucket = hidden.has(r.key) ? "hidden" : r.reached > 0 ? "reached" : active.length > 0 ? "ready" : "cold";
  }
  return [...rows.values()];
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
