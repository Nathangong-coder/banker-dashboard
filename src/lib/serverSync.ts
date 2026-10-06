"use client";

import { create } from "zustand";
import { useStore } from "./store";
import { digestPlan } from "./reminders";
import { nextSendSlot, pendingFollowUpDraft } from "./followups";
import type { Contact } from "./types";

/**
 * The browser half of automatic sending (server half: app/api/server). The browser keeps the source of truth and
 * pushes the server what it needs while the dashboard is closed: which Gmail drafts to send when, and each day's 9am
 * WhatsApp text. The server reports back sends it made, which are applied to contacts here.
 */

export interface ServerStatus {
  email: string | null;
  whatsapp: boolean;
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
      digests: whatsappOn ? digestPlan(st.contacts, st.banks, st.settings.followUp) : {},
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
      const status: ServerStatus = { email: r.email, whatsapp: r.whatsapp, lastDigestDay: r.lastDigestDay, lastDigestError: r.lastDigestError, syncedAt: new Date().toISOString(), error: problems.length ? problems.join("; ") : undefined };
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

/** The Gmail draft the server would send next for this person, and which email it is (0 = first, n = follow-up #n). */
export function sendableDraft(c: Contact): { draftId: string; step: number } | null {
  const fu = pendingFollowUpDraft(c);
  if (fu && (c.status === "sent" || c.status === "followed_up")) return { draftId: fu.gmailDraftId, step: fu.step };
  if (c.status === "drafted" && c.draft?.gmailDraftId && !c.sentAt) return { draftId: c.draft.gmailDraftId, step: 0 };
  return null;
}

/** Queue these people's Gmail drafts for their next send slot (NY 5 PM PT, else 7 PM PT). Returns how many. */
export async function queueSends(contacts: Contact[]) {
  const st = useStore.getState();
  let n = 0;
  for (const c of contacts) {
    const d = sendableDraft(c);
    if (!d) continue;
    st.updateContact(c.id, { serverSend: { draftId: d.draftId, step: d.step, sendAt: nextSendSlot(c).at.toISOString(), queuedAt: new Date().toISOString() } });
    n++;
  }
  if (n) await syncServer();
  return n;
}

export async function cancelSend(c: Contact) {
  useStore.getState().updateContact(c.id, { serverSend: undefined });
  await syncServer();
}
