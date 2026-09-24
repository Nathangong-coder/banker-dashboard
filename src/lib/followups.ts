import type { BankMeta, Contact, Settings } from "./types";
import { addDays } from "./util";

export type ActionKind = "reach_out" | "send" | "follow_up" | "move_on" | "none";

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
  if (c.status === "new") return { kind: "reach_out", isDue: false, label: c.email ? "Draft email" : "Find email" };
  if (c.status === "drafted") return { kind: "send", isDue: true, label: "Send draft" };

  const last = c.lastTouchAt ?? c.sentAt;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (!last) return { kind: "follow_up", isDue: true, label: "Follow up (sent date unknown)", unknownDate: true };

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

/** Outreach in flight: emailed (or about to be) with no reply yet. Counts toward the per-bank cap. */
export const LIVE_STATUSES = new Set(["drafted", "sent", "followed_up"]);

export function liveByBank(contacts: Contact[]) {
  const m = new Map<string, number>();
  for (const c of contacts) if (LIVE_STATUSES.has(c.status)) m.set(c.bank, (m.get(c.bank) ?? 0) + 1);
  return m;
}

/** Banks whose live count would exceed the cap if `adding` contacts were drafted too. */
export function overCap(contacts: Contact[], adding: Contact[], cap: number) {
  const live = liveByBank(contacts);
  const touched = new Set(adding.map((c) => c.bank));
  for (const c of adding) if (!LIVE_STATUSES.has(c.status)) live.set(c.bank, (live.get(c.bank) ?? 0) + 1);
  return [...live.entries()].filter(([bank, n]) => touched.has(bank) && n > cap);
}

/** Who to reach out to next at a bank once a live slot opens: not-yet-contacted, emails first. */
export function nextUp(bankContacts: Contact[]) {
  return bankContacts.filter((c) => c.status === "new").sort((a, b) => Number(!!b.email) - Number(!!a.email))[0];
}
