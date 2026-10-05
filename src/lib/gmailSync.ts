"use client";

import { useStore } from "./store";
import { detectSentFont, draftExists, findEmailByName, gmailConnected, syncContact, type SyncResult } from "./gmail";
import { googleClientId } from "./keys";
import type { Contact } from "./types";
import { pool } from "./util";

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
  }
  // Never follow up after a bounce or an out-of-office saying they left.
  if ((r.bouncedAt || r.leftNote) && !r.repliedAt && !["replied", "call_scheduled", "done"].includes(c.status)) p.status = "ignored";
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
          let r = await syncContact(clientId, email);
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
