"use client";

import { useStore } from "./store";
import type { Reminder, ReminderRow } from "./thinkAbout";
import type { Contact } from "./types";

/**
 * "This nudge is wrong" (owner, 2026-11-24): one click takes it off the To-do list, Cold outreach / Warm follow-ups
 * and the 9 PM text (`contact.dismissed`, see lib/followups.ts#followUpKey and thinkAbout.ts#todoFor). It comes back
 * by itself after the next email either way. Returns an undo.
 */
export function dismissNudge(c: Contact, key: string): () => void {
  const st = useStore.getState();
  const prev = c.dismissed;
  st.updateContact(c.id, { dismissed: [...new Set([...(prev ?? []), key])].slice(-20) }, { at: new Date().toISOString(), type: "note", note: "Dismissed a nudge (not needed)" });
  return () => useStore.getState().updateContact(c.id, { dismissed: prev });
}

/** A dated reminder done (same record Warm follow-ups' reminders use). Returns an undo. */
export function reminderDone(r: ReminderRow): () => void {
  const prevMap = useStore.getState().coverage.reminders ?? {};
  const prev = prevMap[r.id];
  const next: Reminder = prev
    ? { ...prev, done: new Date().toISOString() }
    : { id: r.id, due: r.due, note: r.note, bank: r.bank, contactId: r.contactId, createdAt: new Date().toISOString(), source: r.found ? "found" : "manual", done: new Date().toISOString() };
  useStore.getState().setCoverage((cov) => ({ ...cov, reminders: { ...(cov.reminders ?? {}), [r.id]: next } }));
  return () =>
    useStore.getState().setCoverage((cov) => {
      const m = { ...(cov.reminders ?? {}) };
      if (prev) m[r.id] = prev;
      else delete m[r.id];
      return { ...cov, reminders: m };
    });
}

/** Your yes / no on a chat only one source supports (same as Warm follow-ups' "Chats to confirm"). */
export function chatVerdict(c: Contact, day: string, v: "yes" | "no") {
  useStore.getState().updateContact(c.id, { chatVerdicts: { ...(c.chatVerdicts ?? {}), [day]: v } }, { at: new Date().toISOString(), type: "note", note: v === "yes" ? `You confirmed a chat on ${day}` : `You said there was no chat on ${day}` });
}
