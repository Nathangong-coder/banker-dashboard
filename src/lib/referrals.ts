"use client";

import { useStore } from "./store";
import { callApi } from "./api";
import { aiReady } from "./keys";
import { canonBank } from "./banks";
import { latestIso } from "./util";
import { autoMovedOn } from "./contactUpkeep";
import type { TrackResult } from "./replyTracking";
import type { Contact } from "./types";

/**
 * Reply / referral tracking in the dashboard (owner, 2026-10-22). The server reads Gmail every hour
 * (lib/server/gmailTrack.ts) for the people `trackList` names; `applyTracking` folds what it found into contacts
 * (dates, replies, learned addresses, intros), `readReplies` has the AI read new replies for referrals without a cc,
 * and Follow-ups → Referrals (components/Referrals.tsx) asks you to confirm each one.
 */

const DAY = 86_400_000;
const RANK: Record<string, number> = { new: 0, drafted: 1, sent: 2, followed_up: 3, replied: 4, call_scheduled: 5, done: 6 };

export interface TrackStateWire {
  result: TrackResult;
  checkedAt: string;
  texts?: Record<string, { at: string; text: string }>;
}

/** Who the server should watch: everyone you've emailed or talked to (not moved on), with an address. */
export function trackList(contacts: Contact[]) {
  const now = Date.now();
  return contacts
    .filter((c) => c.email && c.status !== "ignored" && (c.sentAt || c.chats?.length || c.call || c.referredBy || (RANK[c.status] ?? 0) >= 2))
    .map((c) => {
      const recent = [c.lastEmailedAt, c.lastTouchAt, c.lastHeardAt, c.call?.at, ...(c.chats ?? []).map((x) => x.at)].filter((d): d is string => !!d).sort().pop();
      const start = c.sentAt ? Date.parse(c.sentAt) - 2 * DAY : now - 120 * DAY;
      return {
        contactId: c.id,
        name: c.name,
        emails: [...new Set([c.email, ...(c.aliases ?? [])].map((e) => e.toLowerCase()))].filter((e) => /^\S+@\S+\.\S+$/.test(e)).slice(0, 4),
        since: new Date(Math.max(start, now - 365 * DAY)).toISOString(),
        hot: !!recent && now - Date.parse(recent) < 21 * DAY,
        knownLast: latestIso(c.lastEmailedAt, c.lastTouchAt ?? c.sentAt),
      };
    })
    .filter((p) => p.emails.length)
    .slice(0, 400);
}

/** Fold the server's Gmail findings into contacts. Dates only move forward; statuses only move up. */
export function applyTracking(states: Record<string, TrackStateWire>) {
  const st = useStore.getState();
  let changed = 0;
  for (const [id, s] of Object.entries(states)) {
    const c = st.contacts.find((x) => x.id === id);
    if (!c) continue;
    const r = s.result;
    const p: Partial<Contact> = {};
    const later = (cur: string | undefined, next: string | undefined) => (next && (!cur || next > cur) ? next : undefined);
    const le = later(c.lastEmailedAt, r.lastEmailedAt);
    if (le) p.lastEmailedAt = le;
    const lh = later(c.lastHeardAt, r.lastHeardAt);
    if (lh) p.lastHeardAt = lh;
    if (r.firstSentAt && !c.sentAt) {
      p.sentAt = r.firstSentAt;
      p.lastTouchAt = r.firstSentAt;
    }
    if (r.repliedAt && !c.repliedAt) p.repliedAt = r.repliedAt;
    const status = r.repliedAt ? "replied" : r.firstSentAt ? (r.outreachCount > 1 ? "followed_up" : "sent") : undefined;
    if (status && (RANK[status] ?? 0) > (RANK[c.status] ?? 0) && c.status !== "ignored") p.status = status;
    // Moved on for no reply, then they wrote back: live again.
    if (r.repliedAt && autoMovedOn(c)) {
      p.status = "replied";
      p.outcome = undefined;
    }
    // A follow-up that went out by itself (Gmail Schedule send) moves the follow-up clock, not only the count.
    if (!r.repliedAt && le && r.outreachCount - 1 > c.followUps) p.lastTouchAt = le;
    if (!r.repliedAt && r.outreachCount > 1 && r.outreachCount - 1 > c.followUps) p.followUps = r.outreachCount - 1;
    const aliases = r.aliases.filter((a) => a !== c.email.toLowerCase() && !(c.aliases ?? []).includes(a));
    if (aliases.length) p.aliases = [...(c.aliases ?? []), ...aliases];
    // Intros (someone new cc'd): a suggestion each, unless you already recorded that person as their referral.
    const signals = [...(c.signals ?? [])];
    for (const i of r.intros) {
      const sid = `intro:${i.messageId}`;
      if (signals.some((x) => x.id === sid)) continue;
      const known = i.people.every((pp) => c.referral?.to?.some((t) => t.email?.toLowerCase() === pp.email));
      signals.push({
        id: sid,
        messageId: i.messageId,
        threadId: i.threadId,
        at: i.at,
        kind: "intro",
        people: i.people.map((pp) => ({ name: pp.name || nameFromEmail(pp.email), email: pp.email })),
        text: `cc'd ${i.people.map((pp) => pp.name || pp.email).join(", ")}`,
        youWroteAt: i.youWroteAt,
        status: known ? "accepted" : "new",
      });
    }
    if (signals.length !== (c.signals ?? []).length) p.signals = signals;
    if (Object.keys(p).length) {
      const note = [aliases.length ? `Also writes from ${aliases.join(", ")}` : "", r.intros.length && p.signals ? "Gmail: they introduced you to someone (check Follow-ups → Referrals)" : ""].filter(Boolean).join(". ");
      st.updateContact(c.id, p, note ? { at: new Date().toISOString(), type: "note", note } : undefined);
      changed++;
    }
  }
  return changed;
}

/** "kevin.zhu@mizuhogroup.com" → "Kevin Zhu". */
export function nameFromEmail(e: string) {
  return e
    .split("@")[0]
    .split(/[._-]+/)
    .filter((w) => /^[a-z]+$/i.test(w))
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

type ReadResult = {
  results: {
    id: string;
    kind: "referral" | "scheduling" | "advice" | "decline" | "acknowledgement" | "other";
    referredTo: { name: string; email: string | null; role: string | null }[];
    promises: string[];
    dates: string[];
    needsReply: boolean;
    summary: string;
    confidence: "high" | "medium" | "low";
  }[];
};

/**
 * Have the AI read replies the server fetched (referrals with no cc, promises). Returns the ids to acknowledge (their
 * text is then deleted from the server). Without an AI model they're acknowledged unread: intros still come from the cc.
 */
export async function readReplies(states: Record<string, TrackStateWire>) {
  const st = useStore.getState();
  const pending: { contactId: string; id: string; at: string; text: string }[] = [];
  for (const [contactId, s] of Object.entries(states)) {
    const c = st.contacts.find((x) => x.id === contactId);
    for (const [id, t] of Object.entries(s.texts ?? {})) {
      // Already read (the ack reaches the server on the next sync) or being read right now.
      if (reading.has(id) || c?.signals?.some((x) => x.id === `ai:${id}`)) continue;
      if (t.text.trim()) pending.push({ contactId, id, at: t.at, text: t.text });
    }
  }
  for (const p of pending) reading.add(p.id);
  const ack = new Map<string, string[]>();
  const done = (contactId: string, id: string) => ack.set(contactId, [...(ack.get(contactId) ?? []), id]);
  if (!pending.length) return [];
  if (!aiReady(st.settings)) {
    for (const p of pending) {
      done(p.contactId, p.id);
      reading.delete(p.id);
    }
    return [...ack].map(([contactId, ids]) => ({ contactId, ids }));
  }
  for (let i = 0; i < pending.length; i += 10) {
    const batch = pending.slice(i, i + 10);
    try {
      const r = await callApi<ReadResult>(
        "/api/replies/classify",
        {
          replies: batch.map((p) => {
            const c = useStore.getState().contacts.find((x) => x.id === p.contactId);
            const intro = c?.signals?.find((x) => x.messageId === p.id && x.kind === "intro");
            return { id: p.id, name: c?.name ?? "", bank: c?.bank ?? "", text: p.text.slice(0, 2000), added: (intro?.people ?? []).map((x) => ({ name: x.name, email: x.email ?? "" })) };
          }),
        },
        useStore.getState().settings,
      );
      for (const p of batch) {
        const res = r.results.find((x) => x.id === p.id);
        done(p.contactId, p.id);
        if (!res) continue;
        const cur = useStore.getState().contacts.find((x) => x.id === p.contactId);
        if (!cur) continue;
        const signals = [...(cur.signals ?? [])];
        const intro = signals.find((x) => x.messageId === p.id && x.kind === "intro");
        const extra = [res.promises.length ? `Promised: ${res.promises.join("; ")}` : "", res.dates.length ? `Dates: ${res.dates.join("; ")}` : ""].filter(Boolean).join(". ");
        if (intro) {
          // Same email as a cc'd intro: add what the text says to it.
          intro.text = [res.summary, extra].filter(Boolean).join(" ").slice(0, 300) || intro.text;
        } else if (res.kind === "referral" || res.referredTo.length) {
          signals.push({
            id: `ai:${p.id}`,
            messageId: p.id,
            at: p.at,
            kind: "referral",
            people: res.referredTo.map((x) => ({ name: x.name, email: x.email ?? undefined, role: x.role ?? undefined })),
            text: [res.summary, extra].filter(Boolean).join(" ").slice(0, 300),
            status: "new",
          });
        } else if (res.promises.length) {
          signals.push({ id: `ai:${p.id}`, messageId: p.id, at: p.at, kind: "promise", text: [res.summary, extra].filter(Boolean).join(" ").slice(0, 300), status: "new" });
        } else continue;
        useStore.getState().updateContact(cur.id, { signals });
      }
    } catch {
      // AI unavailable this time: leave them on the server for the next sync.
    }
  }
  for (const p of pending) reading.delete(p.id);
  return [...ack].map(([contactId, ids]) => ({ contactId, ids }));
}
const reading = new Set<string>();

/**
 * Confirm a referral / intro: the referrer gets `referral` (dated from the email), each person they referred becomes a
 * contact (or is linked if you have them) with `referredBy`, and if you already wrote to them, that's their first email.
 */
export async function confirmSignal(contactId: string, signalId: string, picked?: string[]) {
  // Lazy: actions.ts pulls in the spreadsheet code, which pages shouldn't load up front.
  const { addManualContact } = await import("./actions");
  const st = useStore.getState();
  const c = st.contacts.find((x) => x.id === contactId);
  const sig = c?.signals?.find((x) => x.id === signalId);
  if (!c || !sig) return;
  const at = sig.at;
  const people = (sig.people ?? []).filter((p) => !picked || picked.includes(p.email ?? p.name));
  const to: NonNullable<Contact["referral"]>["to"] = [...(c.referral?.to ?? [])];
  for (const p of people) {
    const name = p.name || (p.email ? nameFromEmail(p.email) : "");
    if (!name) continue;
    let target = st.contacts.find((x) => (p.email && (x.email.toLowerCase() === p.email.toLowerCase() || x.aliases?.includes(p.email.toLowerCase()))) || (x.name.toLowerCase() === name.toLowerCase() && canonBank(x.bank) === canonBank(c.bank)));
    if (!target) {
      target = addManualContact(
        { name, bank: c.bank, linkedin: "", email: p.email ?? "", position: p.role ?? "", location: c.location, team: c.team ?? "", region: c.region, comment: `Referred by ${c.name} ${new Date(at).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}` },
        true,
      );
    }
    const patch: Partial<Contact> = { referredBy: { contactId: c.id, name: c.name, at } };
    if (sig.youWroteAt && !target.sentAt) Object.assign(patch, { sentAt: sig.youWroteAt, lastTouchAt: sig.youWroteAt, lastEmailedAt: latestIso(target.lastEmailedAt, sig.youWroteAt), status: (RANK[target.status] ?? 0) < 2 ? "sent" : target.status });
    useStore.getState().updateContact(target.id, patch, { at, type: "note", note: `Referred by ${c.name}` });
    if (!to.some((t) => t.contactId === target!.id)) to.push({ name: target.name, email: target.email || undefined, contactId: target.id });
  }
  const fresh = useStore.getState().contacts.find((x) => x.id === contactId)!;
  const signals = (fresh.signals ?? []).map((x) => (x.id === signalId ? { ...x, status: "accepted" as const } : x));
  const isReferral = sig.kind !== "promise";
  useStore.getState().updateContact(
    contactId,
    {
      signals,
      ...(isReferral ? { referral: { at: fresh.referral?.source === "gmail" || fresh.referral?.source === "manual" ? fresh.referral.at : at, note: sig.text, to, source: "gmail" as const } } : {}),
    },
    { at, type: "note", note: isReferral ? `Referral confirmed: ${people.map((p) => p.name || p.email).join(", ") || sig.text}` : `Noted: ${sig.text}` },
  );
}

export function dismissSignal(contactId: string, signalId: string) {
  const c = useStore.getState().contacts.find((x) => x.id === contactId);
  if (!c) return;
  useStore.getState().updateContact(contactId, { signals: (c.signals ?? []).map((x) => (x.id === signalId ? { ...x, status: "dismissed" as const } : x)) });
}

export { openSignals, referralRows, type ReferralRow } from "./referralRows";
