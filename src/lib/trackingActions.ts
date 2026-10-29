"use client";

import { useStore } from "./store";
import { serverCall } from "./serverSync";
import { mintPixelId, pixelUrl, PIXEL_PATH_RE } from "./pixel";
import type { TrackedKind, TrackedMessage } from "./opens";
import type { Contact, Template } from "./types";

/**
 * Open tracking, browser side: pixels for emails Coverage builds (pixelFor), the Gmail draft each one went into
 * (notePixelDraft), when it was sent (matchTrackedSends, after a Gmail or server sync) and which recipient domains are
 * on Google mail (refreshMx). Hits themselves arrive with the server sync (serverSync.ts).
 */

const EMAIL = /[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+/g;
const recipients = (to: string) => [...new Set((to.match(EMAIL) ?? []).map((e) => e.toLowerCase()))];

/** The pixel key for this browser's server account, fetched once and cached in the store (with the account it's for). */
async function pixelKey(): Promise<{ key: string; base: string; account: string }> {
  const st = useStore.getState();
  const t = st.tracking;
  const acct = st.settings.server?.id;
  if (t.key && t.base && acct && t.account === acct) return { key: t.key, base: t.base, account: acct };
  // serverCall makes the server account first when this browser has none.
  const r = await serverCall<{ key: string; base: string }>("/api/server/pixel", {});
  const account = useStore.getState().settings.server?.id;
  if (!r.key || !r.base || !account) throw new Error("No pixel key");
  useStore.getState().setTrackingKey(r.key, r.base, account);
  return { key: r.key, base: r.base, account };
}

/** Make sure open tracking can work (server account + key), e.g. when the switch is turned on. */
export async function prepareTracking() {
  await pixelKey();
}

/** Pixels handed out whose Gmail draft isn't made yet: registered only once the draft exists (notePixelDraft). */
const pending = new Map<string, TrackedMessage>();

/**
 * The pixel URL for an email Coverage is about to put in Gmail, or undefined (tracking off, offline, no server…): the
 * draft is then made without one. Re-making the same Gmail draft keeps its pixel. Nothing is registered here: a draft
 * call that fails would leave an entry with no Gmail draft that a later send could be matched to (counted twice).
 * Never throws.
 */
export async function pixelFor(input: { to: string; subject: string; kind: TrackedKind; step?: number; contactId?: string; gmailDraftId?: string }): Promise<string | undefined> {
  try {
    if (!useStore.getState().settings.tracking?.on) return undefined;
    const { key, base, account } = await pixelKey();
    const st = useStore.getState();
    const fields = { to: recipients(input.to), subject: input.subject, kind: input.kind, step: input.step, contactId: input.contactId };
    const same = input.gmailDraftId ? st.tracking.messages.find((m) => m.gmailDraftId === input.gmailDraftId && !m.sentAt && m.id.startsWith(account + ".")) : undefined;
    const m: TrackedMessage = same
      ? { ...same, ...fields }
      : { id: await mintPixelId(account, key), ...fields, createdAt: new Date().toISOString(), source: "coverage", hits: [], seen: [] };
    if (pending.size > 200) pending.clear();
    pending.set(m.id, m);
    return pixelUrl(base, m.id);
  } catch {
    return undefined;
  }
}

/** Which email a Drafts-page draft is: a follow-up template's step, else the first email. */
export function trackedKindOf(t: Pick<Template, "kind" | "step"> | undefined, c: Pick<Contact, "followUps">): { kind: TrackedKind; step: number } {
  return t?.kind === "follow_up" ? { kind: "follow-up", step: t.step ?? c.followUps + 1 } : { kind: "first", step: 0 };
}

/** After upsertDraft succeeded: register the pixel's email with the Gmail draft (and thread) it went into. */
export function notePixelDraft(pixel: string | undefined, draft: { id: string; message?: { threadId?: string } } | undefined) {
  const id = pixel && PIXEL_PATH_RE.exec(pixel)?.[1];
  if (!id || !draft?.id) return;
  const st = useStore.getState();
  const m = pending.get(id) ?? st.tracking.messages.find((x) => x.id === id);
  pending.delete(id);
  if (!m) return;
  st.registerTracked({ ...m, gmailDraftId: draft.id, threadId: m.threadId ?? draft.message?.threadId });
}

/**
 * When did this tracked email go out? Pure. Only entries with a contact and no sentAt yet; the contact's dates must be
 * at or after the entry's createdAt (a date from before the draft existed is an earlier email). Heuristics:
 * - first email (kind "first" or step 0): contact.sentAt;
 * - follow-up #n: that step in followUpLog, else lastTouchAt when followUps is exactly n (the latest touch is #n);
 * - thank-you (an info-session thank-you is usually the first email): contact.sentAt, else lastEmailedAt;
 * - reply (scheduling reply in their thread): lastEmailedAt, else lastTouchAt.
 * One minute of slack covers the clock difference between this browser and Gmail.
 */
export function sentMatches(messages: TrackedMessage[], contacts: Contact[]): { sent: { id: string; sentAt: string; threadId?: string }[]; drop: string[] } {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const sentAtOf = (m: TrackedMessage, c: Contact) => {
    const created = Date.parse(m.createdAt) - 60_000;
    const after = (at?: string) => (at && Date.parse(at) >= created ? at : undefined);
    if (m.kind === "first" || (m.kind !== "follow-up" && m.step === 0)) return after(c.sentAt);
    if (m.kind === "follow-up") {
      const n = m.step ?? 1;
      if (c.followUps < n) return undefined;
      return after(c.followUpLog?.find((x) => x.step === n)?.at) ?? (c.followUps === n ? after(c.lastTouchAt) : undefined);
    }
    if (m.kind === "thank-you") return after(c.sentAt) ?? after(c.lastEmailedAt);
    if (m.kind === "reply") return after(c.lastEmailedAt) ?? after(c.lastTouchAt);
    return undefined;
  };
  // One send = one tracked email. Several unsent entries for the same email (a draft re-made after Gmail dropped it)
  // all look sent by the contact's dates: only the newest gets the date; older ones without hits are dropped,
  // older ones with hits stay unsent (their opens are kept but not counted as a send).
  const groups = new Map<string, TrackedMessage[]>();
  for (const m of messages) {
    if (m.sentAt || !m.contactId || !byId.has(m.contactId)) continue;
    const step = m.kind === "first" ? 0 : (m.step ?? (m.kind === "follow-up" ? 1 : 0));
    const k = `${m.contactId}|${m.kind}|${step}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(m);
  }
  const sent: { id: string; sentAt: string; threadId?: string }[] = [];
  const drop: string[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const [newest, ...older] = list;
    const c = byId.get(newest.contactId!)!;
    const at = sentAtOf(newest, c);
    if (!at) continue;
    sent.push({ id: newest.id, sentAt: at, threadId: newest.threadId ?? c.threadId });
    for (const m of older) if (!m.hits.length && sentAtOf(m, c)) drop.push(m.id);
  }
  return { sent, drop };
}

/** Stamp sentAt / threadId on tracked emails whose contact shows they went out (after a Gmail or server sync). */
export function matchTrackedSends() {
  const st = useStore.getState();
  const { sent, drop } = sentMatches(st.tracking.messages, st.contacts);
  if (!sent.length && !drop.length) return;
  const by = new Map(sent.map((f) => [f.id, f]));
  const gone = new Set(drop);
  st.updateTracking((t) => ({
    ...t,
    messages: t.messages.filter((m) => !gone.has(m.id)).map((m) => (by.has(m.id) ? { ...m, sentAt: by.get(m.id)!.sentAt, threadId: by.get(m.id)!.threadId } : m)),
  }));
}

/** Ask the server which new recipient domains are on Google mail (≤ 50 per call), cached in tracking.mx. */
export async function refreshMx() {
  const t = useStore.getState().tracking;
  const domains = [...new Set(t.messages.flatMap((m) => m.to.map((e) => e.split("@")[1]?.toLowerCase()).filter((d): d is string => !!d)))].filter((d) => !(d in t.mx)).slice(0, 50);
  if (!domains.length) return;
  const r = await serverCall<{ key: string; base: string; mx?: Record<string, "google" | "other"> }>("/api/server/pixel", { domains });
  if (r.mx) useStore.getState().updateTracking((x) => ({ ...x, mx: { ...x.mx, ...r.mx } }));
}
