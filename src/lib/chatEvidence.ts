import type { Contact } from "./types";
import { DAY } from "./util";

/**
 * How many chats you've had with someone (owner, 2026-11-21: two chats at Bank of America, with Eli Sanchez and
 * Charles Kirby, showed as one; both were calendar guests and both got a thank-you in one email chain). Pure.
 *
 * Sources: chats logged on /log or the sheet (`chats`), a call that already happened (`call`), past calendar events with
 * them as a guest and thank-you emails you sent them (`chatEvidence`). One chat per day; a thank-you within 3 days after
 * a call / logged chat / calendar event is that chat's thank-you, not another chat.
 */

const dayOf = (iso: string) => iso.slice(0, 10);

export function chatDays(c: Pick<Contact, "chats" | "call" | "chatEvidence">, now = Date.now()): string[] {
  const strong = new Set<string>();
  for (const x of c.chats ?? []) if (Date.parse(x.at) <= now) strong.add(dayOf(x.at));
  if (c.call && Date.parse(c.call.at) <= now) strong.add(dayOf(c.call.at));
  for (const e of c.chatEvidence ?? []) if (e.source === "calendar" && Date.parse(e.at) <= now) strong.add(dayOf(e.at));
  const days = [...strong];
  const thanks = (c.chatEvidence ?? []).filter((e) => e.source === "thanks" && Date.parse(e.at) <= now).sort((a, b) => a.at.localeCompare(b.at));
  for (const t of thanks) {
    const at = Date.parse(t.at);
    const covered = days.some((d) => {
      const s = Date.parse(`${d}T00:00:00Z`);
      return at >= s - DAY && at - s <= 3 * DAY;
    });
    if (!covered) days.push(dayOf(t.at));
  }
  return days.sort();
}

export const chatCount = (c: Pick<Contact, "chats" | "call" | "chatEvidence">, now = Date.now()) => chatDays(c, now).length;

/** Add evidence without duplicates (by source + ref). Returns undefined when nothing new. */
export function withEvidence(c: Pick<Contact, "chatEvidence">, add: NonNullable<Contact["chatEvidence"]>): Contact["chatEvidence"] | undefined {
  const have = new Set((c.chatEvidence ?? []).map((e) => `${e.source}|${e.ref}`));
  const fresh = add.filter((e) => !have.has(`${e.source}|${e.ref}`));
  if (!fresh.length) return undefined;
  return [...(c.chatEvidence ?? []), ...fresh].sort((a, b) => a.at.localeCompare(b.at)).slice(-60);
}

/**
 * Gmail search for thank-you emails after a chat. Chat wording only: the cold-email close ("Thank you for your time")
 * and the signature ("Thanks,") never match. The caller still requires that they'd replied (or a calendar chat) before.
 */
export const THANKS_QUERY =
  '("time to chat" OR "time to speak" OR "time to talk" OR "time to meet" OR "for chatting" OR "for speaking with me" OR "great chatting" OR "great speaking" OR "great talking" OR "enjoyed speaking" OR "enjoyed chatting" OR "enjoyed our" OR "our conversation" OR "our call" OR "our chat")';

/**
 * Thank-you emails (sent mail matching THANKS_QUERY) → evidence per contact: the recipient is them (address or alias),
 * and they had written back or met you on the calendar before the email went out.
 */
export function thanksEvidence(
  sent: { id: string; email: string; at: number }[],
  contacts: Contact[],
): { id: string; add: NonNullable<Contact["chatEvidence"]> }[] {
  const byAddr = new Map<string, Contact>();
  for (const c of contacts) for (const e of [c.email, ...(c.aliases ?? [])]) if (e) byAddr.set(e.trim().toLowerCase(), c);
  const out = new Map<string, NonNullable<Contact["chatEvidence"]>>();
  for (const s of sent) {
    const c = byAddr.get(s.email.toLowerCase());
    if (!c) continue;
    const heard = [c.repliedAt, c.lastHeardAt].filter((x): x is string => !!x).map(Date.parse);
    const met = [c.call?.at, ...(c.chats ?? []).map((x) => x.at), ...(c.chatEvidence ?? []).filter((e) => e.source === "calendar").map((e) => e.at)].filter((x): x is string => !!x).map(Date.parse);
    // A chat needs them to have answered first (or a meeting on the calendar): a cold email never counts.
    if (![...heard, ...met].some((t) => t <= s.at)) continue;
    const list = out.get(c.id) ?? [];
    if (!list.some((e) => e.ref === s.id)) list.push({ at: new Date(s.at).toISOString(), source: "thanks", ref: s.id });
    out.set(c.id, list);
  }
  return [...out].map(([id, add]) => ({ id, add }));
}
