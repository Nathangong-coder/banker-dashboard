"use client";

/** Google Calendar → the Calendar page (app/calendar) and the people your coffee chats were with. */

import { create } from "zustand";
import { useStore } from "@/lib/store";
import type { Contact } from "@/lib/types";
import { serverCall } from "@/lib/serverSync";
import { callPatches, chatsIn, wrongCalls, type CalendarEvent } from "@/lib/calendarDay";
import { withEvidence } from "@/lib/chatEvidence";
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
 * Chats from the last 120 days of your calendar (owner, 2026-11-21): every past event with a contact as a guest is
 * recorded on each of them (`chatEvidence`), so the chat count sees all of them, not just the latest on `call`. Only
 * evidence is written here (the Calendar page's sync sets calls and statuses). Run from Shell at most every 6 hours.
 */
export async function backfillCalendarChats() {
  const now = Date.now();
  const r = await serverCall<{ calendar: boolean; events: CalendarEvent[] }>("/api/server/calendar", { from: new Date(now - 119 * DAY).toISOString(), to: new Date(now).toISOString() });
  if (!r.calendar) return 0;
  const st = useStore.getState();
  const chats = chatsIn(r.events ?? [], st.contacts, st.settings.profile.name.trim().split(/\s+/)[0]).filter((c) => Date.parse(c.start) <= now);
  const by = new Map<string, NonNullable<Contact["chatEvidence"]>>();
  for (const c of chats) for (const id of c.contactIds ?? (c.contactId ? [c.contactId] : [])) by.set(id, [...(by.get(id) ?? []), { at: c.start, source: "calendar", ref: c.id }]);
  // The calendar is the truth for this window (owner, 2026-11-22): an event that was deleted, moved, or that they
  // declined no longer counts. Evidence used to only ever be added, so a rescheduled chat stayed as two.
  const from = now - 119 * DAY;
  const seen = new Set((r.events ?? []).map((e) => e.id));
  let n = 0;
  for (const c of useStore.getState().contacts) {
    const fresh = by.get(c.id) ?? [];
    const keep = (c.chatEvidence ?? []).filter((e) => e.source !== "calendar" || Date.parse(e.at) < from || fresh.some((f) => f.ref === e.ref));
    const dropped = (c.chatEvidence?.length ?? 0) - keep.length;
    const ev = withEvidence({ chatEvidence: keep }, fresh) ?? (dropped ? keep : undefined);
    // Their `call` points at an event that's gone from the calendar (deleted, or you declined it): it didn't happen.
    const gone = !!c.call && Date.parse(c.call.at) >= from && Date.parse(c.call.at) <= now && !seen.has(c.call.eventId);
    if (!ev && !gone) continue;
    st.updateContact(c.id, { ...(ev ? { chatEvidence: ev.length ? ev : undefined } : {}), ...(gone ? { call: undefined } : {}) }, gone ? { at: new Date().toISOString(), type: "note", note: "Call taken off: the event is no longer on your Google Calendar" } : undefined);
    n++;
  }
  return n;
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
