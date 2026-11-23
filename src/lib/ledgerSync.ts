"use client";

import { useStore } from "./store";
import { addressIsPerson } from "./nameMatch";
import { ledgerDue, otherPersonOnAddress, type LedgerMsg, type MailLedger } from "./mailLedger";
import { RANK_OF, isEngaged } from "./thinkAbout";
import type { Contact } from "./types";

/**
 * Keeps each person's email conversation (`contact.mail`) fresh from Gmail via the server (api/server/conversation).
 * Who: everyone engaged (replied, met, chatted, referred) plus anyone emailed in the last 60 days, moved-on people
 * included (a reply the tracker missed is exactly what we're looking for). Single-flight.
 */

type Wire = {
  read: boolean;
  people: { contactId: string; messages: LedgerMsg[]; aliases: string[]; namesOnFile: string[]; lastIn?: { id: string; text?: string }; lastOut?: { id: string; text?: string } }[];
  left: string[];
};

const DAY = 86_400_000;
let running: Promise<number> | null = null;

/** Mailboxes learned earlier that carry their last name but aren't them (the old learner took a shared last name). */
function cleanAliases(c: Contact) {
  const last = c.name.trim().split(/\s+/).slice(1).join("").toLowerCase().replace(/[^a-z]/g, "");
  return (c.aliases ?? []).filter((a) => !last || !a.split("@")[0].replace(/[^a-z]/g, "").includes(last) || addressIsPerson({ name: "", email: a }, c.firstName || c.name.split(" ")[0], c.lastName || c.name.split(" ").slice(1).join(" ")));
}

/**
 * Owner, 2026-11-23 audit: 19 people sat at "drafted" (Kirsty Gao, Ally Connors, Colin Bryant…) although their
 * Schedule-send emails went out Oct 28–29, because only people with a first-email date were ever read. Now drafted
 * people are always read, and "new" people with an email at most weekly (`ledgerDue` below), so a send, a follow-up
 * or a reply the tracker missed moves them on.
 */
export function ledgerCandidates(contacts: Contact[], now = Date.now()) {
  return contacts.filter((c) => {
    if (!c.email || !/@/.test(c.email)) return false;
    if (c.outcome?.kind === "bounced" || c.outcome?.kind === "left") return false;
    const recent = [c.lastEmailedAt, c.lastTouchAt, c.sentAt].some((d) => d && now - Date.parse(d) < 60 * DAY);
    const unsent = c.status === "drafted" || (c.status === "new" && (!c.mail || now - Date.parse(c.mail.checkedAt) > 7 * DAY));
    return isEngaged(c) || recent || unsent || (RANK_OF[c.status] ?? 0) >= 4;
  });
}

export function syncLedgers(opts: { ids?: string[]; force?: boolean; max?: number } = {}): Promise<number> {
  if (running) return running;
  running = (async () => {
    const st = useStore.getState();
    if (!st.settings.server?.id) return 0;
    const { serverCall } = await import("./serverSync");
    const want = opts.ids ? st.contacts.filter((c) => opts.ids!.includes(c.id) && c.email) : ledgerCandidates(st.contacts).filter((c) => opts.force || ledgerDue(c, isEngaged(c)));
    // Engaged people and the longest-unchecked first.
    want.sort((a, b) => Number(isEngaged(b)) - Number(isEngaged(a)) || (a.mail?.checkedAt ?? "").localeCompare(b.mail?.checkedAt ?? ""));
    const queue = want.slice(0, opts.max ?? 60);
    let n = 0;
    for (let i = 0; i < queue.length; i += 8) {
      const batch = queue.slice(i, i + 8).map((c) => {
        const aliases = cleanAliases(c);
        return { c, aliases, body: { contactId: c.id, name: c.name, emails: [...new Set([c.email, ...aliases].map((e) => e.trim().toLowerCase()))].filter((e) => /^\S+@\S+\.\S+$/.test(e)).slice(0, 4) } };
      });
      const r = await serverCall<Wire>("/api/server/conversation", { people: batch.map((b) => b.body) });
      if (!r.read) return n;
      const now = new Date().toISOString();
      for (const p of r.people) {
        const b = batch.find((x) => x.c.id === p.contactId);
        const cur = useStore.getState().contacts.find((x) => x.id === p.contactId);
        if (!b || !cur) continue;
        const msgAt = (id?: string) => p.messages.find((m) => m.id === id)?.at;
        const mail: MailLedger = {
          checkedAt: now,
          messages: p.messages,
          lastIn: p.lastIn?.text !== undefined && msgAt(p.lastIn.id) ? { id: p.lastIn.id, at: msgAt(p.lastIn.id)!, text: p.lastIn.text } : undefined,
          lastOut: p.lastOut?.text !== undefined && msgAt(p.lastOut.id) ? { id: p.lastOut.id, at: msgAt(p.lastOut.id)!, text: p.lastOut.text } : undefined,
          otherPerson: otherPersonOnAddress(cur.name, cur.email, p.namesOnFile),
        };
        useStore.getState().updateContact(cur.id, { ...ledgerPatch(cur, mail), ...(aliasesChanged(cur, b.aliases, p.aliases) ? { aliases: [...new Set([...b.aliases, ...p.aliases])] } : {}) });
        n++;
      }
      // Out of time on the server: the rest wait for the next run.
      if (r.left.length && r.people.length === 0) break;
    }
    return n;
  })().finally(() => {
    running = null;
  });
  return running;
}

const aliasesChanged = (c: Contact, kept: string[], learned: string[]) => kept.length !== (c.aliases ?? []).length || learned.some((a) => !(c.aliases ?? []).includes(a));

/**
 * What the conversation says about the contact's own fields: replied / first-email dates that were missing, the
 * newest reply's text, status up to replied. Dates you already have are only moved forward (the ledger reads the
 * newest 20 threads of the last year, so it can miss an old first email).
 */
export function ledgerPatch(c: Contact, mail: MailLedger): Partial<Contact> {
  const p: Partial<Contact> = { mail };
  const ins = mail.messages.filter((m) => m.dir === "in");
  const outs = mail.messages.filter((m) => m.dir === "out");
  if (outs.length && (!c.sentAt || outs[0].at < c.sentAt)) p.sentAt = outs[0].at;
  const lastOut = outs[outs.length - 1]?.at;
  if (lastOut && (!c.lastEmailedAt || lastOut > c.lastEmailedAt)) p.lastEmailedAt = lastOut;
  const lastIn = ins[ins.length - 1]?.at;
  if (lastIn && (!c.lastHeardAt || lastIn > c.lastHeardAt)) p.lastHeardAt = lastIn;
  const firstReply = ins.find((m) => !outs.length || m.at > outs[0].at);
  if (firstReply && !c.repliedAt) p.repliedAt = firstReply.at;
  if (ins.length && (RANK_OF[c.status] ?? 0) < RANK_OF.replied && (c.status !== "ignored" || c.outcome?.kind === "no_reply")) {
    p.status = "replied";
    if (c.outcome?.kind === "no_reply") p.outcome = undefined;
  }
  // Emails out but the status says nothing went (a Schedule-send email that went out, a send from Gmail itself):
  // sent, or followed up with the count of emails before their first reply.
  if (outs.length && (c.status === "new" || c.status === "drafted")) {
    const before = outs.filter((m) => !firstReply || m.at < firstReply.at);
    const fu = Math.max(0, before.length - 1);
    if (!ins.length) p.status = fu > 0 ? "followed_up" : "sent";
    if (fu > (c.followUps ?? 0)) p.followUps = fu;
    const lastBefore = before[before.length - 1]?.at;
    if (lastBefore && (!c.lastTouchAt || lastBefore > c.lastTouchAt)) p.lastTouchAt = lastBefore;
  } else if (outs.length && !ins.length && (c.status === "sent" || c.status === "followed_up")) {
    // Follow-ups sent from Gmail directly count too.
    const fu = outs.length - 1;
    if (fu > (c.followUps ?? 0)) {
      p.followUps = fu;
      p.status = "followed_up";
      if (!c.lastTouchAt || outs[outs.length - 1].at > c.lastTouchAt) p.lastTouchAt = outs[outs.length - 1].at;
    }
  }
  // A Schedule-send time that has passed is history (it went out, or you cancelled it).
  if (c.scheduledAt && Date.parse(c.scheduledAt) < Date.now() && outs.some((m) => m.at >= c.scheduledAt!.slice(0, 10))) p.scheduledAt = undefined;
  if (mail.lastIn && (!c.lastReply || mail.lastIn.at >= c.lastReply.at) && c.lastReply?.messageId !== mail.lastIn.id) {
    const thread = ins.find((m) => m.id === mail.lastIn!.id)?.threadId;
    p.lastReply = { at: mail.lastIn.at, messageId: mail.lastIn.id, threadId: thread, text: mail.lastIn.text };
  }
  return p;
}
