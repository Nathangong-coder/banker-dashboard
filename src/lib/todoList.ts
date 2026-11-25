import { followUpKey, nextAction } from "./followups";
import { reminderRows, todoFor, type Reminder } from "./thinkAbout";
import { chatsToCheck } from "./chatEvidence";
import { referralRows } from "./referralRows";
import type { BankMeta, Contact, Settings } from "./types";

/**
 * The master to-do list (owner, 2026-11-24: "a new section that just has the to-do list, master set of things"): every
 * nudge in one place, cold and warm, grouped by when it's due (docs/DESIGN.md L-3). Nudges show once they're due (not
 * days ahead: less noise); dated reminders and referral steps show up to a week ahead. Each item that's a nudge carries
 * the key that dismisses it (`contact.dismissed`), so "this is wrong" takes it off everywhere: here, the lists and the
 * 9 PM text.
 */
export type TodoItemKind = "reply" | "thank" | "check_in" | "quiet" | "follow_up" | "reminder" | "chat" | "referral";

export interface TodoItem {
  key: string;
  kind: TodoItemKind;
  c?: Contact;
  /** "Reply to Jane Park", "Follow-up #2 to …". */
  title: string;
  /** One line of why. */
  why: string;
  due: string;
  /** Dismissing a nudge stores this on the contact. */
  dismissKey?: string;
  /** For reminders / chats to confirm: what the row's buttons act on. */
  reminderId?: string;
  chatDay?: string;
}

const LABEL: Record<"reply" | "thank" | "check_in" | "quiet", string> = { reply: "Reply to", thank: "Thank", check_in: "Check in with", quiet: "Nudge" };

export function todoItems(contacts: Contact[], banks: Record<string, BankMeta | undefined>, fu: Settings["followUp"], reminders: Record<string, Reminder> | undefined, now = Date.now()): TodoItem[] {
  const out: TodoItem[] = [];
  const week = now + 7 * 86_400_000;
  for (const c of contacts) {
    const t = todoFor(c, now);
    if (t && !t.hidden && Date.parse(t.due) <= now) out.push({ key: `w:${c.id}:${t.key}`, kind: t.kind, c, title: `${LABEL[t.kind]} ${c.name}`, why: t.why, due: t.due, dismissKey: t.key });
    const a = nextAction(c, fu, banks[`${c.bank}|${c.region}`]);
    if (a.kind === "follow_up" && a.due && a.isDue && !a.stale && !a.unknownDate) {
      const k = followUpKey(c);
      out.push({ key: `f:${c.id}`, kind: "follow_up", c, title: `${a.label} to ${c.name}`, why: `No reply since your last email`, due: a.due.toISOString(), dismissKey: k });
    }
    for (const r of chatsToCheck(c, now)) out.push({ key: `c:${c.id}:${r.day}`, kind: "chat", c, title: `Did you talk with ${c.name}?`, why: r.why, due: r.at, chatDay: r.day });
  }
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  for (const r of reminderRows(contacts, reminders)) {
    if (r.done || r.due > day(week)) continue;
    out.push({ key: `r:${r.id}`, kind: "reminder", c: r.contactId ? byId.get(r.contactId) : undefined, title: r.note, why: r.bank ?? "Reminder", due: `${r.due}T09:00:00`, reminderId: r.id });
  }
  for (const r of referralRows(contacts, now)) {
    if (!r.due || Date.parse(r.due) > week) continue;
    out.push({ key: `ref:${r.referrer.id}:${r.name}`, kind: "referral", c: r.person ?? r.referrer, title: r.next, why: `Referred by ${r.referrer.name}`, due: r.due });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

export type TodoGroup = "overdue" | "today" | "week" | "later";

/** Overdue (before today) / Today / This week / Later, by your local day. */
export function todoGroup(due: string, now = Date.now()): TodoGroup {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const t = Date.parse(due);
  if (t < start) return "overdue";
  if (t < start + 86_400_000) return "today";
  if (t < start + 7 * 86_400_000) return "week";
  return "later";
}

export { followUpKey };
