/**
 * Info sessions (firm recruiting events) read from your Google Calendar, and the people you met at each. Pure helpers
 * shared by the browser (/info-sessions) and the server (api/server/infosessions, tick reminders). No store, no fetch.
 *
 * The owner's calendar titles look like: "Raine Group Info Session (peep the names)", "Tidal Partners Info Session
 * (must go)", "BREA JP Morgan Info Session" (club-hosted), "BoA Virtual Info session (skip part of lecture)",
 * "MS Networking/Info Session" (an all-day placeholder until the time is known), "Bruin Consulting Zoom Info Session".
 * Student-club recruiting sessions ("BFB Info Session", "180DC Info Session") match too; `kind` tells them apart only
 * when the firm is a known bank (the browser checks that with canonBank, since the server has no bank list).
 */

export const INFO_SESSION_RE = /\b(info(?:rmation(?:al)?)?\s*-?\s*sessions?|networking\s*(?:\/|&|and)?\s*info|networking\s+(?:event|session|night|reception)|coffee\s+chats?\s+event|recruiting\s+(?:event|session)|roundtable)\b/i;

export const isInfoSessionTitle = (title: string) => INFO_SESSION_RE.test(title);

/** Words around the firm name that aren't part of it. */
const NOISE = /\b(virtual|zoom|in[- ]person|online|sophomore|junior|freshman|senior|diversity|women'?s?|tech|networking|recruiting|coffee chats?|event|night|reception|roundtable|session|info(?:rmation(?:al)?)?|the|at|w\/|with|and|&|\/|-|–|—|:)\b/gi;

export interface ParsedSessionTitle {
  /** "Raine Group", "JP Morgan", "MS". */
  firm: string;
  /** The parenthetical note: "peep the names", "must go". */
  note?: string;
  /** Club that hosts it ("BREA JP Morgan" → host BREA, firm JP Morgan), when the first word is an all-caps acronym before a longer name. */
  host?: string;
  virtual: boolean;
  /** "Tech" in "MS Tech Info Session": the group the session is for. */
  group?: string;
}

export function parseSessionTitle(title: string): ParsedSessionTitle {
  const note = title.match(/\(([^)]*)\)/)?.[1]?.trim() || undefined;
  const bare = title.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const virtual = /\b(virtual|zoom|online|webinar)\b/i.test(bare);
  const group = bare.match(/\b(tech(?:nology)?|healthcare|energy|fig|consumer|industrials|rx|restructuring|m&a)\b(?=.*\binfo)/i)?.[1];
  // The firm is whatever comes before "Info Session" / "Networking", minus the noise words.
  const head = bare.split(INFO_SESSION_RE)[0] ?? bare;
  let firm = head.replace(NOISE, " ").replace(/\s+/g, " ").trim();
  let host: string | undefined;
  const words = firm.split(" ");
  // "BREA JP Morgan": a club acronym in front of a firm name.
  if (words.length >= 3 && /^[A-Z0-9]{2,6}$/.test(words[0]) && !/^[A-Z0-9]{2,6}$/.test(words.slice(1).join(" "))) {
    host = words[0];
    firm = words.slice(1).join(" ");
  }
  if (!firm) firm = bare;
  return { firm, note, host, virtual, group: group && group[0].toUpperCase() + group.slice(1).toLowerCase() };
}

/** A Zoom / Teams / Meet link in the event text, if any. */
export function meetingLink(text: string) {
  return text.match(/https?:\/\/[^\s"'<>]*(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com)[^\s"'<>]*/i)?.[0];
}

/**
 * When to send the thank-yous for a session that ended at `end` (local weekday 0–6 of that day in your zone):
 * Monday–Thursday → tonight; Friday / weekend → your choice of tonight or next week (owner, 2026-10-19).
 */
export function followUpTiming(endWeekday: number): "tonight" | "choose" {
  return endWeekday >= 1 && endWeekday <= 4 ? "tonight" : "choose";
}

/** Reminder windows for the hourly server tick: "before" fires once 60–120 min ahead, "after" once in the hour after it ends. */
export const BEFORE_MIN = 60;
export const BEFORE_MAX = 120;
export const AFTER_MAX = 60;

export function reminderDue(now: number, start: number, end: number): "before" | "after" | null {
  const toStart = (start - now) / 60_000;
  if (toStart > BEFORE_MIN && toStart <= BEFORE_MAX) return "before";
  const sinceEnd = (now - end) / 60_000;
  if (sinceEnd >= 0 && sinceEnd < AFTER_MAX) return "after";
  return null;
}

/** One calendar event as the server returns it (api/server/infosessions). */
export interface CalendarSession {
  eventId: string;
  title: string;
  /** ISO; for all-day placeholders, the date at local midnight. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  link?: string;
  /** First ~600 characters of the description, tags stripped. */
  description?: string;
}

/** An item sent from your phone (capture page or a text to your Twilio number), waiting in the server inbox. */
export interface CaptureItem {
  id: string;
  at: string;
  via: "phone" | "twilio";
  /** Names / notes typed or pasted. */
  text?: string;
  /** A photo or screenshot (name tags, sign-in sheet, Zoom participant list) as a data: URL (JPEG/PNG, ≤ ~1.5 MB). */
  image?: string;
  /** The session it was sent for (calendar event id), if picked on the phone or inferred (the latest one that just ended). */
  sessionId?: string;
}

/** "BREA JP Morgan Info Session" → the bank-ish name for matching ("JP Morgan"). */
export const firmOf = (title: string) => parseSessionTitle(title).firm;
