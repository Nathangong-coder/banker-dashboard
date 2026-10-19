"use client";

import type { BankMeta, Contact, Settings } from "./types";
import { nextAction } from "./followups";
import { LABELS, TEXT_HOUR, TRACKER_NOTE, digestMessages, digestTitle, isTextDay, nextTextDay, type DigestItem } from "./digestFormat";
import { DAY, latestIso } from "./util";

export interface DayDigest {
  date: string; // YYYY-MM-DD (local)
  when: Date; // 9am local that day
  items: { c: Contact; label: string }[];
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Group upcoming follow-ups by day (overdue items roll into today). */
export function upcomingDigests(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"], horizonDays: number): DayDigest[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today.getTime() + horizonDays * 86_400_000);
  const map = new Map<string, DayDigest>();
  for (const c of contacts) {
    const a = nextAction(c, s, banks[`${c.bank}|${c.region}`]);
    // No sent date: there's nothing to time a reminder from (sync with Gmail or fill in the Contacted column).
    if ((a.kind !== "follow_up" && a.kind !== "move_on") || a.unknownDate) continue;
    const due = a.due && a.due > today ? new Date(a.due) : new Date(today);
    if (due > limit) continue;
    due.setHours(9, 0, 0, 0);
    const key = localDay(due);
    const d = map.get(key) ?? { date: key, when: due, items: [] };
    d.items.push({ c, label: a.label });
    map.set(key, d);
  }
  return [...map.values()].sort((a, b) => a.when.getTime() - b.when.getTime());
}

export function digestText(d: DayDigest) {
  const lines = d.items.slice(0, 12).map(({ c, label }) => `• ${c.name} (${c.bank}${c.region !== "Other" ? ` ${c.region}` : ""}): ${label}`);
  if (d.items.length > 12) lines.push(`…and ${d.items.length - 12} more`);
  return lines.join("\n");
}

/** Today's digest (overdue rolls into today), or undefined when nothing is due. */
export function todayDigest(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"]): DayDigest | undefined {
  const d = upcomingDigests(contacts, banks, s, 0)[0];
  return d?.date === localDay(new Date()) ? d : undefined;
}

const QUIET_STATUSES = ["replied", "call_scheduled", "done", "ignored"];
/** The evening WhatsApp text for today (lib/digestFormat.ts), or null on a non-text day / nothing to say. */
export function whatsappDigest(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"], maxLen = 900) {
  const today = localDay(new Date());
  const plan = nightPlan(contacts, banks, s, 1)[today];
  if (!plan) return null;
  return { day: today, count: plan.items.length, messages: digestMessages(plan.items, nightExtras(plan), maxLen) };
}

/** Lines after the sections: what's already scheduled, and the tracker reminder after a day with calls. */
export function nightExtras(plan: { items: DigestItem[]; queued: number }) {
  const out: string[] = [];
  if (plan.queued) out.push(`Already scheduled before your next text: ${plan.queued}`);
  if (plan.items.some((i) => i.label === LABELS.thankToday)) out.push(TRACKER_NOTE);
  return out;
}

const NURTURE = new Set(["replied", "call_scheduled"]);
const endOf = (day: string) => new Date(`${day}T23:59:59.999`);
const startOf = (day: string) => new Date(`${day}T00:00:00`);

/** Calls with them: the one on your calendar and any chat you logged (newest first). */
const callTimes = (c: Contact) => [c.call?.at, ...(c.chats ?? []).map((x) => x.at)].filter((x): x is string => !!x).sort().reverse();
/** The last email you sent them, as well as we know it (Gmail sync, else the outreach dates). */
const lastEmailed = (c: Contact) => latestIso(c.lastEmailedAt, c.lastTouchAt ?? c.sentAt);

/**
 * People who replied: tonight's thank-yous, thank-yous still owed for earlier calls, replies you owe, and a check-in
 * once a week has gone by since your last email (until they've referred you / done what they said, or you mark them
 * done). Evaluated as of the night of `day`, covering what falls due by `horizonEnd`.
 */
export function relationshipItem(c: Contact, day: string, horizonEnd: Date): DigestItem | null {
  if (c.status === "ignored" || c.status === "done") return null;
  if (c.outcome && (c.outcome.kind !== "declined" || c.outcome.confirmed)) return null;
  const item = (label: string): DigestItem => ({ contactId: c.id, name: c.name, email: c.email || undefined, label });
  const last = lastEmailed(c);
  const dayStart = startOf(day);
  const dayEnd = endOf(day);
  // Met at an info session that day (app/info-sessions) and the thank-you isn't out or queued yet.
  if (
    (c.status === "new" || c.status === "drafted") &&
    !c.sentAt &&
    !c.serverSend &&
    !(c.scheduledAt && new Date(c.scheduledAt) > dayStart) &&
    c.metAt?.some((m) => new Date(m.at) >= dayStart && new Date(m.at) <= dayEnd)
  )
    return item(LABELS.infoSession);
  const lastCall = callTimes(c).find((t) => new Date(t) <= dayEnd);
  if (lastCall) {
    const at = new Date(lastCall);
    const thanked = !!last && new Date(last) > at;
    if (!thanked && at >= dayStart) return item(LABELS.thankToday);
    if (!thanked && dayStart.getTime() - at.getTime() < 14 * DAY) return item(LABELS.thankOwed);
  }
  if (!NURTURE.has(c.status) && !lastCall) return null;
  // A call still ahead: nothing to chase.
  if (c.call && new Date(c.call.at) > dayEnd) return null;
  if (c.lastHeardAt && (!last || c.lastHeardAt > last)) return item(LABELS.replyOwed);
  if (c.referral || !last) return null;
  let due = new Date(new Date(last).getTime() + 7 * DAY);
  if (c.snoozeUntil && new Date(c.snoozeUntil) > due) due = new Date(c.snoozeUntil);
  return due <= horizonEnd ? item(LABELS.checkIn) : null;
}

/**
 * What the 9 PM text says on each text night (Mon–Thu) of the next `days` days: people you talked to or who replied
 * (relationshipItem), and every follow-up due by the end of the next text night (overdue keeps rolling forward), so
 * tomorrow's emails get scheduled tonight instead of on the day. The dashboard re-sends this whenever it's open, and
 * the server adds today's Google Calendar calls and drops people its own sends have since followed up with.
 */
export function nightPlan(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"], days = 14) {
  const out: Record<string, { items: DigestItem[]; queued: number }> = {};
  const actions = contacts.map((c) => ({ c, a: nextAction(c, s, banks[`${c.bank}|${c.region}`]) })).filter(({ a }) => (a.kind === "follow_up" || a.kind === "move_on") && !a.unknownDate && a.due);
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const day = localDay(d);
    if (!isTextDay(day)) continue;
    const horizon = endOf(nextTextDay(day));
    const items: DigestItem[] = [];
    const seen = new Set<string>();
    for (const c of contacts) {
      const it = relationshipItem(c, day, horizon);
      if (it) {
        items.push(it);
        seen.add(c.id);
      }
    }
    for (const { c, a } of actions) if (!seen.has(c.id) && a.due! <= horizon) items.push({ contactId: c.id, name: c.name, email: c.email || undefined, label: a.label });
    // Emails that go out by themselves before the next text.
    const tonight = endOf(day);
    const queued = contacts.filter((c) => !QUIET_STATUSES.includes(c.status) && [c.scheduledAt, c.serverSend?.sendAt].some((t) => t && new Date(t) > tonight && new Date(t) <= horizon)).length;
    if (items.length || queued) out[day] = { items, queued };
  }
  return out;
}

/** When a night's text goes out (local). */
export function textTime(day: string) {
  const d = startOf(day);
  d.setHours(TEXT_HOUR, 0, 0, 0);
  return d;
}

/** Send the digest as numbered WhatsApp messages, a few seconds apart (CallMeBot drops rapid-fire messages). */
export async function sendWhatsAppDigest(digest: { messages: string[] }, send: (title: string, message: string) => Promise<unknown>) {
  const n = digest.messages.length;
  for (let i = 0; i < n; i++) {
    if (i) await new Promise((r) => setTimeout(r, 4000));
    await send(digestTitle(i, n), digest.messages[i]);
  }
  return n;
}
