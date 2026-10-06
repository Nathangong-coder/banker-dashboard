"use client";

import type { BankMeta, Contact, Settings } from "./types";
import { nextAction } from "./followups";
import { digestMessages, digestTitle, type DigestItem } from "./digestFormat";

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
/** Emails going out on a local day: Gmail Schedule send, or queued on the server. */
const queuedOn = (contacts: Contact[], day: string) =>
  contacts.filter((c) => !QUIET_STATUSES.includes(c.status) && [c.scheduledAt, c.serverSend?.sendAt].some((t) => t && localDay(new Date(t)) === day)).length;

/** The daily WhatsApp digest (lib/digestFormat.ts): sections by action, "• Name: email" lines, split into messages. */
export function whatsappDigest(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"], maxLen = 900) {
  const d = todayDigest(contacts, banks, s);
  const today = localDay(new Date());
  const queued = queuedOn(contacts, today);
  if (!d && !queued) return null;
  const items: DigestItem[] = (d?.items ?? []).map(({ c, label }) => ({ contactId: c.id, name: c.name, email: c.email || undefined, label }));
  return { day: today, count: items.length, messages: digestMessages(items, queued, maxLen) };
}

/**
 * What the server's 9am text should say on each of the next `days` days if nothing changes: everyone due by that
 * day (overdue keeps rolling forward) plus that day's queued sends. The dashboard re-sends this whenever it's open,
 * and the server drops people its own sends have since followed up with.
 */
export function digestPlan(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"], days = 14) {
  const out: Record<string, { items: DigestItem[]; queued: number }> = {};
  const actions = contacts.map((c) => ({ c, a: nextAction(c, s, banks[`${c.bank}|${c.region}`]) })).filter(({ a }) => (a.kind === "follow_up" || a.kind === "move_on") && !a.unknownDate && a.due);
  for (let i = 0; i < days; i++) {
    const end = new Date();
    end.setDate(end.getDate() + i);
    end.setHours(23, 59, 59, 999);
    const day = localDay(end);
    const items = actions.filter(({ a }) => a.due! <= end).map(({ c, a }) => ({ contactId: c.id, name: c.name, email: c.email || undefined, label: a.label }));
    const queued = queuedOn(contacts, day);
    if (items.length || queued) out[day] = { items, queued };
  }
  return out;
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
