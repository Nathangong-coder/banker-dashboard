import { latestIso } from "./util";
import type { Contact, ReplySignal } from "./types";

/** Pure referral helpers (no store), shared by Follow-ups → Referrals and the 9 PM text (reminders.ts). */

const DAY = 86_400_000;

/** A referral in progress: referrer → person, and what to do next. */
export interface ReferralRow {
  referrer: Contact;
  person?: Contact;
  name: string;
  at: string;
  next: string;
  due?: string;
  /** When the referral's date is only a guess (a ticked box). */
  dateGuess: boolean;
}

/**
 * Every confirmed referral and its next step. The referred person: email them (if you haven't), follow up 7 days
 * after your email if they don't answer, then talk. The referrer: tell them how it went once you've talked.
 */
export function referralRows(contacts: Contact[], now = Date.now()): ReferralRow[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const rows: ReferralRow[] = [];
  const fmt = (d: number) => new Date(d).toISOString();
  for (const r of contacts.filter((c) => c.referral)) {
    const targets = r.referral!.to?.length ? r.referral!.to : [undefined];
    for (const t of targets) {
      const person = t?.contactId ? byId.get(t.contactId) : undefined;
      const row: ReferralRow = { referrer: r, person, name: person?.name ?? t?.name ?? "", at: r.referral!.at, next: "", dateGuess: r.referral!.source === "sheet" };
      if (!t) {
        row.next = "Who did they refer you to? Confirm it under suggestions, or note it on their row.";
      } else if (!person?.sentAt) {
        row.next = `Email ${t.name}`;
        row.due = r.referral!.at;
      } else {
        const talked = [person.call?.at, ...(person.chats ?? []).map((x) => x.at)].filter((d): d is string => !!d && Date.parse(d) <= now).sort().pop();
        const heard = person.repliedAt || person.lastHeardAt;
        if (talked) {
          const told = r.lastEmailedAt && r.lastEmailedAt > talked;
          row.next = told ? "Done: you talked and updated them" : `Tell ${r.firstName} how your chat with ${person.firstName} went`;
          if (!told) row.due = talked;
        } else if (heard) {
          row.next = `${person.firstName} replied: set up the call`;
          row.due = heard;
        } else {
          const last = latestIso(person.lastEmailedAt, person.lastTouchAt ?? person.sentAt)!;
          const due = Date.parse(last) + 7 * DAY;
          row.next = person.followUps >= 2 ? `No answer after 2 follow-ups: ask ${r.firstName} for a nudge?` : `Follow up with ${person.firstName} (no reply yet)`;
          row.due = fmt(due);
        }
      }
      rows.push(row);
    }
  }
  return rows.sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
}

/** Suggestions waiting for a yes / no. */
export const openSignals = (contacts: Contact[]) =>
  contacts.flatMap((c) => (c.signals ?? []).filter((s): s is ReplySignal => s.status === "new").map((s) => ({ c, s }))).sort((a, b) => b.s.at.localeCompare(a.s.at));
