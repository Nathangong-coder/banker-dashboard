"use client";

import { useStore } from "./store";
import { pendingFollowUpDraft } from "./followups";
import { planSends, windowOf } from "./sendWindow";
import { googleClientId } from "./keys";
import { draftMessageId } from "./gmail";
import { notBeforeOf, syncServer } from "./serverSync";
import { FOLLOW_UP_SPREAD } from "./sendWindow";
import type { Contact, GmailSchedule } from "./types";

/**
 * Put Gmail drafts on the "to schedule in Gmail" list (lib/handoff.ts) at their send slots: the same slot rules as
 * Coverage's own sending (send window, 6–8 days after the last email, random minute). Anyone already queued for
 * Coverage to send, or with no Gmail draft, is left out. Returns how many were added.
 */
export async function addToHandoff(people: Contact[], opts: { checkIn?: boolean } = {}): Promise<number> {
  const st = useStore.getState();
  const clientId = googleClientId(st.settings);
  const ready: { c: Contact; draftId: string; messageId?: string; subject: string; step: number }[] = [];
  for (const c of people) {
    if (c.serverSend || c.gmailSchedule?.state === "scheduled") continue;
    const fu = pendingFollowUpDraft(c);
    // A reply in their thread: its subject is "Re: …", so only the recipient is checked before scheduling.
    if (fu) ready.push({ c, draftId: fu.gmailDraftId, messageId: fu.messageId, subject: "", step: opts.checkIn ? -1 : fu.step });
    else if (c.status === "drafted" && c.draft?.gmailDraftId && !c.sentAt) ready.push({ c, draftId: c.draft.gmailDraftId, subject: c.draft.subject, step: 0 });
  }
  // First-email drafts don't keep their message id: ask Gmail (the draft link needs it).
  for (const r of ready) if (!r.messageId && clientId) r.messageId = (await draftMessageId(clientId, r.draftId).catch(() => null)) ?? undefined;
  const usable = ready.filter((r) => r.messageId);
  const ids = new Set(usable.map((r) => r.c.id));
  const taken = st.contacts
    .filter((c) => !ids.has(c.id))
    .flatMap((c) => [c.serverSend?.sendAt, c.gmailSchedule?.state !== "failed" ? c.gmailSchedule?.at : undefined])
    .filter((x): x is string => !!x && Date.parse(x) > Date.now())
    .map((x) => new Date(x));
  const minGapDays = Math.max(1, st.settings.followUp.firstAfterDays - FOLLOW_UP_SPREAD);
  // A check-in isn't timed from your last email: the next open slot.
  const plan = planSends(
    usable.map((r) => r.c),
    windowOf(st.settings),
    { taken, notBefore: opts.checkIn ? () => undefined : notBeforeOf, minGapDays },
  );
  const now = new Date().toISOString();
  const patches: { id: string; patch: Partial<Contact> }[] = [];
  for (const r of usable) {
    const at = plan.get(r.c.id);
    if (!at) continue;
    const g: GmailSchedule = { draftId: r.draftId, messageId: r.messageId!, subject: r.subject, step: r.step, at: at.toISOString(), state: "waiting", updatedAt: now };
    patches.push({ id: r.c.id, patch: { gmailSchedule: g } });
  }
  if (patches.length) {
    useStore.getState().updateContacts(patches);
    await syncServer().catch(() => undefined);
  }
  return patches.length;
}

/** Take people off the list (the draft stays in Gmail). */
export function removeFromHandoff(ids: string[]) {
  useStore.getState().updateContacts(ids.map((id) => ({ id, patch: { gmailSchedule: undefined } })));
  void syncServer().catch(() => undefined);
}
