import type { Contact } from "./types";
import { queuedFor } from "./thinkAbout";

/**
 * Ongoing threads (owner, 2026-11-23: "a 3rd tab… 'ongoing outreach' so i don't forget to respond/follow-up on
 * important threads (things that are already on schedule send so i don't have to worry about random crap)").
 * Every two-way conversation from the last 45 days plus anything queued to go out, in three groups:
 *   - your move: they wrote last and you haven't answered (or marked it handled / resolved)
 *   - scheduled: an email to them is queued (Gmail Schedule send or Coverage's queue): handled, nothing to do
 *   - waiting on them: you wrote last
 * One-way cold emails with nothing queued are Cold outreach's job and stay off this page.
 */
export type OngoingGroup = "yours" | "scheduled" | "waiting";
export interface OngoingRow {
  c: Contact;
  group: OngoingGroup;
  /** The newest message either way, or the queued one. */
  at: string;
  who: "them" | "you";
  subject: string;
  snippet: string;
  threadId?: string;
  messages: number;
  queuedAt?: string;
}

const DAY = 86_400_000;
export const ONGOING_DAYS = 45;

export function ongoingRows(contacts: Contact[], now = Date.now()): OngoingRow[] {
  const out: OngoingRow[] = [];
  for (const c of contacts) {
    if (c.mail?.otherPerson) continue;
    const msgs = c.mail?.messages ?? [];
    const last = msgs[msgs.length - 1];
    const twoWay = msgs.some((m) => m.dir === "in") || !!c.repliedAt;
    const queued = queuedFor(c, now);
    const recent = last && now - Date.parse(last.at) < ONGOING_DAYS * DAY;
    if (!queued && !(twoWay && recent)) continue;
    // Bounced / left / declined: nothing ongoing unless they write again.
    if (c.outcome && c.outcome.kind !== "no_reply" && !queued) continue;
    const settled = [c.handledAt, c.resolved?.at].filter((x): x is string => !!x).sort().pop();
    const group: OngoingGroup = queued ? "scheduled" : last?.dir === "in" && (!settled || settled < last.at) ? "yours" : "waiting";
    out.push({
      c,
      group,
      at: queued && group === "scheduled" ? queued : last?.at ?? c.repliedAt ?? "",
      who: last?.dir === "in" ? "them" : "you",
      subject: last?.subject ?? "",
      snippet: last?.snippet ?? "",
      threadId: last?.threadId,
      messages: msgs.length,
      queuedAt: queued,
    });
  }
  const order: Record<OngoingGroup, number> = { yours: 0, scheduled: 1, waiting: 2 };
  // Your move: oldest first (longest waiting on you). Scheduled: soonest first. Waiting: newest first.
  return out.sort((a, b) => order[a.group] - order[b.group] || (a.group === "waiting" ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
}

/** Gmail's scheduled emails whose recipients aren't anyone in the tracker. */
export function unmatchedScheduled(items: { at: string; to: string[]; subject: string; labels: string[]; threadId: string }[], contacts: Contact[], now = Date.now()) {
  const known = new Set(contacts.flatMap((c) => [c.email, ...(c.aliases ?? [])].filter(Boolean).map((e) => e.trim().toLowerCase())));
  return items.filter((it) => Date.parse(it.at) > now && !it.to.some((e) => known.has(e)));
}
