import type { BankMeta, Contact, Settings } from "./types";
import { FOLLOW_UP_SPREAD } from "./sendWindow";
import { addDays, latestIso } from "./util";

export type ActionKind = "reach_out" | "send" | "scheduled" | "follow_up" | "move_on" | "none";

export interface NextAction {
  kind: ActionKind;
  due?: Date;
  /** Due today or earlier. */
  isDue: boolean;
  label: string;
  unknownDate?: boolean;
}

const QUIET = new Set(["replied", "call_scheduled", "done", "ignored"]);

export function nextAction(c: Contact, s: Settings["followUp"], bank?: BankMeta): NextAction {
  if (bank && (bank.status === "moved_on" || bank.status === "paused"))
    return { kind: "none", isDue: false, label: bank.status === "paused" ? "Bank paused" : "Bank moved on" };
  if (QUIET.has(c.status)) return { kind: "none", isDue: false, label: "" };
  const now = new Date();
  // Queued with Gmail's Schedule send or on the server: nothing to do until it goes out (the follow-up clock starts then).
  const queued = queuedAt(c);
  if (queued && new Date(queued) > now && !QUIET.has(c.status))
    return { kind: "scheduled", due: new Date(queued), isDue: false, label: `${c.sentAt ? "Follow-up" : "Email"} scheduled · ${sendLabel(queued)}` };
  if (c.status === "new") return { kind: "reach_out", isDue: false, label: c.email ? "Draft email" : "Find email" };
  if (c.status === "drafted") return { kind: "send", isDue: true, label: "Send draft" };

  // A scheduled send whose time has passed went out then (until a Gmail sync confirms the exact time).
  // Gmail's latest sent date counts too: the server's tracking updates it when a follow-up you scheduled in Gmail goes out.
  const last = lastEmailOf(c, now);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  // No date: not "due" (that flooded the list with everyone ever emailed). Sync with Gmail or add the date to the
  // Contacted column to time it.
  if (!last) return { kind: "follow_up", isDue: false, label: "Sent date unknown", unknownDate: true };

  if (c.followUps >= s.maxFollowUps) {
    // Automatic (contactUpkeep.ts moves them on), so never a to-do: the label says when it happens.
    const due = moveOnDate(c, s)!;
    return { kind: "move_on", due, isDue: false, label: `Moves on ${dayLabel(due)} unless they reply` };
  }
  let due = addDays(last, c.followUps === 0 ? s.firstAfterDays : s.nextAfterDays);
  if (c.snoozeUntil && new Date(c.snoozeUntil) > due) due = new Date(c.snoozeUntil);
  return { kind: "follow_up", due, isDue: due <= endOfToday, label: `Follow-up #${c.followUps + 1}` };
}

/** Your latest email to them before a reply (Gmail's latest sent date when synced, else the sheet's dates). */
export function lastEmailOf(c: Pick<Contact, "lastEmailedAt" | "lastTouchAt" | "sentAt" | "scheduledAt">, now = new Date()) {
  const sent = c.sentAt ?? (c.scheduledAt && new Date(c.scheduledAt) <= now ? c.scheduledAt : undefined);
  return latestIso(c.lastEmailedAt, c.lastTouchAt ?? sent);
}

/**
 * When someone who got your last follow-up and never replied is moved on (owner, 2026-10-27): the end of that work week
 * (a Tuesday final check-in → Friday night), or the next Friday when it went out Friday–Sunday; never later than
 * `moveOnAfterDays` after it. Undefined until the follow-ups are used up or with no date.
 */
export function moveOnDate(c: Pick<Contact, "followUps" | "lastEmailedAt" | "lastTouchAt" | "sentAt" | "scheduledAt" | "snoozeUntil">, s: Settings["followUp"], now = new Date()) {
  if (c.followUps < s.maxFollowUps) return undefined;
  const last = lastEmailOf(c, now);
  if (!last) return undefined;
  const d = new Date(last);
  const dow = d.getDay();
  const friday = new Date(d);
  friday.setDate(d.getDate() + (dow >= 1 && dow <= 4 ? 5 - dow : dow === 5 ? 7 : dow === 6 ? 6 : 5));
  friday.setHours(23, 59, 59, 999);
  const cap = addDays(last, s.moveOnAfterDays);
  let due = cap < friday ? cap : friday;
  if (c.snoozeUntil && new Date(c.snoozeUntil) > due) due = new Date(c.snoozeUntil);
  return due;
}

/** "Fri 10/30". */
export const dayLabel = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });

/**
 * The earliest follow-up #`step` may go out: `firstAfterDays` (step 1) or `nextAfterDays`, minus FOLLOW_UP_SPREAD, after your last email to them
 * (Gmail's latest sent date when synced). Undefined for a first email or with no date. The schedulers never place a
 * follow-up before it: bulk "Draft & schedule" once queued Will Yi's #2 five days after #1.
 */
export function earliestSend(c: Pick<Contact, "lastEmailedAt" | "lastTouchAt" | "sentAt">, s: Settings["followUp"], step: number) {
  if (step <= 0) return undefined;
  const last = latestIso(c.lastEmailedAt, c.lastTouchAt ?? c.sentAt);
  // The planner spreads follow-ups over 6-8 days for a 7-day setting (sendWindow.ts#FOLLOW_UP_SPREAD): this is the 6.
  return last ? addDays(last, Math.max(1, (step === 1 ? s.firstAfterDays : s.nextAfterDays) - FOLLOW_UP_SPREAD)) : undefined;
}

/** When the next email to this person goes out by itself: Gmail Schedule send, or a send queued on the server. */
export function queuedAt(c: Pick<Contact, "scheduledAt" | "serverSend">) {
  const t = [c.scheduledAt, c.serverSend?.sendAt].filter((x): x is string => !!x).sort();
  return t[0];
}

/** "Tue 10/6, 9:00 AM" in the viewer's time zone. */
export function sendLabel(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export interface BankRollup {
  meta: BankMeta;
  contacts: Contact[];
  total: number;
  reached: number;
  replied: number;
  due: number;
  nextDue?: Date;
  responseRate: number;
}

export function rollupBanks(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"]) {
  const map = new Map<string, BankRollup>();
  for (const c of contacts) {
    const key = `${c.bank}|${c.region}`;
    const meta = banks[key] ?? { key, name: c.bank, region: c.region, status: "active" as const };
    let r = map.get(key);
    if (!r) {
      r = { meta, contacts: [], total: 0, reached: 0, replied: 0, due: 0, responseRate: 0 };
      map.set(key, r);
    }
    r.contacts.push(c);
    r.total++;
    if (!["new", "drafted"].includes(c.status)) r.reached++;
    if (c.repliedAt || c.status === "replied" || c.status === "call_scheduled" || c.status === "done") r.replied++;
    const a = nextAction(c, s, meta);
    if (a.isDue && a.kind !== "none") r.due++;
    if (a.due && (a.kind === "follow_up" || a.kind === "move_on") && (!r.nextDue || a.due < r.nextDue))
      r.nextDue = a.due;
  }
  for (const r of map.values()) r.responseRate = r.reached ? r.replied / r.reached : 0;
  return [...map.values()];
}

/** Outreach in flight: emailed (or about to be) with no reply yet. Counts toward the per-desk cap (see desks.ts). */
export const LIVE_STATUSES = new Set(["drafted", "sent", "followed_up"]);

/** The follow-up draft waiting in Gmail for this person's next follow-up, if any. */
export function pendingFollowUpDraft(c: Contact) {
  return c.followUpDraft && c.followUpDraft.step > c.followUps ? c.followUpDraft : undefined;
}
