"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/** Set once a visitor chooses the dashboard, so "/" stops sending them to the landing page (app/page.tsx#useLandingRedirect). */
export const STARTED_KEY = "coverage:started";

export function markStarted() {
  try {
    localStorage.setItem(STARTED_KEY, "1");
  } catch {
    // Private window / storage blocked: "/" just shows the landing again next time.
  }
}

export function StartLink({ href = "/", className, children }: { href?: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={className} onClick={markStarted}>
      {children}
    </Link>
  );
}
