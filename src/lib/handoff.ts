import type { GmailScheduledItem } from "./scheduledRows";
import type { Contact } from "./types";

/**
 * The "to schedule in Gmail" list (owner, 2026-11-23): Google's API can't create Schedule-send emails, so Coverage
 * writes the drafts and the extension (A) or Claude in Chrome (B) clicks Schedule send in Gmail. Both read this one
 * list, and nothing counts as scheduled until Gmail's Scheduled folder shows it.
 */
export interface HandoffItem {
  /** The contact id. */
  id: string;
  name: string;
  to: string;
  subject: string;
  draftId: string;
  messageId: string;
  step: number;
  /** When it should go out. */
  at: string;
}

/** Gmail's time and the planned slot this close = the same email. */
export const SAME_SEND_MS = 2 * 60_000;

/** Waiting items. Anyone queued for Coverage's own sending is left off, so an email can't go out twice. */
export function handoffItems(contacts: Contact[]): HandoffItem[] {
  return contacts
    .filter((c) => c.gmailSchedule?.state === "waiting" && !c.serverSend && c.email)
    .map((c) => {
      const g = c.gmailSchedule!;
      return { id: c.id, name: c.name, to: c.email.trim().toLowerCase(), subject: g.subject, draftId: g.draftId, messageId: g.messageId, step: g.step, at: g.at };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Is there a scheduled email in Gmail to this person within ±2 minutes of `at`? */
export function inGmail(c: Contact, at: string, items: GmailScheduledItem[]): boolean {
  const mine = new Set([c.email, ...(c.aliases ?? [])].filter(Boolean).map((e) => e.trim().toLowerCase()));
  const t = Date.parse(at);
  return items.some((it) => Math.abs(Date.parse(it.at) - t) <= SAME_SEND_MS && it.to.some((e) => mine.has(e.trim().toLowerCase())));
}

/** After reading Gmail's Scheduled folder: confirm what's there; a confirmed one that vanished before its time goes back to waiting. */
export function confirmHandoff(contacts: Contact[], items: GmailScheduledItem[], now = Date.now()): { id: string; patch: Partial<Contact> }[] {
  const out: { id: string; patch: Partial<Contact> }[] = [];
  const stamp = new Date(now).toISOString();
  for (const c of contacts) {
    const g = c.gmailSchedule;
    if (!g || g.state === "failed") continue;
    const there = inGmail(c, g.at, items);
    if (g.state === "waiting" && there) out.push({ id: c.id, patch: { gmailSchedule: { ...g, state: "scheduled", error: undefined, updatedAt: stamp }, scheduledAt: g.at } });
    else if (g.state === "scheduled" && !there && Date.parse(g.at) > now) out.push({ id: c.id, patch: { gmailSchedule: { ...g, state: "waiting", updatedAt: stamp } } });
  }
  return out;
}
