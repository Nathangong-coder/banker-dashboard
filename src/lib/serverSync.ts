"use client";

import { create } from "zustand";
import { useStore } from "./store";
import { requireAccount, useSession } from "./session";
import { latestIso } from "./util";
import { nightPlan } from "./reminders";
import { earliestSend, pendingFollowUpDraft } from "./followups";
import { FOLLOW_UP_SPREAD, pastRange, planSends, tooSoon, windowOf } from "./sendWindow";
import { vpPlusWarning } from "./seniority";
import type { Contact } from "./types";
import { applyTracking, readReplies, trackList, type TrackStateWire } from "./referrals";
import { rulesOf } from "./jobReview";
import type { ApplyState } from "./apply";
import { googleClientId } from "./keys";
import { scheduledByRecipient } from "./gmail";
import { officeGapItems, officeGaps } from "./officeGaps";
import type { RawHit } from "./opens";
import { matchTrackedSends, refreshMx } from "./trackingActions";

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
  /** The server may read Gmail (hourly reply / thank-you / referral tracking). False = reconnect to add it. */
  gmailRead?: boolean;
  /** The server may read your Google Docs (chat notes docs). False = reconnect to add it. */
  docs?: boolean;
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
  requireAccount("connect your Google account");
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
  const { url } = await call<{ url: string }>("/api/server/google/start", { returnTo, loginHint: useSession.getState().user?.email || useStore.getState().settings.profile.email || undefined });
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
      const prev = latestIso(c.lastEmailedAt, c.lastTouchAt ?? c.sentAt);
      const log = f.step > 0 && prev ? [...(c.followUpLog ?? []), { step: f.step, at, gapDays: Math.round((Date.parse(at) - Date.parse(prev)) / 86_400_000) }] : c.followUpLog;
      const patch: Partial<Contact> =
        f.step === 0
          ? { status: "sent", sentAt: c.sentAt ?? at, lastTouchAt: at, threadId: f.threadId ?? c.threadId, draft: c.draft && { ...c.draft, gmailDraftId: undefined } }
          : { status: "followed_up", followUps: Math.max(c.followUps, f.step), lastTouchAt: at, threadId: f.threadId ?? c.threadId, followUpDraft: undefined, followUpLog: log };
      st.updateContact(c.id, { ...patch, serverSend: undefined }, { at, type: "note", note: f.step === 0 ? "First email sent automatically" : `Follow-up #${f.step} sent automatically` });
    } else {
      st.updateContact(c.id, { serverSend: undefined, ...(f.status === "missing" ? { followUpDraft: f.step ? undefined : c.followUpDraft } : {}) }, { at, type: "note", note: `Automatic send didn't happen: ${f.error ?? f.status}` });
      // Cancelled on purpose (the Claude connector's cancel_send) isn't a problem to flag.
      if (f.error !== "Cancelled from Claude") problems.push(`${c.name}: ${f.error ?? f.status}`);
    }
  }
  return { ack, problems };
}

let inflight: Promise<ServerStatus | null> | null = null;
/** Pixel hits stored from the last answer (`id|at`): the next sync acks them so the server drops them. */
let pendingOpensAck: string[] = [];
/** Pages of opens read per sync at most (500 each). */
const MAX_OPEN_PAGES = 10;
type OpensWire = { opens?: RawHit[]; moreOpens?: boolean };

/** Open tracking needs the server's hits while it's on, and while there are tracked emails whose opens may still come. */
const wantsOpens = (st: ReturnType<typeof useStore.getState>) => !!st.settings.tracking?.on || st.tracking.messages.length > 0;

/** One sync call that also acks the opens stored last time; stores the opens it returns (acked next call). */
async function callWithOpens<T extends OpensWire>(body: Record<string, unknown>): Promise<T> {
  const r = await call<T>("/api/server/sync", { ...body, opensAck: pendingOpensAck });
  pendingOpensAck = [];
  if (r.opens?.length) {
    useStore.getState().addHits(r.opens);
    pendingOpensAck = r.opens.map((h) => `${h.id}|${h.at}`);
  }
  return r;
}

/**
 * The body for reading opens only. The route then skips the account save, the send queue, digests and Gmail tracking;
 * there is no `sends` list at all, so a page of opens can never cancel a queued send.
 */
export function opensOnlyBody(tz: string) {
  return { tz, opens: true, opensOnly: true } as const;
}
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

/** More opens waiting on the server: keep reading opens-only pages (each call acks the previous page). */
async function drainOpens(r: OpensWire) {
  for (let i = 0; r.moreOpens && i < MAX_OPEN_PAGES; i++) r = await callWithOpens<OpensWire>(opensOnlyBody(localTz()));
}

/** After a sync: sent dates for tracked emails, and Google-or-not for new recipient domains (never fails the sync). */
async function trackingUpkeep() {
  try {
    matchTrackedSends();
    await refreshMx();
  } catch {
    /* next sync tries again */
  }
}

/** Open tracking without automatic sending (no Google email recorded here): read the pixel hits only. */
async function syncOpensOnly() {
  const r = await callWithOpens<OpensWire>(opensOnlyBody(localTz()));
  await drainOpens(r);
  await trackingUpkeep();
}

const queuedSends = (contacts: Contact[]) =>
  contacts.filter((c) => c.serverSend).map((c) => ({ draftId: c.serverSend!.draftId, contactId: c.id, name: c.name, step: c.serverSend!.step, sendAt: c.serverSend!.sendAt }));
/** Reply texts read by the AI since the last sync: the server deletes them on the next one. */
let pendingAck: { contactId: string; ids: string[] }[] = [];

/** Push the queue + digest plan, pull results. No-op until Gmail has been connected for the server. */
/** Every text night also lists the offices that aren't maxed out (lib/officeGaps.ts), after the people. */
function withOfficeGaps(plan: ReturnType<typeof nightPlan>, st: ReturnType<typeof useStore.getState>) {
  let items: ReturnType<typeof officeGapItems> = [];
  try {
    const cap = Math.max(1, st.settings.followUp.livePerBank);
    items = officeGapItems(officeGaps({ contacts: st.contacts, tables: st.tables, targets: st.targets, coverage: st.coverage, banks: st.banks, followUp: st.settings.followUp }), cap);
  } catch {
    /* coverage couldn't be built: the people still go out */
  }
  if (!items.length) return plan;
  return Object.fromEntries(Object.entries(plan).map(([day, d]) => [day, { ...d, items: [...d.items, ...items] }]));
}

export function syncServer(): Promise<ServerStatus | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const st = useStore.getState();
    const srv = st.settings.server;
    if (!srv?.id) return null;
    if (!srv.email) {
      if (wantsOpens(st)) await syncOpensOnly().catch(() => undefined);
      return null;
    }
    const opens = wantsOpens(st);
    const k = st.settings.keys;
    const whatsappOn = !!(k.whatsappPhone && k.whatsappApiKey) && st.settings.alerts?.whatsappDaily !== false;
    const body = {
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles",
      whatsapp: whatsappOn ? { phone: k.whatsappPhone, apiKey: k.whatsappApiKey } : null,
      digests: whatsappOn ? withOfficeGaps(nightPlan(st.contacts, st.banks, st.settings.followUp), st) : {},
      // People you're talking to, so the server can match today's Google Calendar events to them for thank-you reminders.
      people: whatsappOn ? calendarPeople(st.contacts) : [],
      // Everyone the server should watch in Gmail for replies, thank-yous and intros (used only with read access).
      track: trackList(st.contacts),
      jobRun: jobRunOf(st.apply),
      trackAck: pendingAck,
      sends: queuedSends(st.contacts),
      ack: [] as string[],
      opens,
    };
    try {
      let r = await callWithOpens<ServerStatus & OpensWire & { sends: Finished[]; tracking?: Record<string, TrackStateWire> }>(body);
      pendingAck = [];
      if (r.tracking) {
        applyTracking(r.tracking);
        // Not awaited by the status: the AI read can take a few seconds.
        void readReplies(r.tracking).then((ack) => (pendingAck = [...pendingAck, ...ack]));
      }
      const { ack, problems } = applyFinished(r.sends);
      if (ack.length) {
        const after = useStore.getState().contacts.filter((c) => c.serverSend);
        r = await callWithOpens({ ...body, trackAck: [], sends: queuedSends(after), ack });
      }
      if (opens) {
        await drainOpens(r);
        await trackingUpkeep();
      }
      const status: ServerStatus = { email: r.email, whatsapp: r.whatsapp, calendar: r.calendar, gmailRead: r.gmailRead, docs: r.docs, lastDigestDay: r.lastDigestDay, lastDigestError: r.lastDigestError, syncedAt: new Date().toISOString(), error: problems.length ? problems.join("; ") : undefined };
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

/** The "press Search" reminder for the 9 PM text, from Applications → Find jobs → What jobs I want. */
function jobRunOf(apply: ApplyState) {
  const r = rulesOf(apply.finder.rules, apply.profile.gradDate).reminder;
  return r.on ? { lastAt: apply.finder.lastRunAt, everyDays: r.everyDays } : null;
}

/** Who a calendar event today could be with: everyone who replied or has a call (name + email, nothing else). */
function calendarPeople(contacts: Contact[]) {
  return contacts
    .filter((c) => c.call || c.repliedAt || c.metAt?.length || ["replied", "call_scheduled", "done"].includes(c.status))
    .slice(0, 400)
    .map((c) => ({
      contactId: c.id,
      name: c.name,
      email: c.email || undefined,
      thankedAt: latestIso(c.lastEmailedAt, c.handledAt),
      bank: c.bank || undefined,
      linkedin: /linkedin\.com\/in\//i.test(c.linkedin) ? c.linkedin.slice(0, 300) : undefined,
      loggedAt: c.chats?.reduce<string | undefined>((m, x) => (!m || x.at > m ? x.at : m), undefined),
    }));
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
/** The gap (days) a follow-up's earliest day stands for: your follow-up setting minus the spread (7 → 6). */
const minGap = () => Math.max(1, useStore.getState().settings.followUp.firstAfterDays - FOLLOW_UP_SPREAD);

/** The earliest a queued / to-be-queued email to this person may go out (follow-ups only). */
export function notBeforeOf(c: Contact) {
  const step = c.serverSend?.step ?? sendableDraft(c)?.step ?? 0;
  return earliestSend(c, useStore.getState().settings.followUp, step);
}

/**
 * People who already have an email waiting in Gmail's Schedule send: Coverage must not queue a second one to them.
 * Their `scheduledAt` is recorded (so they show as scheduled, not due). Gmail isn't asked when it isn't reachable.
 */
export async function gmailScheduledOverlap(contacts: Contact[]) {
  const st = useStore.getState();
  const clientId = googleClientId(st.settings);
  if (!clientId || !contacts.length) return new Map<string, string>();
  const sched = await scheduledByRecipient(clientId).catch(() => null);
  const out = new Map<string, string>();
  if (!sched) return out;
  for (const c of contacts) {
    const at = [c.email, ...(c.aliases ?? [])].map((e) => e && sched.get(e.toLowerCase())).find(Boolean);
    if (!at) continue;
    out.set(c.id, at);
    if (c.scheduledAt !== at) st.updateContact(c.id, { scheduledAt: at }, { at: new Date().toISOString(), type: "note", note: "Already scheduled in Gmail (Schedule send): Coverage didn't queue another" });
  }
  return out;
}

export async function queueSends(contacts: Contact[], why = new Map<string, string>(), overlap: string[] = []) {
  const st = useStore.getState();
  // Never two emails at once: anyone with a Gmail Schedule-send email waiting is left out (owner, 2026-10-27).
  const inGmail = await gmailScheduledOverlap(contacts);
  for (const c of contacts) if (inGmail.has(c.id)) overlap.push(c.name);
  contacts = contacts.filter((c) => !inGmail.has(c.id));
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
  const plan = planSends(ready.map((x) => x.c), windowOf(st.settings), { taken, notBefore: notBeforeOf, why, minGapDays: minGap() });
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
  const plan = planSends(queued, windowOf(st.settings), { notBefore: notBeforeOf, minGapDays: minGap() });
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
    return tooSoon(new Date(c.serverSend.sendAt), notBeforeOf(c), c, windowOf(useStore.getState().settings));
  });
}

/**
 * Queued follow-ups set past the 6-8 day range after your last email when a day inside it was open: planned before
 * spacing counted whole days (Joseph Nichols, first email Thu 10/15, was queued for Tue 10/27 instead of Thu 10/22).
 * Days inside the range are chosen at random on purpose (gap / weekday data), so only sends beyond it are listed.
 */
export function lateSends(contacts: Contact[], now = new Date()) {
  const w = windowOf(useStore.getState().settings);
  const out: { c: Contact; from: Date; to: Date }[] = [];
  for (const c of contacts) {
    if (!c.serverSend || new Date(c.serverSend.sendAt) <= now) continue;
    const nb = notBeforeOf(c);
    if (!nb) continue;
    const from = new Date(c.serverSend.sendAt);
    if (!pastRange(from, nb, c, w)) continue;
    // The first allowed day in the range (deterministic, so the banner doesn't flicker).
    const to = planSends([c], w, { now, notBefore: notBeforeOf, jitter: () => 0 }).get(c.id);
    if (to && !pastRange(to, nb, c, w) && to < from) out.push({ c, from, to });
  }
  return out;
}

/** Move the sends `lateSends` found to a random day inside the 6-8 day range (around everyone else's sends). */
export async function moveLateSends() {
  const st = useStore.getState();
  const moved: { name: string; from: Date; to: Date }[] = [];
  for (const { c } of lateSends(st.contacts)) {
    const fresh = useStore.getState().contacts;
    const cur = fresh.find((x) => x.id === c.id);
    if (!cur?.serverSend) continue;
    const taken = fresh.filter((x) => x.serverSend && x.id !== c.id).map((x) => new Date(x.serverSend!.sendAt));
    const why = new Map<string, string>();
    const to = planSends([cur], windowOf(st.settings), { taken, notBefore: notBeforeOf, why, minGapDays: minGap() }).get(c.id);
    const from = new Date(cur.serverSend.sendAt);
    if (!to || to >= from) continue;
    moved.push({ name: c.name, from, to });
    st.updateContact(c.id, { serverSend: { ...cur.serverSend, sendAt: to.toISOString(), why: why.get(c.id) } }, { at: new Date().toISOString(), type: "note", note: "Queued follow-up moved earlier: it was past the 6-8 day range" });
  }
  if (moved.length) await syncServer();
  return moved;
}

/** Move only the too-early sends to their first allowed slot; everyone else keeps theirs. Returns what moved. */
export async function fixEarlySends() {
  const st = useStore.getState();
  const early = earlySends(st.contacts);
  const ids = new Set(early.map((c) => c.id));
  const taken = st.contacts.filter((c) => c.serverSend && !ids.has(c.id)).map((c) => new Date(c.serverSend!.sendAt));
  const plan = planSends(early, windowOf(st.settings), { taken, notBefore: notBeforeOf, minGapDays: minGap() });
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
  const inGmail = await gmailScheduledOverlap(st.contacts.filter((c) => plan.has(c.id)));
  for (const [id, at] of plan) {
    const c = st.contacts.find((x) => x.id === id);
    if (!c) continue;
    if (inGmail.has(c.id)) {
      skipped.push(`${c.name} (already scheduled in Gmail)`);
      continue;
    }
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
