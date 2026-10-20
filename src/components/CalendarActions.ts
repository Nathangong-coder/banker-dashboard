"use client";

/** Google Calendar → the Calendar page (app/calendar) and the people your coffee chats were with. */

import { create } from "zustand";
import { useStore } from "@/lib/store";
import { serverCall } from "@/lib/serverSync";
import { callPatches, chatsIn, type CalendarEvent } from "@/lib/calendarDay";
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
  for (const { id, patch } of patches) st.updateContact(id, patch, patch.call ? { at: new Date().toISOString(), type: "note", note: `Call on Google Calendar: ${new Date(patch.call.at).toLocaleString()}` } : undefined);
  return { calendar: r.calendar, chats: chats.length, updated: patches.length };
}

