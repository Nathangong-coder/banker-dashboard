"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BellRing, Building2, LayoutGrid, Mail, Search, Settings2, Sheet, KeyRound, Loader2, Coffee, FlaskConical, Trophy, Presentation, NotebookPen, CalendarDays } from "lucide-react";
import { blobs, useStore } from "@/lib/store";
import { FORMAT_VERSION, readFormats, withInternalLinks } from "@/lib/workbook";
import { readInternalLinks } from "@/lib/sheetLinks";
import { useSaveShortcut } from "./useSaveShortcut";
import { nextAction } from "@/lib/followups";
import { cn } from "@/lib/util";
import { Toaster, toast } from "./ui";
import { GmailSyncWidget } from "./GmailSyncWidget";
import { ConsentBanner } from "./Consent";
import { aiReady, googleClientId, hasKey } from "@/lib/keys";
import { sendWhatsAppDigest, textTime, whatsappDigest } from "@/lib/reminders";
import { callApi } from "@/lib/api";
import { syncServer } from "@/lib/serverSync";
import { setSignatureLogoSource } from "@/lib/gmail";
import { savedSignatureLogo } from "@/lib/signatureLogo";

// Every Gmail draft gets the signature logo saved in Settings (gmail.ts stays store-free for the check scripts).
setSignatureLogoSource(savedSignatureLogo);

/** Pages that render without waiting for the local store (no personal data on them). */
const PUBLIC_PATHS = ["/privacy", "/terms", "/capture", "/agent-practice", "/welcome", "/extension", "/extension/privacy", "/extension/support"];
/** Pages with their own chrome (the landing page): no app header or sidebar. */
const BARE_PATHS = ["/welcome", "/extension", "/extension/privacy", "/extension/support"];

/**
 * Two-level navigation (owner, 2026-10-19): the top bar picks a group, the sidebar lists that group's pages. The group
 * follows the current page, so a deep link lands with the right sidebar.
 */
const GROUPS = [
  {
    label: "Overview",
    pages: [
      { href: "/", label: "Dashboard", icon: LayoutGrid },
      { href: "/coverage", label: "Bank coverage", icon: Building2 },
      { href: "/firms", label: "Firms", icon: Trophy },
      { href: "/sheet", label: "Spreadsheet", icon: Sheet },
    ],
  },
  {
    label: "Outreach",
    pages: [
      { href: "/find", label: "Find people", icon: Search },
      { href: "/drafts", label: "Email drafts", icon: Mail },
      { href: "/lab", label: "Email lab", icon: FlaskConical },
    ],
  },
  {
    label: "Prep & reminders",
    pages: [
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/followups", label: "Follow-ups", icon: BellRing },
      { href: "/prep", label: "Coffee chat prep", icon: Coffee },
      { href: "/log", label: "Activity log", icon: NotebookPen },
      { href: "/info-sessions", label: "Info sessions", icon: Presentation },
    ],
  },
  { label: "Settings", pages: [{ href: "/settings", label: "Settings", icon: Settings2 }] },
];

const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));
const groupOf = (path: string) => GROUPS.find((g) => g.pages.some((p) => isActive(p.href, path))) ?? GROUPS[0];

function useHydrated() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const done = async () => {
      const snaps = await blobs.snapshots();
      if (snaps) useStore.getState().setSnapshots(snaps);
      setReady(true);
      // Every bank on the lists gets a tab and an OVERVIEW row (pending until saved), without needing a re-import.
      if (snaps?.length) {
        // Loaded after first paint: the spreadsheet code isn't needed to show the page.
        const { describeTabChanges, refreshBankTabs } = await import("@/lib/actions");
        const text = describeTabChanges(refreshBankTabs() ?? { added: [], renamed: [], repaired: [], listed: [], coverageRows: [], skipped: [] });
        if (text) toast.info(`Spreadsheet tabs: ${text}`);
      }
      if (snaps?.length && snaps.some((s) => s.format?.version !== FORMAT_VERSION)) {
        const buf = await blobs.workbook();
        if (!buf) return;
        const [formats, links] = await Promise.all([readFormats(buf), readInternalLinks(buf)]);
        // Imports from before FORMAT_VERSION 2 also lost the links between tabs.
        const next = useStore.getState().snapshots.map((s) =>
          formats[s.name] ? { ...s, format: formats[s.name], cells: withInternalLinks(s.cells, links[s.name]) } : s,
        );
        useStore.getState().setSnapshots(next);
        blobs.setSnapshots(next);
      }
    };
    if (useStore.persist.hasHydrated()) done();
    return useStore.persist.onFinishHydration(() => done());
  }, []);
  return ready;
}

/**
 * Edits made in Excel while the dashboard is open (Referral? ticked, a status changed) are read back when you come
 * back to the tab and every minute while it's visible, so the stats follow the spreadsheet without a re-import.
 */
function useExcelEdits(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const { pickUpExcelEdits } = await import("@/lib/actions");
      if (await pickUpExcelEdits()) toast.info("Picked up your edits from Excel.");
    };
    check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [ready]);
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

/**
 * The 9 PM WhatsApp list (CallMeBot), sent by this browser when automatic sending isn't on: Monday–Thursday nights,
 * the first time the dashboard is open at or after 9 PM (a tab left open fires at 9). A night the dashboard is never
 * opened gets no message; the server (Follow-ups → Reminders → Automatic sending) sends it with the dashboard closed.
 */
function useDailyWhatsApp(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const s = useStore.getState();
      const k = s.settings.keys;
      if (!k.whatsappPhone || !k.whatsappApiKey || s.settings.alerts?.whatsappDaily === false) return;
      // The server sends it (at 9 PM even with the dashboard closed); don't double up.
      if (s.settings.server?.email) return;
      const now = new Date();
      const at = textTime(now.toLocaleDateString("en-CA"));
      if (now < at) {
        timer = setTimeout(run, Math.min(at.getTime() - now.getTime() + 1000, 2 ** 31 - 1));
        return;
      }
      const digest = whatsappDigest(s.contacts, s.banks, s.settings.followUp);
      const key = `whatsapp:${digest?.day ?? now.toLocaleDateString("en-CA")}`;
      if (!digest || s.scheduled[key]) return;
      // Other open tabs: only one sends.
      try {
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, now.toISOString());
      } catch {
        /* no storage: the persisted marker below still stops repeats */
      }
      s.markScheduled(key, now.toISOString());
      try {
        const n = await sendWhatsAppDigest(digest, (title, message) =>
          callApi("/api/notify", { channel: "whatsapp", title, message, whatsapp: { phone: k.whatsappPhone, apiKey: k.whatsappApiKey } }, s.settings),
        );
        toast.ok(`WhatsApp: sent tonight's list${digest.count ? ` (${digest.count} ${digest.count > 1 ? "people" : "person"}${n > 1 ? `, ${n} messages` : ""})` : ""}.`);
      } catch (e) {
        // Let a later page load retry today.
        const rest = { ...useStore.getState().scheduled };
        delete rest[key];
        useStore.setState({ scheduled: rest });
        try {
          localStorage.removeItem(key);
        } catch {}
        toast.err(`WhatsApp reminder failed: ${(e as Error).message}`);
      }
    };
    run();
    return () => clearTimeout(timer);
  }, [ready]);
}

/**
 * Keep the server's copy current (lib/serverSync.ts): the send queue and the next two weeks of 9am texts, pushed a few
 * seconds after anything changes and every 10 minutes (which also pulls in sends the server made while away).
 */
function useServerSync(ready: boolean) {
  const connected = useStore((s) => !!s.settings.server?.email);
  const contacts = useStore((s) => s.contacts);
  const settings = useStore((s) => s.settings);
  useEffect(() => {
    if (!ready || !connected) return;
    const run = () => syncServer().catch(() => undefined);
    const t = setTimeout(run, 4000);
    return () => clearTimeout(t);
  }, [ready, connected, contacts, settings.followUp, settings.keys.whatsappPhone, settings.keys.whatsappApiKey, settings.alerts]);
  useEffect(() => {
    if (!ready || !connected) return;
    const i = setInterval(() => syncServer().catch(() => undefined), 10 * 60_000);
    return () => clearInterval(i);
  }, [ready, connected]);
  // Chats → their Google Docs (lib/chatDocs.ts): a Drive search for chats with no doc, at most once a day each.
  useEffect(() => {
    if (!ready || !connected) return;
    const run = () => void import("@/lib/chatDocs").then((m) => m.linkChatDocs()).catch(() => undefined);
    const t = setTimeout(run, 20_000);
    const i = setInterval(run, 30 * 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [ready, connected]);
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const ready = useHydrated();
  const isPublic = PUBLIC_PATHS.includes(path);
  useSaveShortcut();
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
  useDailyWhatsApp(ready);
  useExcelEdits(ready);
  useServerSync(ready);
  // The server switched to a backup model (primary hit a rate/quota limit): say so once per model.
  useEffect(() => {
    const seen = new Set<string>();
    // Say which models were skipped and why, once per distinct situation this session.
    const on = (e: Event) => {
      const { model, skipped } = (e as CustomEvent<{ model: string; skipped: { model: string; reason: string }[] }>).detail;
      const why = skipped.map((s) => `${s.model} ${s.reason}`).join("; ");
      const key = `${model}|${why}`;
      if (seen.has(key)) return;
      seen.add(key);
      toast.info(`${why ? `${why}. ` : ""}Answered by ${model.split("/").pop()} instead.`);
    };
    // A model used up its daily quota on a key: it's skipped (no wasted round trips) until midnight PT.
    const onSpent = (e: Event) => {
      const fresh = (e as CustomEvent<string[]>).detail.filter((m) => !seen.has(`spent:${m}`));
      if (!fresh.length) return;
      fresh.forEach((m) => seen.add(`spent:${m}`));
      toast.info(`${fresh.join(", ")} used up today's quota. Skipping straight to your next model until midnight PT.`);
    };
    window.addEventListener("ai-fallback", on);
    window.addEventListener("ai-exhausted", onSpent);
    return () => {
      window.removeEventListener("ai-fallback", on);
      window.removeEventListener("ai-exhausted", onSpent);
    };
  }, []);
  const keyCount = [
    hasKey(settings, "apollo") || hasKey(settings, "hunter"),
    hasKey(settings, "serper"),
    aiReady(settings),
    !!googleClientId(settings),
  ].filter(Boolean).length;

  const group = groupOf(path);
  const toReview = useStore((s) => s.infoSessions.reduce((n, x) => n + (x.pending?.length ?? 0), 0));
  const badge = (href: string) => (href === "/followups" ? due : href === "/info-sessions" ? toReview : 0);

  if (BARE_PATHS.includes(path))
    return (
      <>
        {children}
        <Toaster />
        <ConsentBanner />
      </>
    );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center border-b border-top-line bg-top text-top-ink">
        <Link href="/" className="flex h-full shrink-0 items-center gap-2.5 px-4 md:w-[232px] md:px-5">
          <span className="grid size-7 place-items-center rounded-lg bg-brass-strong text-[13px] font-semibold text-white">C</span>
          <span className="hidden text-[16px] font-medium tracking-tight sm:inline">Coverage</span>
        </Link>
        <nav className="flex h-full min-w-0 flex-1 overflow-x-auto" aria-label="Sections">
          {GROUPS.filter((g) => g.label !== "Settings").map((g) => {
            const on = g === group;
            return (
              <Link
                key={g.label}
                href={g.pages[0].href}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "relative flex h-full shrink-0 items-center px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors md:px-4",
                  on ? "text-top-ink" : "text-top-muted hover:text-top-ink",
                )}
              >
                {g.label}
                {on && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-brass md:inset-x-4" />}
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1 pr-3 md:pr-4">
          <Link
            href="/settings?tab=data"
            title={`${keyCount}/4 services connected`}
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-top-muted hover:text-top-ink lg:flex"
          >
            <KeyRound className="size-3.5" />
            {keyCount}/4
          </Link>
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className={cn("grid size-9 place-items-center rounded-lg transition-colors hover:bg-top-ink/10", group.label === "Settings" ? "text-top-ink" : "text-top-muted")}
          >
            <Settings2 className="size-[18px]" />
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[232px] shrink-0 flex-col overflow-y-auto border-r border-top-line bg-side px-2.5 py-4 text-side-ink md:flex">
          <div className="px-3 pb-2.5 text-[11px] font-medium tracking-[0.08em] text-side-muted uppercase">{group.label}</div>
          <nav className="flex flex-col gap-0.5">
            {group.pages.map(({ href, label, icon: Icon }) => {
              const active = isActive(href, path);
              const n = badge(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                    active ? "bg-side-active" : "hover:bg-side-hover",
                  )}
                >
                  {active && <span className="absolute top-2 bottom-2 -left-2.5 w-[3px] rounded-r bg-side-mark" />}
                  <Icon className={cn("size-[18px] shrink-0", active ? "opacity-100" : "opacity-75")} />
                  <span className="flex-1">{label}</span>
                  {n > 0 && <span className="num rounded-full bg-brass-strong px-1.5 text-[11px] font-medium text-white">{n}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto pt-4">
            {ready && <GmailSyncWidget />}
            <div className="flex gap-3 px-3 pt-1 text-[11px] text-side-muted">
              <Link href="/privacy" className="hover:text-side-ink">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-side-ink">
                Terms
              </Link>
            </div>
          </div>
        </aside>

        {/* Phones: the group's pages as a strip under the top bar. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-panel px-3 py-2 md:hidden" aria-label={group.label}>
            {group.pages.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn("shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap", isActive(href, path) ? "bg-navy text-white" : "text-ink-2 hover:bg-hover")}
              >
                {label}
                {badge(href) > 0 && <span className="num ml-1.5 opacity-80">{badge(href)}</span>}
              </Link>
            ))}
          </nav>
      <main className="min-w-0 flex-1 px-4 pt-6 pb-16 md:px-9 md:pt-7 md:pb-10">
        {/* Legal pages and the 404 don't need the store: render them straight away (crawlers and Google's reviewers read them). */}
        {ready || isPublic ? (
          <div className="mx-auto max-w-[1320px]">{children}</div>
        ) : (
          <div className="flex h-[60vh] items-center justify-center text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
      </main>
        </div>
      </div>
      <Toaster />
      <ConsentBanner />
    </div>
  );
}
