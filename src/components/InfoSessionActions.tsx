"use client";

/**
 * Info sessions (app/info-sessions), the non-UI half: reading sessions from Google Calendar through the server, pulling
 * phone captures from the server inbox and reading people out of them, confirming people into contacts, and drafting +
 * queueing the thank-yous. Kept out of lib/ because it drives the store, Gmail and the server like a page would.
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import { blobs, useStore } from "@/lib/store";
import { serverCall, syncServer } from "@/lib/serverSync";
import { isInfoSessionTitle, meetingLink, parseSessionTitle, followUpTiming, type CalendarSession, type CaptureItem } from "@/lib/infoSessions";
import { callApi } from "@/lib/api";
import { aiReady, googleClientId } from "@/lib/keys";
import { addManualContact, enrichContacts } from "@/lib/actions";
import { canonBank, STARTER_TARGETS } from "@/lib/banks";
import { BANK_DOMAINS, DAY, linkedinSlug, uid } from "@/lib/util";
import { detectRegion } from "@/lib/region";
import { emailVerified, rulesOf } from "@/lib/outreach";
import { vpPlusWarning } from "@/lib/seniority";
import { planSends, windowOf } from "@/lib/sendWindow";
import { fillPlaceholders, hasAiSlots, missingPlaceholders, AI_SLOT } from "@/lib/template";
import { normalizeBody, normalizeSubject, withSignature } from "@/lib/emailFormat";
import { connectGmail, upsertDraft } from "@/lib/gmail";
import { INFO_SESSION_TEMPLATE } from "@/lib/defaults";
import { EMAIL_FONTS, type Contact, type InfoSession, type SessionPerson, type Template } from "@/lib/types";

type St = ReturnType<typeof useStore.getState>;

/** Automatic sending is on (the server has your Google account). Calendar access is reported by the calendar call. */
export const serverOn = (s: Pick<St, "settings">) => !!s.settings.server?.email;

/* ------------------------------------------------------------------ dates */

export const sessionDay = (s: Pick<InfoSession, "start">) => {
  const d = new Date(s.start);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** The weekday the session ended on, in your zone (all-day placeholders: the day itself). */
export const endWeekday = (s: Pick<InfoSession, "start" | "end" | "allDay">) => new Date(s.allDay ? s.start : s.end).getDay();
export const timingOf = (s: InfoSession) => followUpTiming(endWeekday(s));

/** The title without your "(must go)" note: "Raine Group Info Session". */
export const cleanTitle = (s: Pick<InfoSession, "title">) => s.title.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

/** Next Monday 00:00 local (from a Monday, the one after). */
export function nextMonday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d;
}

/* ------------------------------------------------------------------ firms */

/** Canonical names of every firm the app knows as a bank (your lists, your contacts, the starter list, known domains). */
export function knownBanks(s: Pick<St, "targets" | "coverage" | "contacts">) {
  const set = new Set<string>();
  for (const t of [...STARTER_TARGETS, ...s.targets, ...s.coverage.added]) set.add(canonBank(t.name));
  for (const c of s.contacts) if (c.bank) set.add(canonBank(c.bank));
  for (const k of Object.keys(BANK_DOMAINS)) set.add(canonBank(k));
  return set;
}
export const isClubSession = (s: Pick<InfoSession, "firm">, banks: Set<string>) => !banks.has(canonBank(s.firm));

/* ------------------------------------------------------------------ calendar */

/**
 * All-day events come as plain "YYYY-MM-DD" dates with Google's EXCLUSIVE end (the day after): read them as local dates,
 * start = local midnight, end = the last millisecond of the last day.
 */
export function allDayRange(start: string, end: string) {
  const local = (d: string) => {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
  };
  const s = local(start);
  const e = local(end || start);
  return { start: s.toISOString(), end: new Date(Math.max(e.getTime() - 1, s.getTime() + DAY - 1)).toISOString() };
}

export async function loadCalendarSessions(): Promise<{ calendar: boolean; count: number }> {
  const now = Date.now();
  const r = await serverCall<{ calendar: boolean; sessions: CalendarSession[] }>("/api/server/infosessions", {
    from: new Date(now - 180 * DAY).toISOString(),
    to: new Date(now + 60 * DAY).toISOString(),
  });
  if (!r.calendar) return { calendar: false, count: 0 };
  const list: InfoSession[] = (r.sessions ?? [])
    .filter((e) => isInfoSessionTitle(e.title))
    .map((raw) => {
      const e = raw.allDay ? { ...raw, ...allDayRange(raw.start, raw.end) } : raw;
      const p = parseSessionTitle(e.title);
      return {
        id: e.eventId,
        title: e.title,
        firm: p.firm,
        host: p.host,
        group: p.group,
        titleNote: p.note,
        start: e.start,
        end: e.end,
        allDay: e.allDay,
        location: e.location,
        link: e.link ?? (e.description ? meetingLink(e.description) : undefined),
        source: "calendar",
        people: [],
      };
    });
  useStore.getState().upsertInfoSessions(list);
  return { calendar: true, count: list.length };
}

export function addManualSession(input: { firm: string; title: string; start: Date; end: Date; location?: string }) {
  const title = input.title.trim() || `${input.firm.trim()} Info Session`;
  const p = parseSessionTitle(title);
  const id = uid("man");
  useStore.getState().upsertInfoSessions([
    {
      id,
      title,
      firm: input.firm.trim() || p.firm,
      host: p.host,
      group: p.group,
      titleNote: p.note,
      start: input.start.toISOString(),
      end: input.end.toISOString(),
      allDay: false,
      location: input.location?.trim() && !/^https?:/i.test(input.location.trim()) ? input.location.trim() : undefined,
      link: /^https?:/i.test(input.location?.trim() ?? "") ? input.location!.trim() : undefined,
      source: "manual",
      people: [],
    },
  ]);
  return id;
}

/* ------------------------------------------------------------------ reading people */

export type Extracted = Omit<SessionPerson, "from">;

/** One name per line ("Jane Doe, Analyst, jane@x.com" / "Jane Doe - TMT"), for when no AI is set up. */
export function namesFromText(text: string): Extracted[] {
  const out: Extracted[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s•*\-–\d.)]+/, "").trim();
    if (line.length < 2) continue;
    const email = line.match(/[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}/i)?.[0];
    const linkedin = line.match(/https?:\/\/[^\s]*linkedin\.com\/in\/[^\s,;]+/i)?.[0];
    const rest = line.replace(email ?? "\u0000", "").replace(linkedin ?? "\u0000", "");
    const [name, ...more] = rest.split(/\s*[,;|]\s*|\s+[-–—]\s+/).map((x) => x.trim()).filter(Boolean);
    if (!name) continue;
    out.push({ name, title: more[0] || undefined, note: more.slice(1).join(", ") || undefined, email: email?.toLowerCase(), linkedin });
  }
  return out;
}

/** People in a photo / screenshot / pasted text. Without AI only text can be read (one name per line). */
export async function extractPeople(input: { image?: string; text?: string }, session?: InfoSession): Promise<Extracted[]> {
  const st = useStore.getState();
  if (!aiReady(st.settings)) {
    if (input.text?.trim()) return namesFromText(input.text);
    throw new Error("Reading photos needs an AI key (Settings → Data). Type the names instead.");
  }
  const r = await callApi<{ people: Extracted[] }>(
    "/api/infosessions/extract",
    {
      image: input.image,
      text: input.text?.trim() || undefined,
      session: session ? { firm: session.firm, title: cleanTitle(session), date: new Date(session.start).toDateString() } : undefined,
      me: st.settings.profile.name || undefined,
    },
    st.settings,
  );
  return r.people;
}

const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z]+/g, " ").trim();

/** Add people to a session's review list (by name, never twice; people already confirmed there are skipped). */
export function addPending(sessionId: string, people: Extracted[], from: string) {
  const st = useStore.getState();
  const confirmed = new Set(st.contacts.filter((c) => c.metAt?.some((m) => m.sessionId === sessionId)).map((c) => nameKey(c.name)));
  let added = 0;
  st.updateInfoSession(sessionId, (s) => {
    const pending = [...(s.pending ?? [])];
    const have = new Set(pending.map((p) => nameKey(p.name)));
    for (const p of people) {
      const k = nameKey(p.name);
      if (!k || have.has(k) || confirmed.has(k)) continue;
      have.add(k);
      pending.push({ ...p, from });
      added++;
    }
    return { pending, captureIds: from !== "manual" && !(s.captureIds ?? []).includes(from) ? [...(s.captureIds ?? []), from] : s.captureIds };
  });
  return added;
}

/** The session a capture belongs to: the one it was sent for, else the latest that started before it and ended ≤ 12 h earlier. */
export function sessionForCapture(item: Pick<CaptureItem, "at" | "sessionId">, sessions: InfoSession[]) {
  if (item.sessionId) {
    const s = sessions.find((x) => x.id === item.sessionId);
    if (s) return s;
  }
  const at = new Date(item.at).getTime();
  return sessions
    .filter((s) => new Date(s.start).getTime() <= at && at - new Date(s.end).getTime() <= 12 * 3_600_000)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
}

/* ------------------------------------------------------------------ unsorted captures (this browser, IndexedDB) */

export interface UnsortedCapture {
  id: string;
  at: string;
  via: CaptureItem["via"];
  text?: string;
  image?: string;
  people: Extracted[];
  /** Why the people couldn't be read (no AI, provider error). */
  error?: string;
}

const UNSORTED_KEY = "infosessions:unsorted";
export const useUnsorted = create<{ list: UnsortedCapture[]; loaded: boolean }>(() => ({ list: [], loaded: false }));

export async function loadUnsorted() {
  if (useUnsorted.getState().loaded) return;
  try {
    const list = (await idbGet<UnsortedCapture[]>(UNSORTED_KEY)) ?? [];
    useUnsorted.setState({ list: [...list, ...useUnsorted.getState().list.filter((x) => !list.some((y) => y.id === x.id))], loaded: true });
  } catch {
    useUnsorted.setState({ loaded: true });
  }
}

async function saveUnsorted(list: UnsortedCapture[]) {
  useUnsorted.setState({ list });
  try {
    await idbSet(UNSORTED_KEY, list);
  } catch {
    /* private window: kept for this session only */
  }
}

export async function setUnsorted(fn: (list: UnsortedCapture[]) => UnsortedCapture[]) {
  await loadUnsorted();
  await saveUnsorted(fn(useUnsorted.getState().list));
}

/** Put an unsorted capture's people on a session (after you pick it). */
export async function assignUnsorted(id: string, sessionId: string) {
  const u = useUnsorted.getState().list.find((x) => x.id === id);
  if (!u) return 0;
  const n = addPending(sessionId, u.people, u.id);
  await setUnsorted((l) => l.filter((x) => x.id !== id));
  return n;
}

/* ------------------------------------------------------------------ pulling the phone inbox */

let pulling: Promise<{ added: number; unsorted: number; items: number }> | null = null;

/**
 * Read new captures from the server inbox: each is read for people (AI, or one name per line), put on its session's
 * review list (or the unsorted box), then acknowledged so the server deletes it. Single-flight.
 */
export function pullCaptures(): Promise<{ added: number; unsorted: number; items: number }> {
  if (pulling) return pulling;
  pulling = (async () => {
    let added = 0;
    let unsorted = 0;
    let items = 0;
    let ack: string[] = [];
    await loadUnsorted();
    for (let round = 0; round < 40; round++) {
      // Each call acknowledges the previous batch (stored in `pending` by then; the server deletes it) and returns the next
      // (≤ 30 items / ~3.5 MB of images); `more` = there are others waiting.
      const r = await serverCall<{ items: CaptureItem[]; more?: boolean }>("/api/server/inbox", { ack });
      ack = [];
      const batch = r.items ?? [];
      if (!batch.length) break;
      for (const it of batch) {
        ack.push(it.id);
        const sessions = useStore.getState().infoSessions;
        // Already read (an earlier pull whose acknowledgement didn't reach the server).
        if (useUnsorted.getState().list.some((u) => u.id === it.id) || sessions.some((s) => s.captureIds?.includes(it.id))) continue;
        items++;
        const session = sessionForCapture(it, sessions);
        let people: Extracted[] = [];
        let error: string | undefined;
        try {
          people = await extractPeople({ image: it.image, text: it.text }, session);
        } catch (e) {
          error = (e as Error).message;
        }
        if (session && !error) added += addPending(session.id, people, it.id);
        else {
          unsorted++;
          await setUnsorted((l) => [...l, { id: it.id, at: it.at, via: it.via, text: it.text, image: it.image, people, error }]);
        }
      }
      if (!r.more) break;
    }
    if (ack.length) await serverCall("/api/server/inbox", { ack });
    return { added, unsorted, items };
  })().finally(() => {
    pulling = null;
  });
  return pulling;
}

/** Read an unsorted capture again (after adding an AI key, say). */
export async function retryUnsorted(id: string, sessionId?: string) {
  const u = useUnsorted.getState().list.find((x) => x.id === id);
  if (!u) return;
  const session = useStore.getState().infoSessions.find((s) => s.id === sessionId);
  try {
    const people = await extractPeople({ image: u.image, text: u.text }, session);
    await setUnsorted((l) => l.map((x) => (x.id === id ? { ...x, people, error: undefined } : x)));
  } catch (e) {
    await setUnsorted((l) => l.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
    throw e;
  }
}

/* ------------------------------------------------------------------ confirming people */

/** The contact this person already is, by the same rules addManualContact uses (email, LinkedIn, name + firm). */
function existingContact(contacts: Contact[], p: { name: string; bank: string; email?: string; linkedin?: string }) {
  const email = p.email?.trim().toLowerCase();
  const slug = p.linkedin ? linkedinSlug(p.linkedin) : "";
  const name = p.name.trim().replace(/\s+/g, " ").toLowerCase();
  return contacts.find(
    (c) =>
      (email && c.email.toLowerCase() === email) ||
      (slug && c.linkedin && linkedinSlug(c.linkedin) === slug) ||
      (c.name.toLowerCase() === name && canonBank(c.bank) === canonBank(p.bank)),
  );
}

/**
 * Turn a reviewed person into a contact on the firm's tab (or link the contact they already are), with
 * "Met at <session> <M/D>" + your note as the comment and the session in `metAt`. Returns the contact and whether it was new.
 */
export function confirmPerson(sessionId: string, index: number): { contact: Contact; created: boolean } {
  const st = useStore.getState();
  const s = st.infoSessions.find((x) => x.id === sessionId);
  const p = s?.pending?.[index];
  if (!s || !p) throw new Error("That person isn't on the review list any more.");
  const name = p.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Add a name first.");
  const bank = (p.firm || s.firm).trim();
  const email = p.email?.trim() && /^\S+@\S+\.\S+$/.test(p.email.trim()) ? p.email.trim() : "";
  const linkedin = p.linkedin && /linkedin\.com\/in\//i.test(p.linkedin) ? p.linkedin.trim() : "";
  const met = { sessionId, at: s.start };
  const metLine = `Met at ${cleanTitle(s)} ${sessionDay(s)}`;
  const dup = existingContact(st.contacts, { name, bank, email, linkedin });
  let contact: Contact;
  let created = false;
  if (dup) {
    const metAt = dup.metAt?.some((m) => m.sessionId === sessionId) ? dup.metAt : [...(dup.metAt ?? []), met];
    const comment = dup.comment.includes(metLine) ? dup.comment : [dup.comment, metLine + (p.note ? ` — ${p.note}` : "")].filter(Boolean).join(" · ");
    st.updateContact(dup.id, { metAt, comment, ...(!dup.email && email ? { email, emailSource: "manual" as const } : {}), ...(!dup.position && p.title ? { position: p.title } : {}) }, { at: new Date().toISOString(), type: "note", note: metLine });
    contact = useStore.getState().contacts.find((c) => c.id === dup.id)!;
  } else {
    const region = detectRegion(p.note, p.title);
    contact = addManualContact(
      {
        name,
        bank,
        linkedin,
        email,
        position: p.title?.trim() ?? "",
        location: "",
        team: "",
        region,
        comment: [metLine, p.note?.trim()].filter(Boolean).join(" — "),
      },
      true,
    );
    st.updateContact(contact.id, { metAt: [met] });
    created = true;
  }
  st.updateInfoSession(sessionId, (x) => ({
    pending: (x.pending ?? []).filter((_, i) => i !== index),
    people: x.people.includes(contact.id) ? x.people : [...x.people, contact.id],
  }));
  return { contact, created };
}

/** Confirm everyone on a session's review list. Returns counts and per-person errors. */
export function confirmAll(sessionId: string) {
  let created = 0;
  let linked = 0;
  const errors: string[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const s = useStore.getState().infoSessions.find((x) => x.id === sessionId);
    const list = s?.pending ?? [];
    // Skip people who failed (they stay at the front); stop when only failures are left.
    const i = errors.length;
    if (i >= list.length) break;
    try {
      const r = confirmPerson(sessionId, i);
      if (r.created) created++;
      else linked++;
    } catch (e) {
      errors.push(`${list[i].name}: ${(e as Error).message}`);
    }
  }
  return { created, linked, errors };
}

/** Take someone off a session (the contact stays). */
export function unlinkPerson(sessionId: string, contactId: string) {
  const st = useStore.getState();
  const c = st.contacts.find((x) => x.id === contactId);
  if (c) st.updateContact(c.id, { metAt: c.metAt?.filter((m) => m.sessionId !== sessionId) });
  st.updateInfoSession(sessionId, (s) => ({ people: s.people.filter((id) => id !== contactId) }));
}

/** The contacts you met at this session (by `metAt`, plus anyone listed on the session). */
export function peopleOf(s: InfoSession, contacts: Contact[]) {
  return contacts.filter((c) => c.metAt?.some((m) => m.sessionId === s.id) || s.people.includes(c.id));
}

export async function findEmails(s: InfoSession) {
  const ids = peopleOf(s, useStore.getState().contacts)
    .filter((c) => !c.email)
    .map((c) => c.id);
  if (!ids.length) return { attempted: 0, found: 0, errors: [] as string[] };
  return enrichContacts(ids);
}

/* ------------------------------------------------------------------ thank-yous */

/** Who gets a thank-you: met here, verified address, never emailed, nothing queued. */
export function thankYouList(s: InfoSession, contacts: Contact[]) {
  return peopleOf(s, contacts).filter((c) => !c.sentAt && (c.status === "new" || c.status === "drafted") && !c.serverSend && !(c.scheduledAt && new Date(c.scheduledAt) > new Date()));
}

function ensureTemplate(): Template {
  const st = useStore.getState();
  const t = st.templates.find((x) => x.id === INFO_SESSION_TEMPLATE.id);
  if (t) return t;
  st.upsertTemplate(INFO_SESSION_TEMPLATE);
  return INFO_SESSION_TEMPLATE;
}

/** Your note about them: the part of the comment after this session's "Met at … M/D". */
function noteFor(c: Contact, s: InfoSession) {
  const line = `Met at ${cleanTitle(s)} ${sessionDay(s)}`;
  const i = c.comment.indexOf(line);
  if (i < 0) return "";
  return c.comment.slice(i + line.length).replace(/^\s*[—–-]\s*/, "").split(" · ")[0].trim();
}

export type ThankYouWhen = "tonight" | "next_week";

export interface ThankYouResult {
  drafted: number;
  queued: number;
  /** "tonight" / "next week" when queued on the server, else the drafts wait in Gmail. */
  mode: "server" | "gmail";
  skipped: string[];
  errors: string[];
  firstAt?: Date;
}

/**
 * Write the thank-yous for a session, put them in Gmail as drafts (resume attached), and with automatic sending on, queue
 * them: tonight = 5 min from now, 3 min apart (deliberately outside the send window); next week = the first allowed send
 * day of next week (planSends from next Monday). VP+ without one of your exception ties are left out, as elsewhere.
 */
export async function draftThankYous(sessionId: string, when: ThankYouWhen, onProgress?: (done: number, total: number) => void): Promise<ThankYouResult> {
  const st0 = useStore.getState();
  const s = st0.infoSessions.find((x) => x.id === sessionId);
  if (!s) throw new Error("Session not found.");
  const settings = st0.settings;
  const t = ensureTemplate();
  const skipped: string[] = [];
  const errors: string[] = [];
  const list = thankYouList(s, st0.contacts).filter((c) => {
    if (!c.email) return skipped.push(`${c.name} (no email yet)`), false;
    if (!emailVerified(c)) return skipped.push(`${c.name} (email not verified)`), false;
    const w = vpPlusWarning(c, rulesOf(settings));
    if (w && !w.tie) return skipped.push(`${c.name} (VP or above: ${w.title})`), false;
    return true;
  });
  st0.updateInfoSession(sessionId, { followUp: { when, decidedAt: new Date().toISOString() } });
  if (!list.length) return { drafted: 0, queued: 0, mode: "gmail", skipped, errors };

  const clientId = googleClientId(settings);
  if (!clientId) throw new Error("Connect Gmail in Settings → Email first, so the thank-yous can be drafted.");
  await connectGmail(clientId);
  const resume = t.attachResume ? await blobs.resume() : undefined;
  const made: { c: Contact; draftId: string }[] = [];
  let done = 0;
  for (const c of list) {
    try {
      const note = noteFor(c, s);
      let subject = fillPlaceholders(t.subject, c, settings);
      let body = fillPlaceholders(t.body, c, settings);
      // No note about them: no specific detail to mention, so the slot goes (and the space before it).
      if (!note) body = body.replace(new RegExp(`[ \\t]*${AI_SLOT.source}`, "g"), "");
      body = withSignature(body, settings.profile);
      if (hasAiSlots(subject + body) || missingPlaceholders(subject + body).length) {
        if (aiReady(settings)) {
          const r = await callApi<{ subject: string; body: string }>(
            "/api/draft",
            {
              mode: "fill",
              contact: { id: c.id, name: c.name, bank: c.bank, position: c.position, location: [c.location, c.team].filter(Boolean).join(" · "), region: c.region, school: c.school, comment: c.comment },
              sender: { name: settings.profile.name, school: settings.profile.school, major: settings.profile.major },
              subject,
              body,
            },
            settings,
          );
          subject = r.subject;
          body = r.body;
        } else body = body.replace(new RegExp(`[ \\t]*${AI_SLOT.source}`, "g"), "");
        body = withSignature(body, settings.profile);
      }
      subject = normalizeSubject(subject);
      body = normalizeBody(body);
      const r = await upsertDraft(clientId, c.draft?.gmailDraftId, {
        to: c.email,
        subject,
        body,
        attachment: resume ?? undefined,
        font: EMAIL_FONTS[settings.emailStyle.font]?.css,
      });
      const createdAt = new Date().toISOString();
      const st = useStore.getState();
      st.updateContact(
        c.id,
        {
          templateId: t.id,
          draft: { subject, body, createdAt, gmailDraftId: r.id },
          // Not part of any base A/B test (baseId matches no base).
          draftMeta: { templateId: t.id, baseId: "", createdAt },
        },
        { at: createdAt, type: "note", note: "Info session thank-you drafted in Gmail" },
      );
      if (c.status === "new") st.setStatus([c.id], "drafted", "Gmail draft created");
      made.push({ c, draftId: r.id });
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
    onProgress?.(++done, list.length);
  }

  const st = useStore.getState();
  const auto = serverOn(st) && st.settings.sendMode !== "gmail";
  if (!auto || !made.length) return { drafted: made.length, queued: 0, mode: "gmail", skipped, errors };

  const queuedAt = new Date().toISOString();
  let firstAt: Date | undefined;
  if (when === "tonight") {
    const start = Date.now() + 5 * 60_000;
    made.forEach(({ c, draftId }, i) => {
      const at = new Date(start + i * 3 * 60_000);
      firstAt ??= at;
      st.updateContact(c.id, { serverSend: { draftId, step: 0, sendAt: at.toISOString(), queuedAt, why: "Info session thank-you (tonight)" } });
    });
  } else {
    const ids = new Set(made.map((m) => m.c.id));
    const taken = st.contacts.filter((c) => c.serverSend && !ids.has(c.id)).map((c) => new Date(c.serverSend!.sendAt));
    const monday = nextMonday();
    const plan = planSends(
      made.map((m) => m.c),
      windowOf(st.settings),
      { taken, notBefore: () => monday },
    );
    for (const { c, draftId } of made) {
      const at = plan.get(c.id);
      if (!at) {
        errors.push(`${c.name}: no open send slot next week (the draft is in Gmail)`);
        continue;
      }
      if (!firstAt || at < firstAt) firstAt = at;
      st.updateContact(c.id, { serverSend: { draftId, step: 0, sendAt: at.toISOString(), queuedAt, why: "Info session thank-you (next week)" } });
    }
  }
  const queued = useStore.getState().contacts.filter((c) => made.some((m) => m.c.id === c.id) && c.serverSend).length;
  try {
    await syncServer();
  } catch (e) {
    errors.push(`Queued here, but the server didn't get it yet: ${(e as Error).message}`);
  }
  return { drafted: made.length, queued, mode: "server", skipped, errors, firstAt };
}

/* ------------------------------------------------------------------ images */

/** A picked photo as a JPEG data URL, at most `max` px on the long side (keeps uploads well under the server limit). */
export function imageToDataUrl(file: File, max = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Couldn't read that image."));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image this browser can read (try a JPEG or PNG screenshot)."));
    };
    img.src = url;
  });
}
