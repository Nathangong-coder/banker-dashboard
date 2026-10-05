import type { BankMeta, Contact, Settings } from "./types";
import { addDays } from "./util";

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
  // Queued with Gmail's Schedule send: nothing to do until it goes out (the follow-up clock starts then).
  if (c.scheduledAt && new Date(c.scheduledAt) > now && !QUIET.has(c.status))
    return { kind: "scheduled", due: new Date(c.scheduledAt), isDue: false, label: `${c.sentAt ? "Follow-up" : "Email"} scheduled · ${sendLabel(c.scheduledAt)}` };
  if (c.status === "new") return { kind: "reach_out", isDue: false, label: c.email ? "Draft email" : "Find email" };
  if (c.status === "drafted") return { kind: "send", isDue: true, label: "Send draft" };

  // A scheduled send whose time has passed went out then (until a Gmail sync confirms the exact time).
  const sent = c.sentAt ?? (c.scheduledAt && new Date(c.scheduledAt) <= now ? c.scheduledAt : undefined);
  const last = c.lastTouchAt ?? sent;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  // No date: not "due" (that flooded the list with everyone ever emailed). Sync with Gmail or add the date to the
  // Contacted column to time it.
  if (!last) return { kind: "follow_up", isDue: false, label: "Sent date unknown", unknownDate: true };

  let due: Date;
  let kind: ActionKind;
  if (c.followUps < s.maxFollowUps) {
    due = addDays(last, c.followUps === 0 ? s.firstAfterDays : s.nextAfterDays);
    kind = "follow_up";
  } else {
    due = addDays(last, s.moveOnAfterDays);
    kind = "move_on";
  }
  if (c.snoozeUntil && new Date(c.snoozeUntil) > due) due = new Date(c.snoozeUntil);
  const label = kind === "follow_up" ? `Follow-up #${c.followUps + 1}` : "Move on?";
  return { kind, due, isDue: due <= endOfToday, label };
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
