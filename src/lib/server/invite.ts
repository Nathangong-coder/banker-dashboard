import "server-only";
import { HttpError } from "./http";
import { accessTokenWithScopes } from "./google";
import type { Account } from "./accounts";

const WRITE_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar"];

/**
 * Put a call on your Google Calendar with them as a guest, from the server (owner, 2026-11-22: invites from the phone,
 * by the Claude connector or a text). Needs Connect Google's `calendar.events`; `notify` = Google emails them the
 * invite now. The dashboard's next calendar sync puts it on the contact (`contact.call`).
 */
export async function createInvite(
  a: Account,
  e: { email: string; title: string; description?: string; start: Date; minutes: number; notify: boolean },
): Promise<{ id: string; htmlLink: string }> {
  if (!a.google) throw new HttpError(400, "Google isn't connected. Connect Google in Coverage → Settings → Account (Calendar included).");
  const t = await accessTokenWithScopes(a);
  if (!t.scopes.some((s) => WRITE_SCOPES.includes(s)))
    throw new HttpError(403, "Coverage can read your calendar but can't add events. Reconnect Google in Settings → Account and allow Calendar.");
  const end = new Date(e.start.getTime() + e.minutes * 60_000);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=${e.notify ? "all" : "none"}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t.access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: e.title.slice(0, 200),
      description: (e.description ?? "").slice(0, 2000),
      start: { dateTime: e.start.toISOString(), timeZone: a.tz },
      end: { dateTime: end.toISOString(), timeZone: a.tz },
      attendees: [{ email: e.email }],
      reminders: { useDefault: true },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new HttpError(res.status === 403 ? 403 : 502, `Google Calendar: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { id: string; htmlLink: string };
}

/** "Nathan<>Rohan Coffee Chat" when your first name is known (the Gmail address's display name isn't stored). */
export const inviteTitle = (theirName: string, myFirst?: string) => `${myFirst ? `${myFirst}<>` : ""}${theirName.split(/\s+/)[0]} Coffee Chat`;
