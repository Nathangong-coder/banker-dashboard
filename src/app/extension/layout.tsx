import type { ReactNode } from "react";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { ExtensionTabs } from "@/components/landing/ExtensionTabs";

/**
 * Everything about the browser extension in one place (owner, 2026-10-23; the Chrome Web Store listing links here):
 * /extension (what it does, install, permissions), /extension/privacy (the extension's own privacy policy, the
 * listing's privacy URL) and /extension/support (help, contact, changes). Public pages with the landing nav, rendered
 * bare by Shell (BARE_PATHS). The extension itself lives in extension/ (README = store steps).
 */
export default function ExtensionLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <LandingNav />
      <ExtensionTabs />
      <main className="mx-auto max-w-6xl px-4 pt-10 pb-20">{children}</main>
      <LandingFooter />
    </div>
  );
}
