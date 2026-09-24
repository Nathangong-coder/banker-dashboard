"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BellRing, Building2, LayoutGrid, Mail, Search, Settings2, Sheet, KeyRound, Loader2 } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { nextAction } from "@/lib/followups";
import { cn } from "@/lib/util";
import { Toaster } from "./ui";
import { GmailSyncWidget } from "./GmailSyncWidget";
import { aiReady, googleClientId, hasKey } from "@/lib/keys";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/coverage", label: "Bank coverage", icon: Building2 },
  { href: "/sheet", label: "Spreadsheet", icon: Sheet },
  { href: "/find", label: "Find people", icon: Search },
  { href: "/drafts", label: "Email drafts", icon: Mail },
  { href: "/followups", label: "Follow-ups", icon: BellRing },
  { href: "/settings", label: "Settings & keys", icon: Settings2 },
];

function useHydrated() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const done = async () => {
      const snaps = await blobs.snapshots();
      if (snaps) useStore.getState().setSnapshots(snaps);
      setReady(true);
    };
    if (useStore.persist.hasHydrated()) done();
    return useStore.persist.onFinishHydration(() => done());
  }, []);
  return ready;
}

/** While the dashboard is open, raise one browser notification per day for due follow-ups. */
function useDailyNudge(due: number) {
  useEffect(() => {
    if (!due || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = new Date().toDateString();
    try {
      if (localStorage.getItem("nudged") === today) return;
      localStorage.setItem("nudged", today);
    } catch {
      return;
    }
    new Notification("Follow-ups due", { body: `${due} banker${due > 1 ? "s" : ""} to follow up with today.` });
  }, [due]);
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const ready = useHydrated();
  const contacts = useStore((s) => s.contacts);
  const banks = useStore((s) => s.banks);
  const fu = useStore((s) => s.settings.followUp);
  const settings = useStore((s) => s.settings);
  const due = useMemo(
    () =>
      contacts.filter((c) => {
        const a = nextAction(c, fu, banks[`${c.bank}|${c.region}`]);
        return a.isDue && (a.kind === "follow_up" || a.kind === "move_on");
      }).length,
    [contacts, banks, fu],
  );
  useDailyNudge(ready ? due : 0);
  const keyCount = [
    hasKey(settings, "apollo") || hasKey(settings, "hunter"),
    hasKey(settings, "serper"),
    aiReady(settings),
    !!googleClientId(settings),
  ].filter(Boolean).length;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r border-[#0c1729] bg-navy text-[#c9d1de] md:flex">
        <div className="px-5 pt-6 pb-7">
          <div className="font-serif text-[26px] leading-none text-white">Coverage</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[#8793a8]">Networking desk</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition-colors",
                  active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className={cn("size-4", active ? "text-brass" : "text-[#7c89a0]")} />
                <span className="flex-1">{label}</span>
                {href === "/followups" && due > 0 && (
                  <span className="num rounded bg-brass px-1.5 text-[11px] font-medium text-white">{due}</span>
                )}
              </Link>
            );
          })}
        </nav>
        {ready && <GmailSyncWidget />}
        <Link href="/settings" className="mx-2.5 mb-4 flex items-center gap-2 rounded-md border border-white/10 px-3 py-2.5 text-[12px] hover:bg-white/5">
          <KeyRound className="size-3.5 text-brass" />
          <span>{keyCount}/4 services connected</span>
        </Link>
      </aside>

      {/* mobile nav */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-panel md:hidden">
        {NAV.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} aria-label={label} className={cn("flex flex-1 justify-center py-3", path === href ? "text-navy" : "text-muted")}>
            <Icon className="size-5" />
          </Link>
        ))}
      </div>

      <main className="min-w-0 flex-1 px-4 pt-8 pb-24 md:px-9 md:pb-10">
        {ready ? (
          <div className="mx-auto max-w-[1400px]">{children}</div>
        ) : (
          <div className="flex h-[60vh] items-center justify-center text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
      </main>
      <Toaster />
    </div>
  );
}
