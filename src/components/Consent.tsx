"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Button } from "./ui";

/**
 * Consent for analytics. The app needs browser storage to work (that's what it is), so that's disclosed, not asked.
 * Analytics (Vercel Web Analytics + Speed Insights: cookie-free page views and speed) load only after "OK"; "Essential
 * only" keeps them off. The choice lives in localStorage and can be changed under Settings → Backup.
 */
const KEY = "coverage:consent";
type Choice = "all" | "essential";

const listeners = new Set<() => void>();
function read(): Choice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return "essential";
  }
}
export function setConsent(c: Choice | null) {
  try {
    if (c) localStorage.setItem(KEY, c);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the banner just shows again next time */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
};
/** The visitor's choice; `undefined` while rendering on the server. */
export function useConsent(): Choice | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}

export function ConsentBanner() {
  const choice = useConsent();
  return (
    <>
      {choice === "all" && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
      {choice === null && (
        <div role="dialog" aria-label="Privacy notice" className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-[720px] rounded-lg border border-line-2 bg-panel p-4 shadow-lg md:bottom-4">
          <p className="text-[13px] leading-relaxed text-ink-2">
            Coverage keeps your contacts and settings <b>in this browser</b> (it can&apos;t work without that). With your OK, it also uses cookie-free analytics
            to count page views and measure speed. No ads, no tracking cookies.{" "}
            <Link href="/privacy" className="text-navy underline">
              Privacy Policy
            </Link>
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConsent("essential")}>
              Essential only
            </Button>
            <Button size="sm" variant="primary" onClick={() => setConsent("all")}>
              OK
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** Settings → Backup: change the analytics choice later. */
export function AnalyticsSetting() {
  const choice = useConsent();
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-2">
      <input type="checkbox" className="size-4 accent-navy" checked={choice === "all"} onChange={(e) => setConsent(e.target.checked ? "all" : "essential")} />
      Share cookie-free usage analytics (page views and page speed, no personal data)
    </label>
  );
}
