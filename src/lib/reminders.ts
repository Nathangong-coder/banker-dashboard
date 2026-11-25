"use client";

import type { TextLayout } from "./textLayout";
import type { BankMeta, Contact, Settings } from "./types";
import { nextAction } from "./followups";
import { LABELS, TEXT_HOUR, afterCallLines, isTextDay, isTodoLabel, nextTextDay, nightMessages, type DigestItem, type NightProgress } from "./digestFormat";
import { referralRows } from "./referralRows";
import { chatsToCheck } from "./chatEvidence";
import { dueReminders, referrers, todoFor, type ReminderRow } from "./thinkAbout";

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
    // Moving on is automatic (contactUpkeep.ts), so it never goes in a reminder.
    if (a.kind !== "follow_up" || a.unknownDate || a.stale) continue;
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
/**
 * The evening WhatsApp text for today as the server sends it (lib/digestFormat.ts#nightMessages): big banks, to-do,
 * outreach. Without the server, calendar calls aren't in it. Null when there's nothing to say.
 */
export function whatsappDigest(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"], opts: { progress?: NightProgress; extraItems?: DigestItem[]; maxLen?: number; layout?: TextLayout | null } = {}) {
  const today = localDay(new Date());
  const plan = nightPlan(contacts, banks, s, 1)[today] ?? { items: [], queued: 0 };
  const items = [...plan.items, ...(opts.extraItems ?? [])];
  const extras = nightExtras(plan, contacts, today);
  const app = typeof window !== "undefined" ? window.location.origin : "";
  const messages = nightMessages({
    items,
    progress: opts.progress,
    todoExtra: extras.filter((l) => !l.startsWith("Already scheduled")),
    outreachExtra: extras.filter((l) => l.startsWith("Already scheduled")),
    app,
    maxLen: opts.maxLen ?? 1400,
    layout: opts.layout,
  });
  return messages.length ? { day: today, count: items.length, todo: items.filter((i) => isTodoLabel(i.label)).length, messages } : null;
}

/** Lines after the sections: what's already scheduled, and after a day with calls, a log + LinkedIn link per person. */
export function nightExtras(plan: { items: DigestItem[]; queued: number }, contacts: Contact[] = [], day = localDay(new Date())) {
  const out: string[] = [];
  if (plan.queued) out.push(`Already scheduled before tomorrow night: ${plan.queued}`);
  const talked = plan.items.filter((i) => i.label === LABELS.thankToday);
  if (talked.length) {
    const start = startOf(day).getTime();
    const met = talked.flatMap((i) => {
      const c = contacts.find((x) => x.id === i.contactId);
      // Today's conversation already logged: nothing to ask.
      return c && !(c.chats ?? []).some((x) => Date.parse(x.at) >= start) ? [{ contactId: c.id, name: c.name, bank: c.bank, linkedin: c.linkedin }] : [];
    });
    const app = typeof window !== "undefined" ? window.location.origin : "";
    if (met.length || !contacts.length) out.push(...afterCallLines(met, app, day));
  }
  return out;
}

const endOf = (day: string) => new Date(`${day}T23:59:59.999`);
const startOf = (day: string) => new Date(`${day}T00:00:00`);


/**
 * People who replied: tonight's thank-yous, thank-yous still owed for earlier calls, replies you owe, and a check-in
 * once a week has gone by since your last email (until they've referred you / done what they said, or you mark them
 * done). Evaluated as of the night of `day`, covering what falls due by `horizonEnd`.
 */
export function relationshipItem(c: Contact, day: string, horizonEnd: Date, isReferrer?: (c: Contact) => boolean): DigestItem | null {
  if (c.status === "done") return null;
  const item = (label: string): DigestItem => ({ contactId: c.id, name: c.name, email: c.email || undefined, label });
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
  // Everything else is the same per-person read as Things to think about (lib/thinkAbout.ts#todoFor), so the text and
  // the page always list the same people (owner, 2026-11-22). Hidden (resolved, filtered as noise) = not in the text.
  const row = todoFor(c, dayEnd.getTime(), isReferrer);
  if (!row || row.hidden) return null;
  if (row.kind === "thank") return item(new Date(row.at) >= dayStart ? LABELS.thankToday : LABELS.thankOwed);
  if (row.kind === "reply") return item(LABELS.replyOwed);
  return new Date(row.due) <= horizonEnd ? item(row.kind === "check_in" ? LABELS.checkIn : LABELS.quiet) : null;
}

/**
 * What the 9 PM text says on each text night of the next `days` days: people you talked to or who replied
 * (relationshipItem), and every follow-up due by the end of the next text night (overdue keeps rolling forward), so
 * tomorrow's emails get scheduled tonight instead of on the day. The dashboard re-sends this whenever it's open, and
 * the server adds today's Google Calendar calls and drops people its own sends have since followed up with.
 */
export function nightPlan(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"], days = 14, reminders: ReminderRow[] = []) {
  const out: Record<string, { items: DigestItem[]; queued: number }> = {};
  const actions = contacts.map((c) => ({ c, a: nextAction(c, s, banks[`${c.bank}|${c.region}`]) })).filter(({ a }) => a.kind === "follow_up" && !a.unknownDate && !a.stale && a.due);
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const day = localDay(d);
    if (!isTextDay(day)) continue;
    const horizon = endOf(nextTextDay(day));
    const items: DigestItem[] = [];
    const seen = new Set<string>();
    const isRef = referrers(contacts);
    for (const c of contacts) {
      const it = relationshipItem(c, day, horizon, isRef);
      if (it) {
        items.push(it);
        seen.add(c.id);
      }
    }
    for (const { c, a } of actions) if (!seen.has(c.id) && a.due! <= horizon) items.push({ contactId: c.id, name: c.name, email: c.email || undefined, label: a.label });
    // Referrals: email the person you were referred to, and tell the referrer how it went (their follow-ups are above).
    for (const r of referralRows(contacts)) {
      if (!r.due || new Date(r.due) > horizon || !/^(Email |Tell )/.test(r.next)) continue;
      const who = r.next.startsWith("Email ") ? r.person : r.referrer;
      const id = who?.id ?? `ref:${r.referrer.id}:${r.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({ contactId: id, name: `${r.next.replace(/ \(.*\)$/, "")}`, email: who?.email || undefined, label: LABELS.referral });
    }
    // Dated reminders due by the next text night (Things to think about), until you mark them done.
    for (const r of dueReminders(reminders, nextTextDay(day))) {
      const who = r.name ? `${r.name}${r.bank ? ` (${r.bank})` : ""}` : r.bank;
      items.push({ contactId: `rem:${r.id}`, name: `${who ? `${who}: ` : ""}${r.note}`.slice(0, 120), label: LABELS.reminder });
    }
    // Chats the calendar and your email disagree about: you say whether they happened (Things to think about → Chats to confirm).
    for (const c of contacts)
      for (const r of chatsToCheck(c))
        items.push({ contactId: `chat:${c.id}:${r.day}`, name: `${c.name}${c.bank ? ` (${c.bank})` : ""}, ${new Date(`${r.day}T12:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}`, label: LABELS.confirmChat });
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
    await send(n > 1 ? `Tonight (${i + 1}/${n})` : "Tonight", digest.messages[i]);
  }
  return n;
}
