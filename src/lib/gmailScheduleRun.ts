"use client";

import { useStore } from "./store";
import { handoffItems } from "./handoff";
import { sendCommand } from "./applyBridge";

/**
 * A (owner, 2026-11-23): the extension opens each waiting draft in your Gmail tab and uses Gmail's own Schedule send
 * at its time (extension/background.js#scheduleInGmail). What it reports is only used for failures; success is read
 * back from Gmail's Scheduled folder (lib/gmailScheduled.ts → lib/handoff.ts#confirmHandoff). Returns a summary line.
 */
type Result = { id: string; ok: boolean; error?: string };

export async function runGmailSchedule(): Promise<string> {
  const items = handoffItems(useStore.getState().contacts);
  if (!items.length) return "Nothing waiting to be scheduled.";
  // ~20 s per email (open the draft, the picker, Gmail's confirmation) plus a margin.
  const r = await sendCommand<{ results: Result[] }>(
    "scheduleInGmail",
    { items: items.map((i) => ({ id: i.id, to: i.to, subject: i.subject, messageId: i.messageId, at: i.at })) },
    60_000 + items.length * 30_000,
  );
  const now = new Date().toISOString();
  const failed = r.results.filter((x) => !x.ok);
  const st = useStore.getState();
  st.updateContacts(
    failed.map((f) => {
      const c = st.contacts.find((x) => x.id === f.id);
      return { id: f.id, patch: { gmailSchedule: c?.gmailSchedule ? { ...c.gmailSchedule, state: "failed" as const, error: f.error ?? "unknown error", updatedAt: now } : undefined } };
    }),
  );
  // Confirm from Gmail itself (needs the server's read access; otherwise they stay "waiting" until the next sync).
  const { applyGmailScheduled } = await import("./gmailScheduled");
  await applyGmailScheduled().catch(() => 0);
  const ok = r.results.length - failed.length;
  return `${ok} scheduled in Gmail${failed.length ? `, ${failed.length} not (${failed[0].error})` : ""}. Each turns "In Gmail" once Gmail's Scheduled folder shows it.`;
}
