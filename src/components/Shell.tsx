"use client";

import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useExtensionBridge } from "@/lib/applyBridge";
import { useSaveShortcut } from "./useSaveShortcut";
import { nextAction } from "@/lib/followups";
import { upkeepPatches } from "@/lib/contactUpkeep";
import { Toaster, toast } from "./ui";
import { GmailSyncWidget } from "./GmailSyncWidget";
import { MobileMenu, ProfileMenu, SideNav, ThemeToggle } from "./AppNav";
import { CategoryBar, SyncButton } from "./NavBar";
import { GlobalSearch } from "./GlobalSearch";
import { lastRun, runBackgroundJobs, syncEveryMs } from "@/lib/backgroundJobs";
import { ConsentBanner } from "./Consent";
import { aiReady, googleClientId, hasKey } from "@/lib/keys";
import { sendWhatsAppDigest, textTime, whatsappDigest } from "@/lib/reminders";
import { callApi } from "@/lib/api";
import { syncServer } from "@/lib/serverSync";
import { setSignatureLogoSource } from "@/lib/gmail";
import { savedSignatureLogo } from "@/lib/signatureLogo";
import { Logo } from "./Logo";
import { useBoot } from "./useBoot";
import { useSession } from "@/lib/session";
import { DemoBar, LegacyBar, MoveData, SignInNeededModal, SignInScreen, SyncBadge, linkServerAccount } from "./Account";

// Every Gmail draft gets the signature logo saved in Settings (gmail.ts stays store-free for the check scripts).
setSignatureLogoSource(savedSignatureLogo);

/** Pages that render without waiting for the local store (no personal data on them). */
const PUBLIC_PATHS = ["/privacy", "/terms", "/capture", "/agent-practice", "/welcome", "/extension", "/extension/privacy", "/extension/support"];
/** Pages with their own chrome (the landing page): no app header or sidebar. */
const BARE_PATHS = ["/welcome", "/extension", "/extension/privacy", "/extension/support"];

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
/** When the server last got a sync from this tab, and the send queue it got (module-level: survives re-renders). */
const lastServerSync = { at: 0, sends: "" };

/** Names First Last + automatic move-ons (lib/contactUpkeep.ts): after load, after changes, and every 10 minutes. */
function useContactUpkeep(ready: boolean) {
  const contacts = useStore((s) => s.contacts);
  const fu = useStore((s) => s.settings.followUp);
  const banks = useStore((s) => s.banks);
  useEffect(() => {
    if (!ready) return;
    const run = () => {
      const st = useStore.getState();
      const list = upkeepPatches(st.contacts, st.settings.followUp, st.banks, new Date(), st.settings.profile.phone);
      if (list.length) st.updateContacts(list);
    };
    const t = setTimeout(run, 1500);
    const i = setInterval(run, 10 * 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [ready, contacts, fu, banks]);
}

/**
 * The background jobs (Gmail scans, conversations, the AI's noise read, calendar chats, chat docs, the server sync,
 * the browser's Gmail sync) on one schedule: `settings.syncEvery` (default every 6 hours; "manual" = only the Sync
 * button). Checked 30 s after load and every 5 minutes while the tab is visible (lib/backgroundJobs.ts).
 */
function useSentScan(ready: boolean) {
  const every = useStore((s) => s.settings.syncEvery);
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const ms = syncEveryMs({ syncEvery: every });
      if (ms !== null && Date.now() - lastRun() >= ms) void runBackgroundJobs();
    };
    const t = setTimeout(check, 30_000);
    const i = setInterval(check, 5 * 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [ready, every]);
}

function useServerSync(ready: boolean) {
  const connected = useStore((s) => !!s.settings.server?.email);
  // Open tracking reads its pixel hits through the same sync, with or without automatic sending.
  const tracking = useStore((s) => !!s.settings.tracking?.on || s.tracking.messages.length > 0);
  const syncing = connected || tracking;
  const contacts = useStore((s) => s.contacts);
  const settings = useStore((s) => s.settings);
  // Only the send queue and the text settings sync right away (a few seconds later, at most every 2 minutes unless the
  // queue changed). Contact edits wait for the schedule (owner, 2026-11-23: it ran ~15×/hour on every contact change).
  const sends = contacts
    .filter((c) => c.serverSend)
    .map((c) => `${c.serverSend!.draftId}@${c.serverSend!.sendAt}`)
    .join(",");
  useEffect(() => {
    if (!ready || !syncing) return;
    const run = () => {
      lastServerSync.at = Date.now();
      lastServerSync.sends = sends;
      return syncServer().catch(() => undefined);
    };
    const wait = sends !== lastServerSync.sends ? 4000 : Math.max(4000, lastServerSync.at + 120_000 - Date.now());
    const t = setTimeout(run, wait);
    // Before the 9 PM text: a tab open between 7 and 9 PM sends a fresh plan (at most hourly), so tonight's list
    // reflects today even with a 6-hour (or manual) background schedule.
    const evening = setInterval(() => {
      const h = new Date().getHours();
      if (h >= 19 && h < 21 && Date.now() - lastServerSync.at > 3600_000) void run();
    }, 10 * 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(evening);
    };
  }, [ready, syncing, sends, settings.followUp, settings.keys.whatsappPhone, settings.keys.whatsappApiKey, settings.alerts]);
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { ready: booted, move, finishMove } = useBoot();
  const mode = useSession((s) => s.mode);
  const ready = booted && mode !== "blocked";
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
  useContactUpkeep(ready);
  useSentScan(ready && mode !== "demo");
  // The demo's made-up data never goes to the extension (it would fill real forms with it).
  useExtensionBridge(ready && mode !== "demo");
  useAccountLink(mode === "account");
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

  // docs/DESIGN.md G-1 (global header: navy, 48 px, logo, search, utilities) + G-2 (white navigation bar of tabs).
  return (
    <div className="flex min-h-screen flex-col">
      {/* Two rows (owner, 2026-11-23): logo + search + utilities, then the categories (components/NavBar.tsx). */}
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-top-line bg-top pr-2 text-top-ink md:gap-3 md:px-3">
        <MobileMenu path={path} badge={badge} footer={ready ? <GmailSyncWidget /> : null} />
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <Logo size={26} />
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Coverage</span>
        </Link>
        <div className="flex min-w-0 flex-1 justify-center">{ready && !isPublic && <GlobalSearch className="w-full max-w-[560px]" />}</div>
        <div className="flex shrink-0 items-center gap-1">
          {ready && !isPublic && <SyncButton />}
          <Link
            href="/settings?tab=data"
            title={`${keyCount}/4 services connected`}
            className="hidden h-8 items-center gap-1.5 rounded px-2 text-[12px] text-top-muted hover:bg-hover hover:text-top-ink 2xl:flex"
          >
            <KeyRound className="size-3.5" />
            {keyCount}/4
          </Link>
          <SyncBadge />
          <ThemeToggle />
          <ProfileMenu path={path} />
        </div>
      </header>
      {!isPublic && <CategoryBar path={path} badge={badge} />}
      {booted && !isPublic && mode === "demo" && <DemoBar />}
      {booted && !isPublic && mode === "legacy" && <LegacyBar />}

      <div className="flex min-h-0 flex-1">
        {!isPublic && <SideNav path={path} badge={badge} />}
        <main className="min-w-0 flex-1 px-4 pt-3 pb-16 md:px-3 md:pb-6">
          {/* Legal pages and the 404 don't need the store: render them straight away (crawlers and Google's reviewers read them). */}
          {isPublic ? (
            <div className="mx-auto max-w-[1440px]">{children}</div>
          ) : move ? (
            <MoveData legacy={move.legacy} onDone={finishMove} />
          ) : booted && mode === "blocked" ? (
            <SignInScreen />
          ) : ready ? (
            <div className="mx-auto max-w-[1440px]">{children}</div>
          ) : (
            <div className="flex h-[60vh] items-center justify-center text-muted">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}
        </main>
      </div>
      <Toaster />
      <SignInNeededModal />
      <ConsentBanner />
    </div>
  );
}

/** Signed in: tie this browser's automatic-sending account to the user whenever it isn't yet (or was just made). */
function useAccountLink(on: boolean) {
  const serverId = useStore((s) => s.settings.server?.id);
  const linked = useSession((s) => s.user?.accountId);
  useEffect(() => {
    if (on && serverId && serverId !== linked) void linkServerAccount().catch(() => undefined);
  }, [on, serverId, linked]);
}
