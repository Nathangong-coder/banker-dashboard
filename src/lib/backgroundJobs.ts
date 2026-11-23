/**
 * Everything Coverage does in the background, on ONE schedule (owner, 2026-11-23: "stop having it sync every 3 seconds
 * and syncing with my gmail - have it run on a schedule (or manual if they press it)"). Vercel showed the server sync
 * ~15×/h and the sent-mail scan ~20×/h before this: they ran on every contact change, every 15 minutes and hourly.
 *
 * `settings.syncEvery`: "2h" | "6h" (default) | "24h" | "manual". The header's Sync button runs it all now. Your own
 * edits still save to your account on their own (lib/sync.ts, 20 s after you stop), and a change to the emails queued
 * to send still reaches the server right away (Shell#useServerSync) so sends go out on time.
 */
import type { Settings } from "./types";
import { useStore } from "./store";
import { create } from "zustand";

export type SyncEvery = NonNullable<Settings["syncEvery"]>;
export const SYNC_EVERY: { id: SyncEvery; label: string }[] = [
  { id: "2h", label: "Every 2 hours" },
  { id: "6h", label: "Every 6 hours" },
  { id: "24h", label: "Once a day" },
  { id: "manual", label: "Only when I press Sync" },
];
const MS: Record<SyncEvery, number | null> = { "2h": 2 * 3600_000, "6h": 6 * 3600_000, "24h": 24 * 3600_000, manual: null };
export const syncEveryMs = (s: Pick<Settings, "syncEvery">) => MS[s.syncEvery ?? "6h"];

const LAST = "coverage:bg:last";
export const lastRun = () => {
  try {
    return Number(localStorage.getItem(LAST) ?? 0);
  } catch {
    return 0;
  }
};

export const useBackground = create<{ running: boolean; at: number; step?: string }>(() => ({ running: false, at: 0 }));

let running: Promise<void> | null = null;

/** Run every background job once (single-flight). `manual`: you pressed Sync (reads more, and pulls your account). */
export function runBackgroundJobs(opts: { manual?: boolean } = {}) {
  if (running) return running;
  running = (async () => {
    useBackground.setState({ running: true, step: "Starting…" });
    try {
      localStorage.setItem(LAST, String(Date.now()));
    } catch {}
    const st = () => useStore.getState();
    const step = (s: string) => useBackground.setState({ step: s });
    const quietly = async (label: string, fn: () => Promise<unknown>) => {
      step(label);
      try {
        await fn();
      } catch {
        /* one job failing doesn't stop the rest */
      }
    };
    const server = !!st().settings.server?.id;
    const google = !!st().settings.server?.email;
    if (opts.manual) await quietly("Saving and pulling your account…", async () => (await import("./sync")).syncNow());
    if (server) await quietly("Reading Gmail's scheduled emails…", async () => (await import("./gmailScheduled")).applyGmailScheduled());
    const g = await import("./gmailSync");
    await quietly("Reading sent mail…", () => g.scanOffSheet({ interactive: false }));
    await quietly("Counting chats from thank-yous…", () => g.scanThankYous({ force: opts.manual }));
    await quietly("Reading conversations…", async () => (await import("./ledgerSync")).syncLedgers(opts.manual ? { max: 120 } : { max: 30 }));
    await quietly("Checking what needs you…", async () => (await import("./triageRun")).runTriage());
    if (google) await quietly("Reading your calendar…", async () => (await import("@/components/CalendarActions")).backfillCalendarChats());
    if (google) await quietly("Linking chat notes…", async () => (await import("./chatDocs")).linkChatDocs());
    // The browser's own Gmail token (when you connected it this session): dates, replies, drafts.
    const { gmailConnected } = await import("./gmail");
    const { googleClientId } = await import("./keys");
    if (gmailConnected(googleClientId(st().settings))) await quietly("Syncing Gmail…", () => g.syncAllWithGmail({ interactive: false }));
    await quietly("Updating Gmail labels…", async () => (await import("./gmailLabelsRun")).autoLabels());
    // Last, so tonight's 9 PM plan the server gets is built from everything just read.
    if (server || st().settings.tracking?.on) await quietly("Syncing with the server…", async () => (await import("./serverSync")).syncServer());
  })().finally(() => {
    running = null;
    useBackground.setState({ running: false, at: Date.now(), step: undefined });
  });
  return running;
}
