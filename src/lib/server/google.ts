import "server-only";
import { HttpError } from "./http";
import { unseal, type Account } from "./accounts";

/**
 * Server-side Gmail for automatic sending: the authorization-code flow with offline access (a refresh token, so sends
 * go out while the dashboard is closed). Uses the deployment's own Google client (GOOGLE_CLIENT_ID +
 * GOOGLE_CLIENT_SECRET); users never set anything up in Google Cloud. Scope: gmail.compose, which covers sending
 * existing drafts (drafts.send) and nothing else of the mailbox.
 */

export const SERVER_SCOPES = ["https://www.googleapis.com/auth/gmail.compose"];
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
    scope: SERVER_SCOPES.join(" "),
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
  return { access: j.access_token!, refresh: j.refresh_token };
}

export async function accessToken(a: Account) {
  if (!a.google) throw new HttpError(400, "Gmail isn't connected for automatic sending.");
  return (await tokenCall({ refresh_token: unseal(a.google.refresh), grant_type: "refresh_token" })).access_token!;
}

async function gmail<T>(access: string, path: string, init?: RequestInit) {
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
