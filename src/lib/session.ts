"use client";

import { create } from "zustand";

/**
 * Accounts (owner, 2026-10-25): who's signed in on this browser and what the tab is showing.
 * - "account": a signed-in user's data (their account, cached in this browser);
 * - "legacy": this browser's data from before accounts, signed out (allowed until sign-in is required:
 *   NEXT_PUBLIC_SIGNIN_REQUIRED=1), with a "Sign in to sync" banner;
 * - "demo": sample data, nothing saved; real actions ask you to sign in.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  accountId: string | null;
}
export type Mode = "loading" | "account" | "legacy" | "demo" | "blocked";

export const useSession = create<{ user: SessionUser | null; mode: Mode; checked: boolean }>(() => ({ user: null, mode: "loading", checked: false }));

export const SIGNIN_REQUIRED = process.env.NEXT_PUBLIC_SIGNIN_REQUIRED === "1";

export async function fetchUser(): Promise<SessionUser | null> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't check your sign-in (${res.status}).`);
  return ((await res.json()) as { user: SessionUser | null }).user;
}

export const signInHref = (returnTo?: string) =>
  `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search))}`;

export const isDemo = () => useSession.getState().mode === "demo";

/** Thrown by anything that needs an account while showing the demo; Shell opens the "Sign in to do this" box. */
export class SignInNeeded extends Error {
  constructor(what = "do this") {
    super(`Sign in to ${what}.`);
  }
}
/** In the demo: open "Sign in to …" and return true (the caller stops). Signed in / old data: false. */
export function askSignIn(what: string) {
  if (!isDemo()) return false;
  window.dispatchEvent(new CustomEvent("coverage:signin-needed", { detail: what }));
  return true;
}
export function requireAccount(what?: string) {
  if (!isDemo()) return;
  window.dispatchEvent(new CustomEvent("coverage:signin-needed", { detail: what }));
  throw new SignInNeeded(what);
}
