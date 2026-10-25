import "server-only";
import { HttpError } from "./http";

/**
 * "Sign in with Google" (owner, 2026-10-25): the authorization-code flow on the deployment's own Google client, asking
 * only for name + email (no warning screen). Gmail / Calendar / Docs are a separate "Connect Google" step
 * (lib/server/google.ts). The ID token comes straight from Google's token endpoint over TLS, so its claims are checked
 * (issuer, audience, expiry, verified email) without fetching Google's signing keys (OpenID Connect Core 3.1.3.7).
 */

export const SIGNIN_CALLBACK = "/api/auth/google/callback";

function client() {
  const id = process.env.GOOGLE_CLIENT_ID ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, "Sign-in isn't set up on this server (Google client id/secret missing).");
  return { id, secret };
}

export function signInUrl(redirectUri: string, state: string, loginHint?: string) {
  const q = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export async function exchangeSignIn(code: string, redirectUri: string): Promise<GoogleProfile> {
  const { id, secret } = client();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, code, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const j = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.id_token) throw new HttpError(502, `Google: ${j.error_description ?? j.error ?? res.statusText}`);
  const claims = decodeJwt(j.id_token);
  const now = Date.now() / 1000;
  if (!["accounts.google.com", "https://accounts.google.com"].includes(String(claims.iss))) throw new HttpError(401, "Google's answer didn't come from Google.");
  if (claims.aud !== id) throw new HttpError(401, "Google's answer was for another app.");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new HttpError(401, "Google's answer expired. Sign in again.");
  if (!claims.sub || !claims.email) throw new HttpError(401, "Google didn't share your email address.");
  if (claims.email_verified === false) throw new HttpError(401, "Verify your Google account's email address first.");
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: claims.name ? String(claims.name) : undefined, picture: claims.picture ? String(claims.picture) : undefined };
}

function decodeJwt(t: string): Record<string, unknown> {
  const part = t.split(".")[1];
  if (!part) throw new HttpError(502, "Google sent an unreadable sign-in token.");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}
