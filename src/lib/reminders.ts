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

/** Section order in the WhatsApp digest: last chances first. */
const sectionRank = (label: string) => (/move on/i.test(label) ? 0 : Number(label.match(/#(\d+)/)?.[1] ?? 9));

/**
 * The daily WhatsApp digest, sectioned by what to do ("Move on?", "Follow-up #2", …) with one "Name: email" line per
 * person, split into as many messages as needed (CallMeBot sends one text per call; each stays under `maxLen`).
 */
export function whatsappDigest(contacts: Contact[], banks: Record<string, BankMeta>, s: Settings["followUp"], maxLen = 900) {
  const d = todayDigest(contacts, banks, s);
  const today = localDay(new Date());
  const queued = contacts.filter((c) => c.scheduledAt && localDay(new Date(c.scheduledAt)) === today && !["replied", "call_scheduled", "done", "ignored"].includes(c.status));
  if (!d && !queued.length) return null;
  const sections = new Map<string, string[]>();
  for (const { c, label } of d?.items ?? []) sections.set(label, [...(sections.get(label) ?? []), c.email ? `• ${c.name}: ${c.email}` : `• ${c.name}`]);
  const blocks = [...sections.entries()].sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]));
  if (queued.length) blocks.push([`Going out today (Schedule send): ${queued.length}`, []]);

  const messages: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) messages.push(cur.trim());
    cur = "";
  };
  for (const [header, lines] of blocks) {
    const head = lines.length ? `*${header}* (${lines.length})` : header;
    if (cur && cur.length + head.length + (lines[0]?.length ?? 0) + 4 > maxLen) flush();
    cur += `${cur ? "\n\n" : ""}${head}`;
    for (const line of lines) {
      if (cur.length + line.length + 1 > maxLen) {
        flush();
        cur = `*${header}* (cont.)`;
      }
      cur += `\n${line}`;
    }
  }
  flush();
  return { day: today, count: d?.items.length ?? 0, messages };
}

/** Send the digest as numbered WhatsApp messages, a few seconds apart (CallMeBot drops rapid-fire messages). */
export async function sendWhatsAppDigest(digest: { messages: string[] }, send: (title: string, message: string) => Promise<unknown>) {
  const n = digest.messages.length;
  for (let i = 0; i < n; i++) {
    if (i) await new Promise((r) => setTimeout(r, 4000));
    await send(n > 1 ? `Follow-ups due (${i + 1}/${n})` : "Follow-ups due", digest.messages[i]);
  }
  return n;
}
