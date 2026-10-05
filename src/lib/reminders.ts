"use client";

import type { BankMeta, Contact, Settings } from "./types";
import { nextAction } from "./followups";

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

/** The daily WhatsApp text: who to follow up with today, plus the sends Gmail will make today. */
export function whatsappDigest(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"]) {
  const d = todayDigest(contacts, banks, s);
  const today = localDay(new Date());
  const queued = contacts.filter((c) => c.scheduledAt && localDay(new Date(c.scheduledAt)) === today && !["replied", "call_scheduled", "done", "ignored"].includes(c.status));
  if (!d && !queued.length) return null;
  const parts: string[] = [];
  if (d) parts.push(`Follow up today (${d.items.length}):\n${digestText(d)}`);
  if (queued.length) parts.push(`Going out today via Schedule send: ${queued.length}`);
  return { day: today, count: d?.items.length ?? 0, text: parts.join("\n\n") };
}
