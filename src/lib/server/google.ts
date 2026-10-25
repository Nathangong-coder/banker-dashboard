import "server-only";
import { HttpError } from "./http";
import { unseal, type Account } from "./accounts";
import { isInfoSessionTitle, meetingLink, type CalendarSession } from "../infoSessions";
import type { DocsJson } from "../docMatch";

/**
 * Server-side Gmail for automatic sending: the authorization-code flow with offline access (a refresh token, so sends
 * go out while the dashboard is closed). Uses the deployment's own Google client (GOOGLE_CLIENT_ID +
 * GOOGLE_CLIENT_SECRET); users never set anything up in Google Cloud. Scopes: gmail.compose, which covers sending
 * existing drafts (drafts.send) and nothing else of the mailbox, and (optional) calendar.events.readonly.
 */

export const SERVER_SCOPES = ["https://www.googleapis.com/auth/gmail.compose"];
/**
 * Optional: read-only Calendar events, so the 9 PM text knows who you had a call with today (thank-yous). Asked for
 * with Gmail; if it's unticked on Google's screen, sending still works and the text uses only the dashboard's calls.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
/**
 * Optional (owner, 2026-10-22): read-only Gmail, so the server can see replies, thank-yous and intros every hour
 * (lib/server/gmailTrack.ts) instead of only when the dashboard is open. Unticked = sending still works.
 */
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/**
 * Optional (owner, 2026-10-23): read-only Google Docs + Drive file names, so chats get linked to their notes docs and
 * smart mentions read what's in them (api/server/docs), private docs included. Unticked = everything else still works.
 */
export const DOCS_SCOPES = ["https://www.googleapis.com/auth/documents.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly"];
/**
 * Accounts (owner, 2026-10-25): "Connect Google" also covers what the dashboard did with its own browser popups, so
 * signed-in users never see them: creating call invites and reading free/busy times (lib/gcal.ts). The browser gets
 * short-lived access tokens from api/server/google/token.
 */
export const BROWSER_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];
export const CALLBACK_PATH = "/api/server/google/callback";

function client() {
  const id = process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, "The server isn't set up for Gmail (Google client id/secret missing).");
  return { id, secret };
}

export function authUrl(redirectUri: string, state: string, loginHint?: string) {
  const q = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [...SERVER_SCOPES, CALENDAR_SCOPE, GMAIL_READ_SCOPE, ...DOCS_SCOPES, ...BROWSER_SCOPES].join(" "),
    access_type: "offline",
    // Always ask, so Google returns a refresh token even if this account connected before.
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenCall(body: Record<string, string>) {
  const { id, secret } = client();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    // invalid_grant = revoked, expired (apps left in "Testing" lose refresh tokens after 7 days), or password changed.
    const revoked = j.error === "invalid_grant";
    throw new HttpError(revoked ? 401 : 502, revoked ? "Google access was revoked or expired. Reconnect automatic sending on Follow-ups." : `Google: ${j.error_description ?? j.error ?? res.statusText}`);
  }
  return j;
}

export async function exchangeCode(code: string, redirectUri: string) {
  const j = await tokenCall({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!j.refresh_token) throw new HttpError(502, "Google didn't return offline access. Remove the app's access at myaccount.google.com/permissions and connect again.");
  if (!SERVER_SCOPES.every((s) => (j.scope ?? "").includes(s))) throw new HttpError(400, "Gmail permission wasn't granted. Connect again and tick the Gmail box.");
  const granted = (j.scope ?? "").split(" ");
  return {
    access: j.access_token!,
    refresh: j.refresh_token,
    // calendar.events (read + write) covers what the read-only scope gives the 9 PM text.
    calendar: granted.includes(CALENDAR_SCOPE) || granted.includes(BROWSER_SCOPES[0]),
    read: granted.includes(GMAIL_READ_SCOPE),
    docs: DOCS_SCOPES.every((x) => granted.includes(x)),
    scopes: granted.filter((x) => x.startsWith("https://www.googleapis.com/auth/")),
  };
}

export async function accessToken(a: Account) {
  if (!a.google) throw new HttpError(400, "Gmail isn't connected for automatic sending.");
  return (await tokenCall({ refresh_token: unseal(a.google.refresh), grant_type: "refresh_token" })).access_token!;
}

/** An access token plus how long it lasts and what it may do (for the browser: api/server/google/token). */
export async function accessTokenWithScopes(a: Account) {
  if (!a.google) throw new HttpError(400, "Google isn't connected. Connect Google in Settings first.");
  const j = await tokenCall({ refresh_token: unseal(a.google.refresh), grant_type: "refresh_token" });
  return { access: j.access_token!, scopes: (j.scope ?? "").split(" ").filter(Boolean), expiresIn: Number((j as { expires_in?: number }).expires_in ?? 3600) };
}

export async function gmail<T>(access: string, path: string, init?: RequestInit) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new HttpError(res.status, `Gmail: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export const gmailProfile = (access: string) => gmail<{ emailAddress: string }>(access, "/profile");

/** Send an existing draft. 404 = it's gone (already sent by hand, or deleted). */
export const sendDraft = (access: string, draftId: string) =>
  gmail<{ id: string; threadId: string }>(access, "/drafts/send", { method: "POST", body: JSON.stringify({ id: draftId }) });

export async function revoke(a: Account) {
  if (!a.google) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(unseal(a.google.refresh))}`, { method: "POST" }).catch(() => undefined);
}

/* ---------------- Google Docs / Drive (read-only) ---------------- */

async function googleGet<T>(access: string, url: string, what: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text();
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(text))
      throw new HttpError(503, `The ${what} API isn't enabled for Coverage's Google project yet (Google Cloud → APIs & Services → Library → ${what} API).`);
    if (res.status === 403 || res.status === 401) throw new HttpError(403, `Coverage can't read your ${what}. Reconnect Google on Follow-ups → Reminders and allow Google Docs (read-only).`);
    if (res.status === 404) throw new HttpError(404, "That doc doesn't exist or isn't shared with your Google account.");
    throw new HttpError(502, `${what}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

type DriveFile = { id: string; name: string; modifiedTime?: string; createdTime?: string; webViewLink?: string };

/** Google Docs whose title has `name`'s last name, plus docs whose text has the full name (lib/docMatch.ts#driveQueries). */
export async function searchDocs(access: string, queries: { name: string; text: string }) {
  const list = async (q: string, via: "name" | "text") => {
    const p = new URLSearchParams({ q, pageSize: "15", fields: "files(id,name,modifiedTime,createdTime,webViewLink)", spaces: "drive", corpora: "user" });
    const r = await googleGet<{ files?: DriveFile[] }>(access, `https://www.googleapis.com/drive/v3/files?${p}`, "Google Drive");
    return (r.files ?? []).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, createdTime: f.createdTime, url: f.webViewLink ?? `https://docs.google.com/document/d/${f.id}/edit`, via }));
  };
  const [byName, byText] = await Promise.all([list(queries.name, "name"), list(queries.text, "text").catch(() => [])]);
  return [...byName, ...byText.filter((t) => !byName.some((n) => n.id === t.id))];
}

/** A doc's JSON (all tabs), for lib/docMatch.ts#docJsonText. */
export const getDoc = (access: string, id: string) =>
  googleGet<DocsJson>(access, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?includeTabsContent=true`, "Google Docs");

export interface CalEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  attendees: string[];
}

/**
 * Timed events on your primary calendar that start on local `day` (`dayOf` maps an instant to its local day), minus
 * all-day events and ones you declined. 403 = Calendar access wasn't granted or the Calendar API is off.
 */
export async function eventsOn(access: string, day: string, dayOf: (at: Date) => string): Promise<CalEvent[]> {
  // A window a little over a day around now, then keep the events whose local start day is `day` (no tz math here).
  const now = Date.now();
  const q = new URLSearchParams({
    timeMin: new Date(now - 30 * 3600_000).toISOString(),
    timeMax: new Date(now + 6 * 3600_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new HttpError(res.status, `Google Calendar: ${(await res.text()).slice(0, 200)}`);
  type Raw = {
    id: string;
    status?: string;
    summary?: string;
    description?: string;
    start?: { dateTime?: string };
    attendees?: { email?: string; self?: boolean; responseStatus?: string }[];
  };
  const j = (await res.json()) as { items?: Raw[] };
  return (j.items ?? [])
    .filter((e) => e.status !== "cancelled" && e.start?.dateTime && dayOf(new Date(e.start.dateTime)) === day)
    .filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === "declined"))
    .map((e) => ({
      id: e.id,
      summary: (e.summary ?? "").slice(0, 200),
      description: (e.description ?? "").slice(0, 2000),
      start: e.start!.dateTime!,
      attendees: (e.attendees ?? []).filter((a) => !a.self && a.email).map((a) => a.email!.toLowerCase()),
    }));
}

export interface ListedEvent {
  id: string;
  summary: string;
  /** Raw (may contain HTML from Google's editor). */
  description: string;
  location?: string;
  /** dateTime for timed events, YYYY-MM-DD for all-day ones (`end` is then the exclusive end date). */
  start: string;
  end: string;
  allDay: boolean;
  /** Other guests' emails (lowercase). */
  attendees: string[];
  status: string;
}

/**
 * Timed and all-day events on your primary calendar overlapping [timeMin, timeMax], recurring ones expanded, minus
 * cancelled ones and ones you declined. Needs `calendar.events.readonly`; 403 = not granted or the Calendar API is off.
 */
export async function listEvents(access: string, timeMin: string, timeMax: string): Promise<ListedEvent[]> {
  type When = { dateTime?: string; date?: string };
  type Raw = {
    id: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: When;
    end?: When;
    attendees?: { email?: string; self?: boolean; responseStatus?: string }[];
  };
  const out: ListedEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      fields: "nextPageToken,items(id,status,summary,description,location,start,end,attendees(email,self,responseStatus))",
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { Authorization: `Bearer ${access}` } });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new HttpError(
        res.status === 401 || res.status === 403 ? 403 : 502,
        res.status === 403 && /disabled|not been used/i.test(body)
          ? "Google Calendar API is turned off for this app's Google project."
          : res.status === 401 || res.status === 403
            ? "Coverage can't read your Google Calendar. Reconnect Google on Follow-ups → Reminders and tick Calendar (read-only)."
            : `Google Calendar: ${body}`,
      );
    }
    const j = (await res.json()) as { items?: Raw[]; nextPageToken?: string };
    for (const e of j.items ?? []) {
      if (e.status === "cancelled") continue;
      if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
      const start = e.start?.dateTime ?? e.start?.date;
      const end = e.end?.dateTime ?? e.end?.date ?? start;
      if (!start || !end) continue;
      out.push({
        id: e.id,
        summary: (e.summary ?? "").slice(0, 300),
        description: (e.description ?? "").slice(0, 8000),
        location: e.location?.slice(0, 300) || undefined,
        start,
        end,
        allDay: !e.start?.dateTime,
        attendees: (e.attendees ?? []).filter((a) => !a.self && a.email).map((a) => a.email!.toLowerCase()),
        status: e.status ?? "confirmed",
      });
    }
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
/** Google Calendar descriptions are HTML from its editor: plain text for the dashboard. */
export function plainText(html: string) {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h\d)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#?\w+);/g, (m, k: string) => ENTITIES[k.toLowerCase()] ?? (/^#\d+$/.test(k) ? String.fromCharCode(Number(k.slice(1))) : m))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Info-session events (`isInfoSessionTitle`) between two instants, as the dashboard and the phone page get them. */
export async function infoSessionsBetween(a: Account, from: string, to: string): Promise<CalendarSession[]> {
  const events = await listEvents(await accessToken(a), from, to);
  return events
    .filter((e) => isInfoSessionTitle(e.summary))
    .map((e) => {
      const text = plainText(e.description);
      return {
        eventId: e.id,
        title: e.summary,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
        link: meetingLink(`${e.description} ${text} ${e.location ?? ""}`),
        description: text.slice(0, 600) || undefined,
      };
    });
}

/** The session going on now, else the one that ended most recently (within `withinH` hours, if given). Timed only. */
export function currentSession(sessions: CalendarSession[], now = Date.now(), withinH?: number) {
  const timed = sessions.filter((s) => !s.allDay);
  const ongoing = timed.find((s) => Date.parse(s.start) <= now && Date.parse(s.end) >= now);
  if (ongoing) return ongoing;
  const ended = timed
    .filter((s) => Date.parse(s.end) < now && (withinH === undefined || now - Date.parse(s.end) <= withinH * 3600_000))
    .sort((x, y) => Date.parse(y.end) - Date.parse(x.end));
  return ended[0];
}
