import type { BankMeta, Contact, Settings } from "./types";
import type { CoverageRow } from "./coverage";
import type { JobApplication } from "./apply";
import { canonBank } from "./banks";
import { TIER_ORDER, tierRank } from "./coverage";
import { bankWork, gotReply, isLive, wasEmailed } from "./bankWork";
import { bankHealth } from "./bankHealth";
import type { NightProgress, ProgressBank } from "./digestFormat";
import { DAY } from "./util";

/**
 * The first message of the 9 PM text (owner, 2026-11-21): how the big banks are going, in ranking order, and what to
 * do better. Built in the browser (it has the contacts) and pushed with the night plan; the server only formats it.
 * Pure. The types and the text lines live in digestFormat.ts (the server formats them).
 */
export type { NightProgress, ProgressBank };
const CLOSED_JOB = new Set(["rejected", "withdrawn", "offer"]);
const APPLIED_JOB = new Set(["submitted", "confirmed", "interview"]);
const CLOSED_APP = /reject|declin|withdr|no longer|closed|denied|not selected/i;

/** Application status at a firm, from the applications tab (row.applied) and Applications → My list. */
export function appState(row: Pick<CoverageRow, "key" | "applied">, jobs: Pick<JobApplication, "company" | "status">[]): ProgressBank["app"] {
  const mine = jobs.filter((j) => canonBank(j.company) === row.key);
  const apps = row.applied ?? [];
  if (mine.some((j) => APPLIED_JOB.has(j.status)) || apps.some((a) => !CLOSED_APP.test(a.status))) return "applied";
  if (mine.some((j) => !CLOSED_JOB.has(j.status))) return "open";
  if (mine.length || apps.length) return "closed";
  return undefined;
}

/**
 * The banks to report on: the ones you starred on the Process tracker, else every bulge bracket / elite boutique
 * you're tracking. Ordered starred first, then tier, then how far along (so the strongest relationships lead).
 */
export function bigBanks(rows: CoverageRow[], starred: Record<string, boolean> = {}) {
  const visible = rows.filter((r) => r.bucket !== "hidden" && !r.notOffered);
  const stars = visible.filter((r) => starred[r.key]);
  const pool = stars.length ? stars : visible.filter((r) => tierRank(r.tier) <= TIER_ORDER.indexOf("Elite Boutique"));
  return pool.sort((a, b) => Number(!!starred[b.key]) - Number(!!starred[a.key]) || tierRank(a.tier) - tierRank(b.tier) || a.name.localeCompare(b.name));
}

export function nightProgress(args: {
  rows: CoverageRow[];
  contacts: Contact[];
  banks: Record<string, BankMeta>;
  followUp: Settings["followUp"];
  jobs: Pick<JobApplication, "company" | "status">[];
  starred?: Record<string, boolean>;
  /** Process tracker column per bank key → its label. */
  columnOf?: (key: string) => string | undefined;
  max?: number;
  now?: number;
}): NightProgress {
  const now = args.now ?? Date.now();
  const big = bigBanks(args.rows, args.starred);
  const banks: ProgressBank[] = big.slice(0, args.max ?? 10).map((r) => {
    const h = bankHealth(r.allContacts);
    const w = bankWork({ name: r.name, contacts: r.allContacts, allContacts: args.contacts, banks: args.banks, followUp: args.followUp, now });
    return {
      bank: r.name,
      score: h.score,
      column: args.columnOf?.(r.key),
      chats: h.chats,
      emailed: h.emailed,
      live: r.allContacts.filter(isLive).length,
      app: appState(r, args.jobs),
      next: w.next?.label,
    };
  });

  // What to do better, most important first.
  const tips: string[] = [];
  const untouched = big.filter((r) => !r.allContacts.some(wasEmailed));
  if (untouched.length) tips.push(`Nobody emailed yet at ${names(untouched)}: start there.`);
  const stale = big.filter((r) => {
    const sent = r.allContacts.filter(wasEmailed);
    if (!sent.length || r.allContacts.some(gotReply) || r.allContacts.some((c) => c.referral)) return false;
    const last = Math.max(...sent.map((c) => Date.parse(c.lastEmailedAt ?? c.lastTouchAt ?? c.sentAt ?? "") || 0));
    return last && now - last > 14 * DAY;
  });
  if (stale.length) tips.push(`No replies in 2+ weeks at ${names(stale)}: try someone new (a different office or an alum).`);
  const applied = banks.filter((b) => b.app === "applied" && (b.score ?? 0) < 44);
  if (applied.length) tips.push(`You applied to ${applied.map((b) => b.bank).slice(0, 3).join(", ")} but haven't had a chat there: a chat helps the application get read.`);
  const owed = args.contacts.filter((c) => c.lastHeardAt && (!c.lastEmailedAt || c.lastHeardAt > c.lastEmailedAt) && c.status !== "ignored" && now - Date.parse(c.lastHeardAt) < 14 * DAY);
  if (owed.length && tips.length < 3) tips.push(`${owed.length} ${owed.length > 1 ? "people are" : "person is"} waiting on your reply: answer within a day.`);

  const inWeek = (d?: string) => !!d && now - Date.parse(d) < 7 * DAY && Date.parse(d) <= now;
  const week = {
    emails: args.contacts.filter((c) => inWeek(c.sentAt) || inWeek(c.lastEmailedAt)).length,
    replies: args.contacts.filter((c) => inWeek(c.repliedAt) || inWeek(c.lastHeardAt)).length,
    chats: args.contacts.reduce((n, c) => n + (c.chats ?? []).filter((x) => inWeek(x.at)).length + (c.call && inWeek(c.call.at) && !(c.chats ?? []).some((x) => inWeek(x.at)) ? 1 : 0), 0),
  };
  return { at: new Date(now).toISOString(), banks, tips: tips.slice(0, 3), week };
}

const names = (rows: Pick<CoverageRow, "name">[], n = 3) => rows.slice(0, n).map((r) => r.name).join(", ") + (rows.length > n ? ` +${rows.length - n}` : "");
