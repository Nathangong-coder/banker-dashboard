"use client";

import { create } from "zustand";
import { useStore } from "./store";
import { nightPlan } from "./reminders";
import { earliestSend, pendingFollowUpDraft } from "./followups";
import { planSends, windowOf } from "./sendWindow";
import { vpPlusWarning } from "./seniority";
import type { Contact } from "./types";

/**
 * The browser half of automatic sending (server half: app/api/server). The browser keeps the source of truth and
 * pushes the server what it needs while the dashboard is closed: which Gmail drafts to send when, and each day's 9am
 * WhatsApp text. The server reports back sends it made, which are applied to contacts here.
 */

export interface ServerStatus {
  email: string | null;
  whatsapp: boolean;
  /** The server may read your Google Calendar (for the 9 PM thank-you reminders). False = reconnect to add it. */
  calendar?: boolean;
  lastDigestDay?: string | null;
  lastDigestError?: string | null;
  syncedAt?: string;
  error?: string;
}
export const useServerStatus = create<{ status: ServerStatus | null }>(() => ({ status: null }));

const rand = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** This browser's server account, made on first use. */
function account() {
  const s = useStore.getState();
  if (s.settings.server?.id) return s.settings.server;
  const server = { id: rand(18), token: rand(32) };
  s.setSettings((x) => ({ ...x, server }));
  return server;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const a = account();
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.id}.${a.token}` }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Server error ${res.status}`);
  return j;
}

/** An authenticated call to the automatic-sending server (same account as syncServer), for other pages (info sessions). */
export function serverCall<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, body);
}

/** Send the user to Google to give the server Gmail access; comes back to `returnTo` with ?server=connected. */
export async function connectServer(returnTo = "/followups?tab=reminders") {
  const { url } = await call<{ url: string }>("/api/server/google/start", { returnTo, loginHint: useStore.getState().settings.profile.email || undefined });
  window.location.href = url;
}

export async function disconnectServer() {
  if (!useStore.getState().settings.server?.id) return;
  await call("/api/server/disconnect", {});
  const st = useStore.getState();
  st.setSettings((x) => ({ ...x, server: undefined }));
  for (const c of st.contacts) if (c.serverSend) st.updateContact(c.id, { serverSend: undefined });
  useServerStatus.setState({ status: null });
}

/** Called once when Google redirects back (?server=connected&email=…). */
export function markServerConnected(email: string) {
  useStore.getState().setSettings((x) => (x.server ? { ...x, server: { ...x.server, email, connectedAt: new Date().toISOString() } } : x));
}

type Finished = { draftId: string; contactId: string; step: number; status: "queued" | "sent" | "failed" | "missing"; messageId?: string; threadId?: string; doneAt?: string; error?: string };

/** Apply what the server did (sent / couldn't send). Returns the draft ids to acknowledge. */
function applyFinished(list: Finished[]) {
  const st = useStore.getState();
  const ack: string[] = [];
  const problems: string[] = [];
  for (const f of list) {
    if (f.status === "queued") continue;
    ack.push(f.draftId);
    const c = st.contacts.find((x) => x.id === f.contactId);
    if (!c || c.serverSend?.draftId !== f.draftId) continue;
    const at = f.doneAt ?? new Date().toISOString();
    if (f.status === "sent") {
      const patch: Partial<Contact> =
        f.step === 0
          ? { status: "sent", sentAt: c.sentAt ?? at, lastTouchAt: at, threadId: f.threadId ?? c.threadId, draft: c.draft && { ...c.draft, gmailDraftId: undefined } }
          : { status: "followed_up", followUps: Math.max(c.followUps, f.step), lastTouchAt: at, threadId: f.threadId ?? c.threadId, followUpDraft: undefined };
      st.updateContact(c.id, { ...patch, serverSend: undefined }, { at, type: "note", note: f.step === 0 ? "First email sent automatically" : `Follow-up #${f.step} sent automatically` });
    } else {
      st.updateContact(c.id, { serverSend: undefined, ...(f.status === "missing" ? { followUpDraft: f.step ? undefined : c.followUpDraft } : {}) }, { at, type: "note", note: `Automatic send didn't happen: ${f.error ?? f.status}` });
      problems.push(`${c.name}: ${f.error ?? f.status}`);
    }
  }
  return { ack, problems };
}

let inflight: Promise<ServerStatus | null> | null = null;

/** Push the queue + digest plan, pull results. No-op until Gmail has been connected for the server. */
export function syncServer(): Promise<ServerStatus | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const st = useStore.getState();
    const srv = st.settings.server;
    if (!srv?.id || !srv.email) return null;
    const k = st.settings.keys;
    const whatsappOn = !!(k.whatsappPhone && k.whatsappApiKey) && st.settings.alerts?.whatsappDaily !== false;
    const body = {
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
      whatsapp: whatsappOn ? { phone: k.whatsappPhone, apiKey: k.whatsappApiKey } : null,
      digests: whatsappOn ? nightPlan(st.contacts, st.banks, st.settings.followUp) : {},
      // People you're talking to, so the server can match today's Google Calendar events to them for thank-you reminders.
      people: whatsappOn ? calendarPeople(st.contacts) : [],
      sends: st.contacts
        .filter((c) => c.serverSend)
        .map((c) => ({ draftId: c.serverSend!.draftId, contactId: c.id, name: c.name, step: c.serverSend!.step, sendAt: c.serverSend!.sendAt })),
      ack: [] as string[],
    };
    try {
      let r = await call<ServerStatus & { sends: Finished[] }>("/api/server/sync", body);
      const { ack, problems } = applyFinished(r.sends);
      if (ack.length) {
        const after = useStore.getState().contacts.filter((c) => c.serverSend);
        r = await call("/api/server/sync", { ...body, sends: after.map((c) => ({ draftId: c.serverSend!.draftId, contactId: c.id, name: c.name, step: c.serverSend!.step, sendAt: c.serverSend!.sendAt })), ack });
      }
      const status: ServerStatus = { email: r.email, whatsapp: r.whatsapp, calendar: r.calendar, lastDigestDay: r.lastDigestDay, lastDigestError: r.lastDigestError, syncedAt: new Date().toISOString(), error: problems.length ? problems.join("; ") : undefined };
      useServerStatus.setState({ status });
      return status;
    } catch (e) {
      const status: ServerStatus = { email: srv.email ?? null, whatsapp: false, error: (e as Error).message };
      useServerStatus.setState({ status });
      throw e;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Who a calendar event today could be with: everyone who replied or has a call (name + email, nothing else). */
function calendarPeople(contacts: Contact[]) {
  return contacts
    .filter((c) => c.call || c.repliedAt || ["replied", "call_scheduled", "done"].includes(c.status))
    .slice(0, 400)
    .map((c) => ({ contactId: c.id, name: c.name, email: c.email || undefined, thankedAt: c.lastEmailedAt }));
}

/** The Gmail draft the server would send next for this person, and which email it is (0 = first, n = follow-up #n). */
export function sendableDraft(c: Contact): { draftId: string; step: number } | null {
  const fu = pendingFollowUpDraft(c);
  if (fu && (c.status === "sent" || c.status === "followed_up")) return { draftId: fu.gmailDraftId, step: fu.step };
  if (c.status === "drafted" && c.draft?.gmailDraftId && !c.sentAt) return { draftId: c.draft.gmailDraftId, step: 0 };
  return null;
}

/**
 * Queue these people's Gmail drafts in your send window (Settings → Email → Sending; default 9–11 AM their time,
 * weekdays), spread a few minutes apart around sends already queued. Returns how many.
 */
/** The earliest a queued / to-be-queued email to this person may go out (follow-ups only). */
export function notBeforeOf(c: Contact) {
  const step = c.serverSend?.step ?? sendableDraft(c)?.step ?? 0;
  return earliestSend(c, useStore.getState().settings.followUp, step);
}

export async function queueSends(contacts: Contact[], why = new Map<string, string>()) {
  const st = useStore.getState();
  const ids = new Set(contacts.map((c) => c.id));
  // Your rule: no VP and above (unless one of your exception ties applies). Never sent automatically.
  const ready = contacts
    .filter((c) => {
      const w = vpPlusWarning(c, st.settings.outreach);
      return !w || !!w.tie;
    })
    .map((c) => ({ c, d: sendableDraft(c) }))
    .filter((x): x is { c: Contact; d: { draftId: string; step: number } } => !!x.d);
  const taken = st.contacts.filter((c) => c.serverSend && !ids.has(c.id)).map((c) => new Date(c.serverSend!.sendAt));
  const plan = planSends(ready.map((x) => x.c), windowOf(st.settings), { taken, notBefore: notBeforeOf, why });
  for (const { c, d } of ready) {
    const at = plan.get(c.id);
    if (at) st.updateContact(c.id, { serverSend: { draftId: d.draftId, step: d.step, sendAt: at.toISOString(), queuedAt: new Date().toISOString(), why: why.get(c.id) } });
  }
  if (plan.size) await syncServer();
  return plan.size;
}

/** Move every queued send into the current send window (after changing it in Settings). Returns how many moved. */
export async function rescheduleQueued() {
  const st = useStore.getState();
  const queued = st.contacts.filter((c) => c.serverSend && new Date(c.serverSend.sendAt) > new Date());
  const plan = planSends(queued, windowOf(st.settings), { notBefore: notBeforeOf });
  for (const c of queued) {
    const at = plan.get(c.id);
    if (at) st.updateContact(c.id, { serverSend: { ...c.serverSend!, sendAt: at.toISOString() } });
  }
  if (plan.size) await syncServer();
  return plan.size;
}

/** Queued follow-ups set to go out sooner than the spacing allows (`earliestSend`), e.g. 5 days after the last one. */
export function earlySends(contacts: Contact[]) {
  return contacts.filter((c) => {
    if (!c.serverSend || new Date(c.serverSend.sendAt) <= new Date()) return false;
    const nb = notBeforeOf(c);
    return !!nb && new Date(c.serverSend.sendAt) < nb;
  });
}

/** Move only the too-early sends to their first allowed slot; everyone else keeps theirs. Returns what moved. */
export async function fixEarlySends() {
  const st = useStore.getState();
  const early = earlySends(st.contacts);
  const ids = new Set(early.map((c) => c.id));
  const taken = st.contacts.filter((c) => c.serverSend && !ids.has(c.id)).map((c) => new Date(c.serverSend!.sendAt));
  const plan = planSends(early, windowOf(st.settings), { taken, notBefore: notBeforeOf });
  const moved: { name: string; from: string; to: Date }[] = [];
  for (const c of early) {
    const at = plan.get(c.id);
    if (!at) continue;
    moved.push({ name: c.name, from: c.serverSend!.sendAt, to: at });
    st.updateContact(c.id, { serverSend: { ...c.serverSend!, sendAt: at.toISOString() } }, { at: new Date().toISOString(), type: "note", note: "Queued follow-up moved: it was sooner than your follow-up spacing" });
  }
  if (moved.length) await syncServer();
  return moved;
}

export async function cancelSend(c: Contact) {
  useStore.getState().updateContact(c.id, { serverSend: undefined });
  await syncServer();
}

/** Move one queued send to a new time (Follow-ups → Scheduled → Change). */
export async function rescheduleOne(c: Contact, at: Date) {
  if (!c.serverSend) throw new Error(`${c.name} has nothing queued.`);
  if (at.getTime() < Date.now() + 2 * 60_000) throw new Error("Pick a time at least a couple of minutes from now.");
  useStore.getState().updateContact(c.id, { serverSend: { ...c.serverSend, sendAt: at.toISOString() } });
  await syncServer();
}

/**
 * Apply a batch plan (Follow-ups → "Schedule / change day…"): move queued sends, queue drafts that weren't yet.
 * VP+ without an exception tie and people with no Gmail draft are left out (returned in `skipped`).
 */
export async function applySchedule(plan: Map<string, Date>) {
  const st = useStore.getState();
  const skipped: string[] = [];
  let n = 0;
  for (const [id, at] of plan) {
    const c = st.contacts.find((x) => x.id === id);
    if (!c) continue;
    const w = vpPlusWarning(c, st.settings.outreach);
    if (w && !w.tie) {
      skipped.push(`${c.name} (VP+)`);
      continue;
    }
    if (c.serverSend) st.updateContact(c.id, { serverSend: { ...c.serverSend, sendAt: at.toISOString() } });
    else {
      const d = sendableDraft(c);
      if (!d) {
        skipped.push(`${c.name} (no Gmail draft yet)`);
        continue;
      }
      st.updateContact(c.id, { serverSend: { draftId: d.draftId, step: d.step, sendAt: at.toISOString(), queuedAt: new Date().toISOString() } });
    }
    n++;
  }
  if (n) await syncServer();
  return { n, skipped };
}
