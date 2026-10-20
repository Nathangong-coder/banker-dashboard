/**
 * Coffee chats on your Google Calendar (app/calendar), pure so scripts can test it: which events are chats, who they
 * were with, and what to write onto the contact (`contact.call`) so the evening text and Follow-ups know about them.
 * Info sessions are left to lib/infoSessions.ts (they have their own list).
 */

import type { Contact, Status } from "./types";
import { isInfoSessionTitle } from "./infoSessions";
import { looksLikeChat, matchEvent } from "./calendarMatch";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  link?: string;
  /** Other people's emails (not yours). */
  attendees: string[];
}

export interface CalendarChat extends CalendarEvent {
  /** The contact it was with, when we can tell. */
  contactId?: string;
}

/**
 * The chats among your events. An event is a chat when the dashboard made it (`contact.call.eventId`), an attendee is
 * one of your contacts, or the title looks like one ("Coffee chat", "Nathan<>Elixa", "Call w/ …"). Info sessions and
 * all-day events never are. The person: event id → attendee email → full name → a first name only one contact has
 * (the last two only for chat-like titles, so "Dinner with Alex" isn't pinned on a contact named Alex).
 */
export function chatsIn(events: CalendarEvent[], contacts: Contact[], myFirstName?: string): CalendarChat[] {
  const byEvent = new Map(contacts.filter((c) => c.call?.eventId).map((c) => [c.call!.eventId, c.id]));
  const people = contacts.map((c) => ({ contactId: c.id, name: c.name, email: c.email || undefined }));
  const out: CalendarChat[] = [];
  for (const e of events) {
    if (e.allDay || isInfoSessionTitle(e.title)) continue;
    const own = byEvent.get(e.id);
    if (own) {
      out.push({ ...e, contactId: own });
      continue;
    }
    const byEmail = matchEvent({ summary: "", description: "", attendees: e.attendees }, people);
    if (byEmail) {
      out.push({ ...e, contactId: byEmail.contactId });
      continue;
    }
    // A big meeting (class, club, team call) isn't a coffee chat even if its title says "call".
    if (!looksLikeChat(e.title) || e.attendees.length > 3) continue;
    const p = matchEvent({ summary: e.title, description: "", attendees: [] }, people, { firstName: myFirstName });
    out.push({ ...e, contactId: p?.contactId });
  }
  return out;
}

/** Statuses a call moves up to "call scheduled" (same as logging a chat on /log). */
export const BEFORE_CALL: Status[] = ["new", "drafted", "sent", "followed_up", "replied"];

/**
 * What to change on each contact after a sync: `call` = their next upcoming chat, else the latest one that happened
 * (that's what the 9 PM thank-you and Follow-ups read), and status up to call_scheduled. Untouched when nothing changes.
 */
export function callPatches(chats: CalendarChat[], contacts: Contact[], now = Date.now()) {
  const byPerson = new Map<string, CalendarChat[]>();
  for (const c of chats) if (c.contactId) byPerson.set(c.contactId, [...(byPerson.get(c.contactId) ?? []), c]);
  const out: { id: string; patch: Partial<Contact> }[] = [];
  for (const [id, list] of byPerson) {
    const c = contacts.find((x) => x.id === id);
    if (!c) continue;
    const ahead = list.filter((e) => Date.parse(e.start) > now).sort((a, b) => a.start.localeCompare(b.start));
    const past = list.filter((e) => Date.parse(e.start) <= now).sort((a, b) => b.start.localeCompare(a.start));
    const e = ahead[0] ?? past[0];
    // Keep a call the dashboard scheduled that's still ahead, unless the calendar has that same event at a new time.
    if (c.call && c.call.eventId !== e.id && Date.parse(c.call.at) > now && Date.parse(e.start) <= now) continue;
    const patch: Partial<Contact> = {};
    if (c.call?.eventId !== e.id || c.call.at !== e.start)
      patch.call = { at: e.start, eventId: e.id, link: e.link ?? (c.call?.eventId === e.id ? c.call.link : ""), invited: c.call?.eventId === e.id ? c.call.invited : false };
    if (BEFORE_CALL.includes(c.status)) patch.status = "call_scheduled";
    if (Object.keys(patch).length) out.push({ id, patch });
  }
  return out;
}

/** A finished chat you haven't logged yet (no conversation on /log since it started). */
export function needsLog(e: CalendarChat, c: Contact | undefined, now = Date.now()) {
  if (!c || Date.parse(e.end) > now) return false;
  // Logged that day or later (a chat logged on /log is dated by day, not by the minute).
  const day = new Date(e.start);
  day.setHours(0, 0, 0, 0);
  return !(c.chats ?? []).some((x) => Date.parse(x.at) >= day.getTime());
}

/** Their LinkedIn profile, else a LinkedIn people search for them (the one-tap "connect" link). */
export function linkedinFor(c: Pick<Contact, "linkedin" | "name" | "bank">) {
  if (c.linkedin && /linkedin\.com\/in\//i.test(c.linkedin)) return c.linkedin;
  const u = new URL("https://www.linkedin.com/search/results/people/");
  u.searchParams.set("keywords", `${c.name} ${c.bank}`.trim());
  return u.toString();
}
