"use client";

import { useStore } from "./store";
import { detectSentFont, draftExists, findEmailByName, gmailConnected, sentRecipients, syncContact, type SyncResult } from "./gmail";
import { STARTER_TARGETS, canonBank } from "./banks";
import { domainOf, offSheetPeople, personalDomain, trackerHits, type OffSheetPerson, type SentRecipient } from "./offSheet";
import { googleClientId } from "./keys";
import type { Contact } from "./types";
import { latestIso, pool } from "./util";
import { autoMovedOn } from "./contactUpkeep";
import { matchTrackedSends } from "./trackingActions";

export interface SyncSummary {
  checked: number;
  updated: number;
  emailsFound: number;
  newlySent: number;
  replies: number;
  /** Gmail drafts the user deleted without sending: back to editable dashboard drafts. */
  draftsReverted: number;
  /** Marked sent, but the email is only queued with Schedule send. */
  scheduled: number;
  /** Emailed at a different address than the sheet has (found by name). */
  otherAddress: number;
}

/** How often a contact with no email is re-searched by name. */
const NAME_LOOKUP_EVERY_MS = 12 * 3600_000;
let running: Promise<SyncSummary> | null = null;

/** Turn Gmail facts into contact updates. Gmail is the source of truth for dates; statuses only move forward. */
function patchFrom(c: Contact, r: SyncResult): Partial<Contact> | null {
  const p: Partial<Contact> = {};
  if (r.firstSentAt) {
    p.sentAt = r.firstSentAt;
    p.lastTouchAt = r.lastSentAt;
    // Never lower a count/status the user set by hand (e.g. a follow-up sent from another account).
    p.followUps = Math.max(c.followUps, r.outreachCount - 1, 0);
    p.threadId = r.threadId;
    p.lastMessageId = r.lastMessageId;
    if (!c.draft?.subject && r.subject) p.draft = { subject: r.subject, body: c.draft?.body ?? "", createdAt: r.firstSentAt, gmailDraftId: c.draft?.gmailDraftId };
    const next = p.followUps > 0 ? "followed_up" : "sent";
    const rank = { new: 0, drafted: 1, sent: 2, followed_up: 3 } as Record<string, number>;
    if (c.status in rank && rank[next] >= rank[c.status]) p.status = next;
    // The follow-up draft made from Follow-ups went out.
    if (c.followUpDraft && p.followUps >= c.followUpDraft.step) p.followUpDraft = undefined;
  }
  if (r.lastEmailedAt) p.lastEmailedAt = r.lastEmailedAt;
  if (r.lastHeardAt) p.lastHeardAt = r.lastHeardAt;
  if ((r.scheduledAt ?? "") !== (c.scheduledAt ?? "")) p.scheduledAt = r.scheduledAt;
  // Marked sent, but Gmail has nothing sent to them and an email queued with Schedule send: it hasn't gone out yet,
  // so it isn't due for a follow-up. (Only with a scheduled email in hand, so mail sent from another account stays.)
  if (!r.firstSentAt && r.scheduledAt && !c.sentAt && (c.status === "sent" || c.status === "followed_up")) {
    p.status = "drafted";
    p.followUps = 0;
  }
  if (r.repliedAt && (!r.firstSentAt || r.repliedAt > r.firstSentAt)) {
    p.repliedAt = r.repliedAt;
    if (!["call_scheduled", "done", "ignored"].includes(c.status)) p.status = "replied";
    // Moved on for no reply, then they wrote back: they're live again.
    if (autoMovedOn(c)) {
      p.status = "replied";
      p.outcome = undefined;
    }
  }
  // Never follow up after a bounce or an out-of-office saying they left; the desk needs someone new.
  if ((r.bouncedAt || r.leftNote) && !r.repliedAt && !["replied", "call_scheduled", "done"].includes(c.status)) {
    p.status = "ignored";
    if (!c.outcome) p.outcome = r.bouncedAt ? { kind: "bounced", at: r.bouncedAt, note: "Email bounced (address doesn't exist)", confirmed: true } : { kind: "left", at: new Date().toISOString(), note: r.leftNote, confirmed: true };
  }
  // A reply that reads like a clear no: suggested only. Nothing changes until you confirm it on Follow-ups.
  if (r.declineNote && r.repliedAt && !c.outcome && c.status !== "call_scheduled") p.outcome = { kind: "declined", at: r.repliedAt, note: r.declineNote, confirmed: false };
  const changed = (Object.keys(p) as (keyof Contact)[]).some((k) => JSON.stringify(p[k]) !== JSON.stringify(c[k]));
  return changed ? p : null;
}

/**
 * Sync every relevant contact with Gmail: real first-email date, follow-up count, reply date, and
 * (for people with no email on file) the address we actually emailed them at.
 * `interactive: false` never opens Google's popup; it only runs if this session already has a token.
 */
export function syncAllWithGmail(opts: { interactive: boolean; onProgress?: (done: number, total: number) => void }): Promise<SyncSummary> {
  if (running) return running;
  running = (async () => {
    const s = useStore.getState();
    const clientId = googleClientId(s.settings);
    const summary: SyncSummary = { checked: 0, updated: 0, emailsFound: 0, newlySent: 0, replies: 0, draftsReverted: 0, scheduled: 0, otherAddress: 0 };
    if (!clientId || (!opts.interactive && !gmailConnected(clientId))) return summary;

    const now = Date.now();
    const list = s.contacts.filter(
      (c) =>
        (c.status !== "ignored" || autoMovedOn(c)) &&
        (c.email || (c.firstName && c.lastName && (!c.gmailCheckedAt || now - new Date(c.gmailCheckedAt).getTime() > NAME_LOOKUP_EVERY_MS))),
    );
    await pool(
      list,
      3,
      async (c) => {
        let email = c.email;
        const extra: Partial<Contact> = { gmailCheckedAt: new Date().toISOString() };
        try {
          if (!email) {
            const found = await findEmailByName(clientId, c.firstName, c.lastName);
            if (!found) {
              useStore.getState().updateContact(c.id, extra);
              return;
            }
            email = found;
            Object.assign(extra, { email: found, emailSource: "gmail" as const });
            summary.emailsFound++;
          }
          let r = await syncContact(clientId, email, c.aliases);
          summary.checked++;
          let cur = useStore.getState().contacts.find((x) => x.id === c.id) ?? c;
          // Marked as emailed, but nothing went to the address on file: maybe they were emailed somewhere else (a
          // personal address, or the sheet's email is a wrong guess). Dates come from the address actually used.
          let usedOther = "";
          if (!r.firstSentAt && !r.scheduledAt && c.email && ["sent", "followed_up", "replied", "call_scheduled"].includes(cur.status)) {
            const found = await findEmailByName(clientId, c.firstName, c.lastName);
            if (found && found.toLowerCase() !== c.email.toLowerCase()) {
              const alt = await syncContact(clientId, found);
              if (alt.firstSentAt) {
                r = alt;
                usedOther = found;
                summary.otherAddress++;
              }
            }
          }
          cur = useStore.getState().contacts.find((x) => x.id === c.id) ?? cur;
          const p = patchFrom({ ...cur, ...extra }, r);
          // A Gmail draft we created is gone: sent (Gmail shows mail after the draft was made) or deleted by the user.
          const draftId = cur.draft?.gmailDraftId;
          if (draftId && !(await draftExists(clientId, draftId))) {
            const sentAfter = r.lastSentAt && cur.draft && r.lastSentAt >= cur.draft.createdAt;
            const draft = { ...(p?.draft ?? cur.draft!), gmailDraftId: undefined };
            if (sentAfter) Object.assign(extra, { draft });
            else {
              summary.draftsReverted++;
              useStore.getState().updateContact(
                c.id,
                { draft },
                { at: new Date().toISOString(), type: "note", note: "Gmail draft was deleted without sending; it's back in the dashboard drafts" },
              );
              extra.draft = draft;
            }
          }
          if (p?.status === "replied" && cur.status !== "replied") summary.replies++;
          if (p?.status === "drafted" && cur.status !== "drafted") summary.scheduled++;
          if (p?.sentAt && !cur.sentAt) summary.newlySent++;
          if (p || extra.email) summary.updated++;
          useStore.getState().updateContact(
            c.id,
            { ...extra, ...(p ?? {}), ...(extra.draft ? { draft: extra.draft } : {}) },
            p || extra.email
              ? { at: new Date().toISOString(), type: "note", note: `Gmail: ${r.firstSentAt ? `first emailed ${new Date(r.firstSentAt).toLocaleDateString()}` : "no sent mail"}${r.outreachCount > 1 ? `, ${r.outreachCount - 1} follow-up(s)` : ""}${r.repliedAt ? ", replied" : ""}${r.bouncedAt ? ", bounced (no more follow-ups)" : ""}${r.leftNote ? `, auto-reply says they left: "${r.leftNote}"` : ""}${extra.email ? `, email found (${email})` : ""}${usedOther ? `, emailed at ${usedOther} (not the address on file)` : ""}${p?.status === "drafted" ? `, only scheduled (goes out ${new Date(r.scheduledAt!).toLocaleString()}), so not sent yet` : ""}` }
              : undefined,
          );
        } catch (e) {
          if (/expired|session/i.test((e as Error).message)) throw e;
        }
      },
      (done) => opts.onProgress?.(done, list.length),
    );
    useStore.getState().setLastGmailSync(new Date().toISOString());
    // Tracked emails (open tracking) that went out get their sent date from the contacts' new dates.
    matchTrackedSends();
    // Bankers emailed but not in the tracker (throttled to every 6 h; a failure here never fails the sync).
    await scanOffSheet({ interactive: false }).catch(() => undefined);
    return summary;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function describeSync(r: SyncSummary) {
  const bits = [
    r.newlySent && `${r.newlySent} sent date${r.newlySent > 1 ? "s" : ""} filled in`,
    r.emailsFound && `${r.emailsFound} missing email${r.emailsFound > 1 ? "s" : ""} found`,
    r.replies && `${r.replies} new repl${r.replies > 1 ? "ies" : "y"}`,
    r.draftsReverted && `${r.draftsReverted} deleted Gmail draft${r.draftsReverted > 1 ? "s" : ""} back in your drafts`,
    r.scheduled && `${r.scheduled} marked sent but only scheduled (follow-ups start once they go out)`,
    r.otherAddress && `${r.otherAddress} emailed at a different address than the sheet has (see their history)`,
  ].filter(Boolean);
  return bits.length ? `Gmail sync: ${bits.join(" · ")}.` : r.updated ? `Gmail sync: ${r.updated} contact${r.updated > 1 ? "s" : ""} updated.` : "Gmail sync: everything was already up to date.";
}

/**
 * Tag already-sent emails with the font they actually went out in (read from Gmail), so results cover outreach from
 * before font tracking. Only touches sent contacts with an email and no font yet; manual tags are never overwritten.
 */
export async function autoTagFontsFromGmail(onProgress?: (done: number, total: number) => void) {
  const s = useStore.getState();
  const clientId = googleClientId(s.settings);
  if (!clientId) throw new Error("Connect Gmail first (Settings → Gmail).");
  const list = s.contacts.filter((c) => c.email && !c.trial?.font && (c.sentAt || ["sent", "followed_up", "replied", "call_scheduled", "done"].includes(c.status)));
  let tagged = 0;
  let noMail = 0;
  await pool(
    list,
    3,
    async (c) => {
      try {
        const r = await detectSentFont(clientId, c.email);
        const cur = useStore.getState().contacts.find((x) => x.id === c.id) ?? c;
        if (!r.sentAt) {
          noMail++;
          return;
        }
        if (!r.font) return;
        tagged++;
        useStore.getState().updateContact(c.id, {
          trial: { at: cur.trial?.at ?? r.sentAt, arms: cur.trial?.arms ?? {}, font: r.font, fontSource: "gmail" },
          ...(cur.sentAt ? {} : { sentAt: r.sentAt }),
        });
      } catch (e) {
        if (/expired|session/i.test((e as Error).message)) throw e;
      }
    },
    (done) => onProgress?.(done, list.length),
  );
  return { checked: list.length, tagged, noMail };
}

/* ------------------------------------------------------------------ bankers emailed, not in the tracker */

const OFF_SHEET_EVERY_MS = 3 * 3600_000;
const OFF_SHEET_DAYS = 120;
let scanning: Promise<number> | null = null;

/** Every bank name the app knows (lists, coverage, contacts, starter list), for matching an unfamiliar domain. */
export function bankNames() {
  const s = useStore.getState();
  return [...new Set([...STARTER_TARGETS, ...s.targets, ...s.coverage.added].map((t) => t.name).concat(s.contacts.map((c) => c.bank)).filter(Boolean))];
}

export function offSheetList() {
  const s = useStore.getState();
  return offSheetPeople(s.offSheet.recipients, s.contacts, { me: [s.settings.profile.email].filter(Boolean), banks: bankNames(), ignored: s.offSheet.ignored });
}

/** "YYYY/MM/DD" for Gmail's after: (the day before, so nothing on the boundary is missed). */
const gmailDay = (t: number) => {
  const d = new Date(t - 86_400_000);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The server's read of your sent mail (api/server/sent: To, Cc and Bcc, no popup), since the last server scan or 120
 * days. Null when the server has no read access (or isn't connected), so the browser scan runs instead.
 */
async function serverRecipients(sinceMs: number): Promise<SentRecipient[] | null> {
  if (!useStore.getState().settings.server?.id) return null;
  const { serverCall } = await import("./serverSync");
  const out: SentRecipient[] = [];
  const have = new Set<string>();
  let page: string | undefined;
  for (let round = 0; round < 12; round++) {
    const r = await serverCall<{ read: boolean; recipients: (SentRecipient & { id: string })[]; next?: string | null }>("/api/server/sent", { after: gmailDay(sinceMs), page });
    if (!r.read) return round ? out : null;
    for (const x of r.recipients) {
      const k = `${x.id}|${x.email}`;
      if (have.has(k)) continue;
      have.add(k);
      out.push({ email: x.email, name: x.name, at: x.at, subject: x.subject, threadId: x.threadId });
    }
    if (r.next === null || r.next === undefined) break;
    page = r.next || undefined;
  }
  return out;
}

/**
 * Read the recipients of your sent mail (last 120 days) so lib/offSheet.ts can list bankers you emailed who aren't in
 * the tracker. The server reads it when it has Gmail read access (To / Cc / Bcc, no popup: the browser-only scan
 * missed the Tidal and Mizuho thank-yous, owner 2026-10-28); else this tab's Gmail token (only messages not read
 * before). Runs on load / after a Gmail sync at most every 6 h, or on demand. Bankers at a firm the tracker already
 * has an address for (same domain) are added to the tracker right away; the rest wait on Follow-ups → Not in tracker.
 */
export function scanOffSheet(opts: { interactive: boolean; force?: boolean }): Promise<number> {
  if (scanning) return scanning;
  scanning = (async () => {
    const s = useStore.getState();
    if (!opts.force && s.offSheet.scannedAt && Date.now() - Date.parse(s.offSheet.scannedAt) < OFF_SHEET_EVERY_MS) return offSheetList().length;
    const since = new Date(Date.now() - OFF_SHEET_DAYS * 86_400_000);
    const me = [s.settings.profile.email].filter(Boolean);
    const cutoff = since.getTime();
    const fromServer = await serverRecipients(s.offSheet.serverAt ? Math.max(cutoff, Date.parse(s.offSheet.serverAt) - 2 * 86_400_000) : cutoff).catch(() => null);
    let fresh: SentRecipient[];
    let read: string[] = [];
    if (fromServer) fresh = fromServer;
    else {
      const clientId = googleClientId(s.settings);
      if (!clientId || (!opts.interactive && !gmailConnected(clientId))) return offSheetList().length;
      const r = await sentRecipients(clientId, gmailDay(cutoff + 86_400_000), new Set(s.offSheet.seen));
      fresh = r.recipients;
      read = r.read;
    }
    // Only work addresses are worth keeping (friends, classmates and no-reply addresses never are).
    const keep = fresh.filter((r) => !personalDomain(domainOf(r.email), me));
    const cur = useStore.getState().offSheet;
    const seenKey = new Set(cur.recipients.map((r) => `${r.email}|${r.at}`));
    useStore.getState().setOffSheet({
      scannedAt: new Date().toISOString(),
      ...(fromServer ? { serverAt: new Date().toISOString() } : {}),
      seen: [...cur.seen, ...read].slice(-4000),
      recipients: [...cur.recipients.filter((r) => r.at >= cutoff), ...keep.filter((r) => !seenKey.has(`${r.email}|${r.at}`))].slice(-4000),
    });
    recordTrackerHits();
    await autoAddOffSheet();
    return offSheetList().length;
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

/**
 * Emails to people already in the tracker by name but not by this address (lib/offSheet.ts#trackerHits): their email
 * (or a second address) and sent dates are filled in, so follow-ups and the live count see them.
 */
export function recordTrackerHits() {
  const s = useStore.getState();
  const hits = trackerHits(s.offSheet.recipients, s.contacts, { banks: bankNames() });
  for (const h of hits) {
    const c = s.contacts.find((x) => x.id === h.contactId);
    if (!c) continue;
    const p: Partial<Contact> = c.email ? { aliases: [...new Set([...(c.aliases ?? []), h.email])].slice(0, 6) } : { email: h.email, emailSource: "gmail" };
    if (!c.sentAt) {
      p.sentAt = h.firstAt;
      if (c.status === "new" || c.status === "drafted") p.status = "sent";
      p.threadId = c.threadId ?? h.threadId;
    }
    p.lastEmailedAt = latestIso(c.lastEmailedAt, h.lastAt);
    if (!c.repliedAt) p.lastTouchAt = latestIso(c.lastTouchAt, h.lastAt);
    s.updateContact(c.id, p, { at: new Date().toISOString(), type: "note", note: `Gmail: emailed at ${h.email} ${new Date(h.firstAt).toLocaleDateString()}${c.email ? " (another address of theirs)" : " (email added)"}` });
  }
  return hits.length;
}

/**
 * Bankers you emailed at a firm the tracker already has people at (their address is on that firm's domain: Grace He
 * and Zach Righellis at mizuhogroup.com, owner 2026-10-28) go straight into the tracker with their dates. Domains only
 * guessed from a bank's name, and other companies, stay on the review list.
 */
export async function autoAddOffSheet() {
  const s = useStore.getState();
  const known = new Set(s.contacts.map((c) => (c.email ? domainOf(c.email) : "")).filter(Boolean));
  const sure = offSheetList().filter((p) => p.bankDomain && known.has(domainOf(p.email)) && !s.offSheet.ignored.includes(p.email));
  for (const p of sure.slice(0, 25)) await addOffSheet(p).catch(() => undefined);
  if (sure.length) {
    const { toast } = await import("@/components/ui");
    const names = sure.slice(0, 4).map((p) => `${p.name || p.email} (${p.bank})`).join(", ");
    toast.ok(`Added ${sure.length} banker${sure.length > 1 ? "s" : ""} you emailed to the tracker: ${names}${sure.length > 4 ? "…" : ""}`);
  }
  return sure.length;
}

/** Not a banker to track: hidden from the list from now on. */
export function ignoreOffSheet(email: string) {
  const s = useStore.getState();
  s.setOffSheet({ ignored: [...new Set([...s.offSheet.ignored, email.toLowerCase()])] });
}

/**
 * Add someone you emailed to the tracker (a row on the bank's tab when a workbook is loaded), then read their Gmail
 * history so the first-email date, follow-up count and replies are right and Follow-ups shows them when due.
 */
export async function addOffSheet(p: OffSheetPerson) {
  const { addManualContact } = await import("./actions");
  const s = useStore.getState();
  // Same bank as people you already track there: take that spelling .
  const peer = s.contacts.find((c) => c.bank && canonBank(c.bank) === canonBank(p.bank));
  const bank = peer?.bank ?? p.bank;
  // Their office isn't in an email: "Other" until you set it (the bank tab still gets the row).
  const region = "Other" as const;
  const when = new Date(p.firstAt).toLocaleDateString();
  const c = addManualContact(
    { name: p.name || p.email, bank, email: p.email, linkedin: "", position: "", location: "", team: "", region, comment: `Emailed ${when} (found in Gmail, wasn't in the tracker): "${p.subject}"` },
    true,
  );
  const clientId = googleClientId(s.settings);
  if (clientId && gmailConnected(clientId)) {
    const r = await syncContact(clientId, p.email);
    const patch = patchFrom(c, r);
    if (patch) useStore.getState().updateContact(c.id, { ...patch, emailSource: "gmail", gmailCheckedAt: new Date().toISOString() });
  } else {
    // No Gmail token this session: the scan's own dates, so follow-up timing still works.
    useStore.getState().updateContact(c.id, { sentAt: p.firstAt, lastTouchAt: p.lastAt, lastEmailedAt: p.lastAt, status: "sent", threadId: p.threadId, emailSource: "gmail" });
  }
  return useStore.getState().contacts.find((x) => x.id === c.id) ?? c;
}
