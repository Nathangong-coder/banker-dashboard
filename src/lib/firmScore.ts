import type { Contact } from "./types";
import { canonBank } from "./banks";
import { teamOf } from "./locationTeam";

/**
 * Per-firm networking results (app/firms): how many people you emailed at each firm, how many replied, calls, referrals
 * and how your coffee chats went, plus a 0–100 score built from those parts. Pure: no store, no React.
 */

export interface FirmStats {
  /** canonBank key (same key as `coverage.ratings`). */
  key: string;
  /** The most common spelling of the bank among its contacts. */
  name: string;
  contacts: Contact[];
  emailed: number;
  replied: number;
  /** replied ÷ emailed (0 when nothing was emailed). */
  replyRate: number;
  /** People you've had a call with (past call, a logged chat, or status done). */
  calls: number;
  /** Calls on the calendar that haven't happened yet. */
  upcomingCalls: number;
  referrals: number;
  /** Mean of every graded chat's score (0–100), undefined when none were graded. */
  avgChatGrade?: number;
  gradedChats: number;
  declined: number;
  bounced: number;
  left: number;
  /** Latest dated thing that happened with anyone at the firm. */
  lastActivity?: string;
  regions: string[];
  teams: string[];
}

export interface ScorePart {
  id: "reply" | "calls" | "referrals" | "chat";
  label: string;
  points: number;
  max: number;
  /** One line on how the points were worked out. */
  detail: string;
}

export interface FirmScore {
  score: number;
  parts: ScorePart[];
}

const REACHED = new Set(["sent", "followed_up", "replied", "call_scheduled", "done"]);
const REPLIED = new Set(["replied", "call_scheduled", "done"]);

export const wasEmailed = (c: Contact) => !!c.sentAt || REACHED.has(c.status);
export const gotReplied = (c: Contact) => !!c.repliedAt || REPLIED.has(c.status);

function hadCall(c: Contact, now: number) {
  if (c.chats?.length) return true;
  if (c.call?.at && Date.parse(c.call.at) <= now) return true;
  return c.status === "done";
}

const latest = (a: string | undefined, b: string | undefined) => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a);

function lastActivityOf(c: Contact, now: number): string | undefined {
  let last: string | undefined;
  for (const d of [c.sentAt, c.lastTouchAt, c.repliedAt, c.lastEmailedAt, c.lastHeardAt, c.referral?.at, c.outcome?.at, ...(c.chats ?? []).map((x) => x.at)]) {
    if (d && Date.parse(d) <= now) last = latest(last, d);
  }
  if (c.call?.at && Date.parse(c.call.at) <= now) last = latest(last, c.call.at);
  return last;
}

/** Group contacts by firm (canonBank) and add up what happened at each. Blank banks are skipped. */
export function firmStats(contacts: Contact[], now = Date.now()): FirmStats[] {
  const groups = new Map<string, Contact[]>();
  for (const c of contacts) {
    if (!c.bank?.trim()) continue;
    const k = canonBank(c.bank);
    if (!k) continue;
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }
  const out: FirmStats[] = [];
  for (const [key, list] of groups) {
    const spellings = new Map<string, number>();
    for (const c of list) spellings.set(c.bank.trim(), (spellings.get(c.bank.trim()) ?? 0) + 1);
    const name = [...spellings].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
    const emailed = list.filter(wasEmailed).length;
    const replied = list.filter(gotReplied).length;
    const grades = list.flatMap((c) => (c.chats ?? []).map((x) => x.grade?.score)).filter((s): s is number => typeof s === "number");
    let lastActivity: string | undefined;
    for (const c of list) lastActivity = latest(lastActivity, lastActivityOf(c, now));
    out.push({
      key,
      name,
      contacts: list,
      emailed,
      replied,
      replyRate: emailed ? replied / emailed : 0,
      calls: list.filter((c) => hadCall(c, now)).length,
      upcomingCalls: list.filter((c) => !hadCall(c, now) && c.call?.at && Date.parse(c.call.at) > now).length,
      referrals: list.filter((c) => !!c.referral).length,
      avgChatGrade: grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : undefined,
      gradedChats: grades.length,
      declined: list.filter((c) => c.outcome?.kind === "declined").length,
      bounced: list.filter((c) => c.outcome?.kind === "bounced").length,
      left: list.filter((c) => c.outcome?.kind === "left").length,
      lastActivity,
      regions: [...new Set(list.map((c) => c.region).filter((r) => r && r !== "Other"))].sort(),
      teams: [...new Set(list.map((c) => teamOf(c)).filter(Boolean))].sort(),
    });
  }
  return out;
}

/** Reply rate across every firm (replied ÷ emailed), the prior the per-firm rate is pulled toward. */
export function overallReplyRate(stats: FirmStats[]): number {
  const emailed = stats.reduce((n, s) => n + s.emailed, 0);
  const replied = stats.reduce((n, s) => n + s.replied, 0);
  return emailed ? replied / emailed : 0.15;
}

/** How many sends' worth of weight the overall rate gets: with few emails, a firm's rate stays near the average. */
export const PRIOR_SENDS = 5;
/** A (smoothed) reply rate at or above this earns the full reply points. */
export const FULL_REPLY_RATE = 0.5;
export const SCORE_WEIGHTS = { reply: 35, calls: 25, referrals: 25, chat: 15 } as const;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * 0–100 from four parts (undefined = "Not started": nobody emailed yet):
 * - Reply rate, 35: smoothed rate (replied + 5 × overall) ÷ (emailed + 5), full points at 50%.
 * - Calls, 25: 12.5 per person you've spoken with, up to 2.
 * - Referrals, 25: one referral = full points.
 * - Chat grade, 15: average grade ÷ 100 × 15; half points (7.5) when no chat was graded.
 */
export function firmScore(s: FirmStats, overall: number): FirmScore | undefined {
  if (!s.emailed) return undefined;
  const W = SCORE_WEIGHTS;
  const smoothed = (s.replied + PRIOR_SENDS * overall) / (s.emailed + PRIOR_SENDS);
  const reply = W.reply * Math.min(1, smoothed / FULL_REPLY_RATE);
  const calls = W.calls * Math.min(1, s.calls / 2);
  const referrals = W.referrals * Math.min(1, s.referrals);
  const chat = s.avgChatGrade === undefined ? W.chat / 2 : W.chat * (s.avgChatGrade / 100);
  const parts: ScorePart[] = [
    {
      id: "reply",
      label: "Replies",
      points: round1(reply),
      max: W.reply,
      detail: `${s.replied} of ${s.emailed} replied (${pct(s.replyRate)}); smoothed toward your ${pct(overall)} average → ${pct(smoothed)}. Full points at ${pct(FULL_REPLY_RATE)}.`,
    },
    { id: "calls", label: "Calls", points: round1(calls), max: W.calls, detail: `${s.calls} call${s.calls === 1 ? "" : "s"} had. Full points at 2.` },
    { id: "referrals", label: "Referrals", points: round1(referrals), max: W.referrals, detail: s.referrals ? `${s.referrals} referral${s.referrals === 1 ? "" : "s"}.` : "No referral yet." },
    {
      id: "chat",
      label: "Chat grade",
      points: round1(chat),
      max: W.chat,
      detail: s.avgChatGrade === undefined ? "No graded chats yet (neutral: half points)." : `Average grade ${Math.round(s.avgChatGrade)}/100 over ${s.gradedChats} chat${s.gradedChats === 1 ? "" : "s"}.`,
    },
  ];
  return { score: Math.round(reply + calls + referrals + chat), parts };
}
