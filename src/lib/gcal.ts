"use client";

/**
 * Google Calendar, in the browser like Gmail (lib/gmail.ts): a separate Google Identity Services token with calendar
 * scopes, asked for the first time a calendar feature is used, so declining it never breaks Gmail. Two calls only:
 * free/busy (to subtract your events from your availability) and creating an event with the banker as a guest.
 *
 * The Google Cloud project needs the Google Calendar API enabled (APIs & Services → Library → Google Calendar API).
 */

const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];
const API = "https://www.googleapis.com/calendar/v3";

let token: { value: string; exp: number; clientId: string } | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
}

export const calendarConnected = (clientId?: string) => !!token && token.exp > Date.now() && (!clientId || token.clientId === clientId);

export async function connectCalendar(clientId: string): Promise<string> {
  if (calendarConnected(clientId)) return token!.value;
  if (!clientId) throw new Error("Connect Gmail in Settings first (Calendar uses the same Google sign-in).");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(" "),
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error ?? "Google sign-in failed"));
        const granted = (r.scope ?? "").split(" ");
        if (!SCOPES.every((s) => granted.includes(s))) return reject(new Error("Please tick both Calendar permissions (see your free/busy times, and create events)."));
        token = { value: r.access_token, exp: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000, clientId };
        resolve(token.value);
      },
      error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "The Google window was closed." : (e.message ?? e.type))),
    });
    client.requestAccessToken();
  });
}

async function call<T>(clientId: string, path: string, init?: RequestInit): Promise<T> {
  const t = await connectCalendar(clientId);
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (res.status === 401) {
    token = null;
    throw new Error("Google Calendar session expired. Try again.");
  }
  if (!res.ok) {
    const text = await res.text();
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(text))
      throw new Error("The Google Calendar API isn't enabled for this app's Google project yet. Enable it in Google Cloud (APIs & Services → Library → Google Calendar API), then try again.");
    throw new Error(`Google Calendar: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Busy times on your primary calendar between two instants. */
export async function busyTimes(clientId: string, from: Date, to: Date) {
  const r = await call<{ calendars: Record<string, { busy: { start: string; end: string }[]; errors?: unknown[] }> }>(clientId, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }),
  });
  return (r.calendars.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

/**
 * Create the call on your calendar with them as a guest. `notify: true` makes Google email them the invite now; false
 * puts it only on your calendar (send it later from Google Calendar by saving it with "Send").
 */
export async function createCallEvent(clientId: string, e: { title: string; description: string; start: Date; minutes: number; tz: string; guest?: string; notify: boolean }) {
  const end = new Date(e.start.getTime() + e.minutes * 60_000);
  return call<{ id: string; htmlLink: string }>(clientId, `/calendars/primary/events?sendUpdates=${e.notify ? "all" : "none"}`, {
    method: "POST",
    body: JSON.stringify({
      summary: e.title,
      description: e.description,
      start: { dateTime: e.start.toISOString(), timeZone: e.tz },
      end: { dateTime: end.toISOString(), timeZone: e.tz },
      attendees: e.guest ? [{ email: e.guest }] : [],
      reminders: { useDefault: true },
    }),
  });
}
