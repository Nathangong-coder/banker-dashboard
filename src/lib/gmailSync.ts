"use client";

import { useStore } from "./store";
import { findEmailByName, gmailConnected, syncContact, type SyncResult } from "./gmail";
import { googleClientId } from "./keys";
import type { Contact } from "./types";
import { pool } from "./util";

export interface SyncSummary {
  checked: number;
  updated: number;
  emailsFound: number;
  newlySent: number;
  replies: number;
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
  }
  if (r.repliedAt && (!r.firstSentAt || r.repliedAt > r.firstSentAt)) {
    p.repliedAt = r.repliedAt;
    if (!["call_scheduled", "done", "ignored"].includes(c.status)) p.status = "replied";
  }
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
    const summary: SyncSummary = { checked: 0, updated: 0, emailsFound: 0, newlySent: 0, replies: 0 };
    if (!clientId || (!opts.interactive && !gmailConnected(clientId))) return summary;

    const now = Date.now();
    const list = s.contacts.filter(
      (c) =>
        c.status !== "ignored" &&
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
          const r = await syncContact(clientId, email);
          summary.checked++;
          const cur = useStore.getState().contacts.find((x) => x.id === c.id) ?? c;
          const p = patchFrom({ ...cur, ...extra }, r);
          if (p?.status === "replied" && cur.status !== "replied") summary.replies++;
          if (p?.sentAt && !cur.sentAt) summary.newlySent++;
          if (p || extra.email) summary.updated++;
          useStore.getState().updateContact(
            c.id,
            { ...extra, ...(p ?? {}) },
            p || extra.email
              ? { at: new Date().toISOString(), type: "note", note: `Gmail: ${r.firstSentAt ? `first emailed ${new Date(r.firstSentAt).toLocaleDateString()}` : "no sent mail"}${r.outreachCount > 1 ? `, ${r.outreachCount - 1} follow-up(s)` : ""}${r.repliedAt ? ", replied" : ""}${extra.email ? `, email found (${email})` : ""}` }
              : undefined,
          );
        } catch (e) {
          if (/expired|session/i.test((e as Error).message)) throw e;
        }
      },
      (done) => opts.onProgress?.(done, list.length),
    );
    useStore.getState().setLastGmailSync(new Date().toISOString());
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
  ].filter(Boolean);
  return bits.length ? `Gmail sync: ${bits.join(" · ")}.` : r.updated ? `Gmail sync: ${r.updated} contact${r.updated > 1 ? "s" : ""} updated.` : "Gmail sync: everything was already up to date.";
}
