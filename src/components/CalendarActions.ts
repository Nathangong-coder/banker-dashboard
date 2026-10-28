"use client";

/** Google Calendar → the Calendar page (app/calendar) and the people your coffee chats were with. */

import { create } from "zustand";
import { useStore } from "@/lib/store";
import type { Contact } from "@/lib/types";
import { serverCall } from "@/lib/serverSync";
import { callPatches, chatsIn, wrongCalls, type CalendarEvent } from "@/lib/calendarDay";
import { loadCalendarSessions } from "./InfoSessionActions";

const DAY = 86_400_000;
export const BACK = 21 * DAY;
export const AHEAD = 45 * DAY;

/** The last calendar read, kept while you move between pages (not saved: the next visit reads it again). */
export const useCal = create<{ events: CalendarEvent[]; syncedAt?: number; calendar?: boolean }>(() => ({ events: [] }));

/** Read your Google Calendar (3 weeks back, ~6 ahead) and info sessions, and record the chats on the people they were with. */
export async function syncCalendar() {
  const now = Date.now();
  const [r] = await Promise.all([
    serverCall<{ calendar: boolean; events: CalendarEvent[] }>("/api/server/calendar", { from: new Date(now - BACK).toISOString(), to: new Date(now + AHEAD).toISOString() }),
    loadCalendarSessions(),
  ]);
  useCal.setState({ events: r.events ?? [], syncedAt: now, calendar: r.calendar });
  const st = useStore.getState();
  const chats = chatsIn(r.events ?? [], st.contacts, st.settings.profile.name.trim().split(/\s+/)[0]);
  const patches = callPatches(chats, st.contacts, now);
  // Undo calls an earlier sync put on the wrong person, before recording the right ones.
  const wrong = wrongCalls(r.events ?? [], chats, st.contacts);
  for (const { id, patch, guests } of wrong)
    st.updateContact(id, patch, { at: new Date().toISOString(), type: "note", note: guests.length ? `Calendar event removed: it wasn't with them (invite went to ${guests.join(", ")})` : "Calendar event removed: no guests, only a first name matched, and they never wrote back" });
  for (const { id, patch } of patches) st.updateContact(id, patch, patch.call ? { at: new Date().toISOString(), type: "note", note: `Call on Google Calendar: ${new Date(patch.call.at).toLocaleString()}` } : undefined);
  return { calendar: r.calendar, chats: chats.length, updated: patches.length, unmatched: wrong.length };
}


/**
 * "Not them": the calendar event on this person was someone else's (owner, 2026-10-28: "Market Research - James <>
 * Nathan" was a friend, not James Nichols). The call comes off, a "Call scheduled" it caused goes back to what the
 * emails say, and that event is never matched to them again.
 */
export function notThem(contactId: string) {
  const st = useStore.getState();
  const c = st.contacts.find((x) => x.id === contactId);
  const ev = c?.call?.eventId;
  if (!c || !ev) return;
  const patch: Partial<Contact> = { call: undefined, notEvents: [...new Set([...(c.notEvents ?? []), ev])].slice(-50) };
  if (c.status === "call_scheduled" && !c.chats?.length)
    patch.status = c.repliedAt ? "replied" : c.followUps > 0 ? "followed_up" : c.sentAt ? "sent" : c.draft ? "drafted" : "new";
  st.updateContact(contactId, patch, { at: new Date().toISOString(), type: "note", note: "Calendar event wasn't with them (marked by you)" });
}

/** "Done by hand": you thanked / answered them outside what the dashboard sees (a text, LinkedIn, an email it missed). */
export function markHandled(contactId: string) {
  useStore.getState().updateContact(contactId, { handledAt: new Date().toISOString() }, { at: new Date().toISOString(), type: "note", note: "Marked done by hand (thanked / messaged outside the dashboard)" });
}
