"use client";

import { useStore } from "./store";
import type { Contact } from "./types";

/**
 * Gmail's Schedule send → contacts (owner, 2026-11-23 audit: 16 emails were scheduled for Nov 24 and the dashboard
 * knew 5; Rohan Desai showed as "went quiet" with a check-in already scheduled). Each contact gets the earliest
 * future send to them as `scheduledAt` (Cold outreach shows them as Scheduled, Warm follow-ups and the 9 PM text skip
 * them); a scheduled time that's no longer in Gmail is cleared (you sent it early or cancelled it). The list itself is
 * kept for Ongoing outreach, with its labels (a "DO NOT SEND" / "HOLD" label on a scheduled email is flagged there).
 */
type Item = { at: string; to: string[]; subject: string; labels: string[]; threadId: string };

let running: Promise<number> | null = null;

export function applyGmailScheduled(): Promise<number> {
  if (running) return running;
  running = (async () => {
    const st = useStore.getState();
    if (!st.settings.server?.id) return 0;
    const { serverCall } = await import("./serverSync");
    const r = await serverCall<{ read: boolean; items: Item[] }>("/api/server/scheduled", {});
    if (!r.read) return 0;
    const now = Date.now();
    const soonest = new Map<string, string>();
    for (const it of r.items) {
      if (Date.parse(it.at) <= now) continue;
      for (const e of it.to) if (!soonest.has(e) || it.at < soonest.get(e)!) soonest.set(e, it.at);
    }
    const patches: { id: string; patch: Partial<Contact> }[] = [];
    for (const c of useStore.getState().contacts) {
      const at = [c.email, ...(c.aliases ?? [])].filter(Boolean).map((e) => soonest.get(e.trim().toLowerCase())).filter((x): x is string => !!x).sort()[0];
      const future = c.scheduledAt && Date.parse(c.scheduledAt) > now;
      if (at && at !== c.scheduledAt) patches.push({ id: c.id, patch: { scheduledAt: at } });
      else if (!at && future) patches.push({ id: c.id, patch: { scheduledAt: undefined } });
    }
    if (patches.length) useStore.getState().updateContacts(patches);
    useStore.getState().setOffSheet({ scheduled: r.items, scheduledCheckedAt: new Date().toISOString() });
    return patches.length;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Labels that mean "don't send this" on a scheduled email. */
export const STOP_LABEL = /do not send|moved on|hold/i;
