import type { BankMeta, Contact, Region, Settings } from "./types";
import type { Application } from "./banks";
import { nextAction, queuedAt } from "./followups";
import { relationshipItem } from "./reminders";
import { LABELS } from "./digestFormat";
import { referralRows } from "./referralRows";
import { deskStatus, locationMatches, nextUpByDesk, teamMatches } from "./desks";
import { officeInfo } from "./offices";
import { teamOf } from "./locationTeam";
import { DAY } from "./util";

/**
 * What's left to do at one bank (app/coverage), and how urgent the bank is. Pure: no store, no React.
 *
 * Counts are over EVERY contact at the bank. The old coverage cards counted only contacts on a checked desk, and a
 * contact with no team is on no desk, so with the plan on, 87 of the owner's 204 contacts vanished (JP Morgan showed
 * 0 of 17, Rothschild 1 of 11). "Live" also counted unsent drafts (Perella: "4 live", 1 emailed).
 */

const EMAILED = new Set(["sent", "followed_up", "replied", "call_scheduled", "done"]);
const REPLIED = new Set(["replied", "call_scheduled", "done"]);

export const wasEmailed = (c: Contact) => !!c.sentAt || EMAILED.has(c.status);
export const gotReply = (c: Contact) => !!c.repliedAt || REPLIED.has(c.status);
/** Emailed and waiting on them: no reply yet, not moved on. Drafts don't count (they haven't gone out). */
export const isLive = (c: Contact) => c.status !== "ignored" && wasEmailed(c) && !gotReply(c);

export type TodoKind = "reply" | "thank" | "referral" | "confirm" | "follow_up" | "send" | "check_in" | "move_on" | "email_next" | "find_email" | "find_people" | "wait";

export interface BankTodo {
  kind: TodoKind;
  /** "Reply to Jane Doe", "Follow up with Jane, Bob". */
  label: string;
  people: Contact[];
  href?: string;
  /** Needs you now (counts toward "outstanding"); false = a suggestion (email the next person, find people) or waiting. */
  outstanding: boolean;
}

export interface BankWork {
  /** Everyone not moved on (status ignored = bounced / left / declined / moved on). */
  contacts: number;
  emailed: number;
  live: number;
  replied: number;
  referrals: number;
  /** Drafted, not sent and not queued to go out. */
  drafts: number;
  /** Queued: Gmail Schedule send or the server's queue. */
  queued: number;
  /** Not emailed yet and has an address / has none. */
  ready: number;
  needEmail: number;
  /** Per office: contacts and how many were emailed. */
  offices: { region: Region; contacts: number; emailed: number }[];
  todos: BankTodo[];
  /** Items that need you (replies, thank-yous, follow-ups, drafts…). */
  outstanding: number;
  next?: BankTodo;
  lastActivity?: string;
}

const enc = encodeURIComponent;
const firstNames = (list: Contact[], n = 2) => list.slice(0, n).map((c) => c.firstName || c.name).join(", ") + (list.length > n ? ` +${list.length - n}` : "");
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function bankWork(args: {
  name: string;
  contacts: Contact[];
  /** Every contact (the live cap per desk looks across banks' desks by key). */
  allContacts: Contact[];
  banks: Record<string, BankMeta>;
  followUp: Settings["followUp"];
  /** A desk with nobody on it yet ("SF|Tech"), for the Find people link. */
  emptyDesk?: { location: string; team: string };
  now?: number;
}): BankWork {
  const { name, banks, followUp, emptyDesk } = args;
  const now = args.now ?? Date.now();
  const active = args.contacts.filter((c) => c.status !== "ignored");
  const today = localDay(new Date(now));
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const buckets: Record<TodoKind, Contact[]> = {
    reply: [], thank: [], referral: [], confirm: [], follow_up: [], send: [], check_in: [], move_on: [], email_next: [], find_email: [], find_people: [], wait: [],
  };
  let queued = 0;
  for (const c of active) {
    const rel = relationshipItem(c, today, endOfToday);
    if (rel) {
      const k: TodoKind = rel.label === LABELS.replyOwed ? "reply" : rel.label === LABELS.checkIn ? "check_in" : "thank";
      buckets[k].push(c);
      continue;
    }
    const q = queuedAt(c);
    if (q && Date.parse(q) > now) {
      queued++;
      continue;
    }
    const a = nextAction(c, followUp, banks[`${c.bank}|${c.region}`]);
    if (a.kind === "send") buckets.send.push(c);
    else if (a.isDue && a.kind === "follow_up") buckets.follow_up.push(c);
    else if (a.isDue && a.kind === "move_on") buckets.move_on.push(c);
  }
  for (const c of active) if (c.signals?.some((s) => s.status === "new" && (s.kind === "intro" || s.kind === "referral"))) buckets.confirm.push(c);
  const referralTodos = referralRows(args.contacts, now).filter((r) => r.due && Date.parse(r.due) <= endOfToday.getTime() && /^(Email |Tell )/.test(r.next));

  const emailed = args.contacts.filter(wasEmailed);
  const notYet = active.filter((c) => !wasEmailed(c) && c.status === "new");
  const ready = notYet.filter((c) => c.email);
  const needEmail = notYet.filter((c) => !c.email);
  const live = args.contacts.filter(isLive);

  const todos: BankTodo[] = [];
  const add = (kind: TodoKind, label: string, people: Contact[], href: string | undefined, outstanding = true) => todos.push({ kind, label, people, href, outstanding });
  const list = buckets;
  if (list.reply.length) add("reply", `Reply to ${firstNames(list.reply)}`, list.reply, "/followups");
  if (list.thank.length) add("thank", `Send a thank-you to ${firstNames(list.thank)}`, list.thank, "/followups");
  for (const r of referralTodos) add("referral", r.next.replace(/ \(.*\)$/, ""), r.person ? [r.person] : [r.referrer], "/followups");
  if (list.confirm.length) add("confirm", `Confirm an intro from ${firstNames(list.confirm)}`, list.confirm, "/followups");
  if (list.follow_up.length) add("follow_up", `Follow up with ${firstNames(list.follow_up)}`, list.follow_up, "/followups");
  if (list.send.length) add("send", `Send ${list.send.length} draft${list.send.length > 1 ? "s" : ""} (${firstNames(list.send)})`, list.send, `/drafts?bank=${enc(name)}&status=drafted`);
  if (list.check_in.length) add("check_in", `Check in with ${firstNames(list.check_in)}`, list.check_in, "/followups");
  if (list.move_on.length) add("move_on", `Move on from ${firstNames(list.move_on)}?`, list.move_on, "/followups");

  // Suggestions: the next person with an open slot on their desk (cap per desk), else emails to find, else people.
  const nextUp = nextUpByDesk(args.contacts, args.allContacts, Math.max(1, followUp.livePerBank));
  if (nextUp) add("email_next", `Email ${nextUp.firstName || nextUp.name}${ready.length > 1 ? ` (${ready.length} ready)` : ""}`, [nextUp], `/drafts?bank=${enc(name)}`, false);
  else if (needEmail.length) add("find_email", `Find emails for ${needEmail.length} (${firstNames(needEmail)})`, needEmail, `/sheet?view=contacts&filter=noemail&bank=${enc(name)}`, false);
  else if (!active.length || (emptyDesk && !live.length && !ready.length))
    add(
      "find_people",
      emptyDesk ? `Find ${emptyDesk.location} ${emptyDesk.team} people` : "Find people",
      [],
      `/find?banks=${enc(name)}${emptyDesk ? `&desk=${enc(`${emptyDesk.location}|${emptyDesk.team}`)}` : ""}`,
      false,
    );
  if (!todos.length && (live.length || queued)) add("wait", queued ? `${queued} email${queued > 1 ? "s" : ""} queued; waiting on replies` : `Waiting on ${live.length} ${live.length > 1 ? "replies" : "reply"}`, live, undefined, false);

  const offices = new Map<Region, { region: Region; contacts: number; emailed: number }>();
  for (const c of active) {
    const o = offices.get(c.region) ?? { region: c.region, contacts: 0, emailed: 0 };
    o.contacts++;
    if (wasEmailed(c)) o.emailed++;
    offices.set(c.region, o);
  }
  let last = 0;
  for (const c of args.contacts)
    for (const d of [c.sentAt, c.lastTouchAt, c.lastEmailedAt, c.repliedAt, c.lastHeardAt, c.call?.at, ...(c.chats ?? []).map((x) => x.at)]) {
      const t = d ? Date.parse(d) : 0;
      if (t && t <= now && t > last) last = t;
    }

  const outstanding = todos.filter((t) => t.outstanding).reduce((n, t) => n + Math.max(1, t.people.length), 0);
  return {
    contacts: active.length,
    emailed: emailed.length,
    live: live.length,
    replied: args.contacts.filter(gotReply).length,
    referrals: args.contacts.filter((c) => !!c.referral).length,
    drafts: list.send.length,
    queued,
    ready: ready.length,
    needEmail: needEmail.length,
    offices: [...offices.values()].sort((a, b) => b.contacts - a.contacts),
    todos,
    outstanding,
    next: todos[0],
    lastActivity: last ? new Date(last).toISOString() : undefined,
  };
}

/* ---------------- urgency ---------------- */

/** When a bank's application opens / closes. Not tracked yet: the planned timeline feature fills it. */
export interface BankTimeline {
  opensAt?: string;
  deadline?: string;
}

export interface UrgencyPart {
  id: "prestige" | "applied" | "gap" | "todos" | "timeline";
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface Urgency {
  /** 0–100 over the parts that are known (the timeline only counts once it exists). */
  score: number;
  parts: UrgencyPart[];
}

export const URGENCY_WEIGHTS = { prestige: 25, applied: 25, gap: 30, todos: 20, timeline: 20 } as const;

const PRESTIGE: Record<string, number> = { "Bulge Bracket": 1, "Elite Boutique": 1, "Middle Market": 0.6, "Investment Bank": 0.5, "Private Equity": 0.6 };
const CLOSED = /reject|declin|withdr|no longer|closed|denied|not selected/i;
const OFFER = /offer|accept/i;
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * How urgently a bank needs your attention, 0–100:
 * - Prestige, 25: from the tier (bulge bracket / elite boutique = full, middle market 60%); your stars on /firms replace it.
 * - Applications, 25: an application in (not rejected) = full, since networking now helps it; none = 40%; all rejected / an offer = 0.
 * - Coverage gap, 30: nobody found = full, people but none emailed 85%, room under the cap 60%, at the cap 25%, replied 15%, call or referral 0.
 * - To-dos, 20: 10 per reply / thank-you owed, 5 per follow-up / draft / referral step, up to 20.
 * - Timeline, 20: only once a deadline is known (≤ 2 weeks full, ≤ 1 month 70%, ≤ 2 months 40%, later 15%, passed 0).
 */
export function bankUrgency(
  bank: { tier?: string; applied?: Application[] },
  w: BankWork,
  opts: { stars?: number; timeline?: BankTimeline; now?: number } = {},
): Urgency {
  const W = URGENCY_WEIGHTS;
  const now = opts.now ?? Date.now();
  const parts: UrgencyPart[] = [];

  const prestige = opts.stars ? opts.stars / 5 : (PRESTIGE[bank.tier ?? ""] ?? 0.4);
  parts.push({
    id: "prestige",
    label: "Prestige",
    points: round1(W.prestige * prestige),
    max: W.prestige,
    detail: opts.stars ? `Your rating: ${opts.stars} of 5 stars.` : bank.tier ? `${bank.tier}. Star the firm on Firms to set your own.` : "Tier unknown. Star the firm on Firms to set it.",
  });

  const apps = bank.applied ?? [];
  const open = apps.filter((a) => !CLOSED.test(a.status) && !OFFER.test(a.status));
  const applied = !apps.length ? 0.4 : open.length ? 1 : 0;
  parts.push({
    id: "applied",
    label: "Applications",
    points: round1(W.applied * applied),
    max: W.applied,
    detail: !apps.length
      ? "No application here yet."
      : open.length
        ? `Applied: ${open.map((a) => a.program + (a.status ? ` (${a.status})` : "")).join("; ")}. Networking now can help it get read.`
        : `Every application here is closed (${apps.map((a) => a.status || "no status").join(", ")}).`,
  });

  const talked = w.referrals > 0 || w.todos.some((t) => t.kind === "thank");
  // Room = someone to email next on a desk under the cap (or people / emails to find); otherwise you're waiting.
  const atCap = !w.todos.some((t) => t.kind === "email_next" || t.kind === "find_email" || t.kind === "find_people");
  const gap = !w.contacts && !w.emailed ? 1 : !w.emailed ? 0.85 : talked ? 0 : w.replied ? 0.15 : atCap ? 0.25 : 0.6;
  parts.push({
    id: "gap",
    label: "Coverage gap",
    points: round1(W.gap * gap),
    max: W.gap,
    detail: !w.contacts && !w.emailed
      ? "Nobody found here yet."
      : !w.emailed
        ? `${w.contacts} contact${w.contacts > 1 ? "s" : ""}, nobody emailed.`
        : talked
          ? "You've talked to someone here."
          : w.replied
            ? `${w.replied} replied: get the call booked.`
            : atCap
              ? `${w.live} live, as many as your cap allows. Waiting on replies.`
              : `${w.emailed} emailed, room for more.`,
  });

  const big = w.todos.filter((t) => t.kind === "reply" || t.kind === "thank").reduce((n, t) => n + t.people.length, 0);
  const small = w.todos.filter((t) => t.outstanding && t.kind !== "reply" && t.kind !== "thank").reduce((n, t) => n + Math.max(1, t.people.length), 0);
  parts.push({
    id: "todos",
    label: "To-dos",
    points: round1(Math.min(W.todos, big * 10 + small * 5)),
    max: W.todos,
    detail: big + small ? `${big ? `${big} repl${big > 1 ? "ies / thank-yous" : "y / thank-you"} owed` : ""}${big && small ? ", " : ""}${small ? `${small} follow-up / draft step${small > 1 ? "s" : ""}` : ""}.` : "Nothing waiting on you.",
  });

  const deadline = opts.timeline?.deadline ? Date.parse(opts.timeline.deadline) : NaN;
  if (Number.isFinite(deadline)) {
    const days = (deadline - now) / DAY;
    const t = days < 0 ? 0 : days <= 14 ? 1 : days <= 31 ? 0.7 : days <= 62 ? 0.4 : 0.15;
    parts.push({ id: "timeline", label: "Timeline", points: round1(W.timeline * t), max: W.timeline, detail: days < 0 ? "The deadline has passed." : `Deadline in ${Math.ceil(days)} days.` });
  }

  const got = parts.reduce((n, p) => n + p.points, 0);
  const max = parts.reduce((n, p) => n + p.max, 0);
  return { score: Math.round((got / max) * 100), parts };
}

/* ---------------- stages and location / group filters (the coverage board) ---------------- */

/**
 * The four columns on the coverage board, furthest along first: someone referred you; you've talked (a reply, a call
 * booked or had, a logged chat); you've emailed and are waiting; nobody emailed yet.
 */
export type BankStage = "referral" | "chatted" | "outreach" | "cold";

/** Talked to them, or about to: a reply, a call (past or booked), or a logged chat. */
export const talkedTo = (c: Contact) => gotReply(c) || !!c.call || !!c.chats?.length;

export function bankStage(contacts: Contact[]): BankStage {
  if (contacts.some((c) => !!c.referral)) return "referral";
  if (contacts.some(talkedTo)) return "chatted";
  if (contacts.some(wasEmailed)) return "outreach";
  return "cold";
}

/** "SF" / "LA" / "NY" / "Chicago" / "Texas" (blank = any) and a group like "Tech" (blank = any). */
export interface DeskFilter {
  office: string;
  team: string;
}

/**
 * Contacts at a bank on one office / group. `unsorted` = at that office with no team set (they might be on it), so a
 * card can say so instead of quietly dropping them.
 */
export function onDesk(contacts: Contact[], f: DeskFilter): { matched: Contact[]; unsorted: Contact[] } {
  if (!f.office && !f.team) return { matched: contacts, unsorted: [] };
  const here = f.office ? contacts.filter((c) => locationMatches(f.office, c)) : contacts;
  if (!f.team) return { matched: here, unsorted: [] };
  return { matched: here.filter((c) => teamMatches(f.team, teamOf(c))), unsorted: here.filter((c) => !teamOf(c)) };
}

/** Does the bank hire into this office / group (COVERAGE tab, built-in office lists, specialist firms)? */
export function offeredAt(bank: string, f: DeskFilter, specialty?: string[]): boolean {
  if (!f.office && !f.team) return true;
  if (f.office && f.team)
    return deskStatus({ id: "filter", location: f.office, team: f.team, scope: "all", tiers: [], banks: [], enabled: true }, [], bank, specialty).state !== "not_offered";
  if (f.office) return officeInfo(bank, f.office)?.hires !== false;
  return !specialty?.length || specialty.some((t) => teamMatches(f.team, t));
}
