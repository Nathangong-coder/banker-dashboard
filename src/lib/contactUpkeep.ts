import type { BankMeta, Contact, HistoryEvent, Settings } from "./types";
import { dayLabel, lastEmailOf, moveOnDate, queuedAt } from "./followups";
import { personName, splitName } from "./util";

/**
 * Upkeep the dashboard does by itself (owner, 2026-10-27), run on load and after changes (Shell#useContactUpkeep):
 * - names read First Last ("Zhu, Kevin" → "Kevin Zhu");
 * - someone whose last follow-up went unanswered through the end of that work week is moved on (status ignored,
 *   outcome no_reply). It's never a to-do: the desk frees up and the bank shows it needs new people. A reply later
 *   brings them back (Gmail sync / tracking).
 */
export function upkeepPatches(contacts: Contact[], s: Settings["followUp"], banks: Record<string, BankMeta> = {}, now = new Date()) {
  const out: { id: string; patch: Partial<Contact>; event?: HistoryEvent }[] = [];
  for (const c of contacts) {
    const patch: Partial<Contact> = {};
    let event: HistoryEvent | undefined;
    const name = personName(c.name);
    if (name && name !== c.name) {
      const { first, last } = splitName(name);
      Object.assign(patch, { name, firstName: first, lastName: last });
      // The title that was stuck on the name ("— Analyst, IBD") becomes the position when there is none.
      const rest = c.name.split(/ [—–] /).slice(1).join(" ").replace(/[—–\s]+$/, "").trim();
      if (rest && !c.position) patch.position = rest;
    }
    const due = shouldMoveOn(c, s, banks[`${c.bank}|${c.region}`], now);
    if (due) {
      const last = lastEmailOf(c, now)!;
      const note = `No reply after follow-up #${c.followUps} (last email ${dayLabel(last)}): moved on ${dayLabel(due)}`;
      Object.assign(patch, { status: "ignored", outcome: { kind: "no_reply", at: due.toISOString(), note, confirmed: true } });
      event = { at: now.toISOString(), type: "status", note: `Moved on automatically. ${note}` };
    }
    if (Object.keys(patch).length) out.push({ id: c.id, patch, event });
  }
  return out;
}

/** The move-on date when it has passed and nothing else is going on (a reply, a call, a referral, a queued email). */
export function shouldMoveOn(c: Contact, s: Settings["followUp"], bank?: BankMeta, now = new Date()) {
  if (c.status !== "sent" && c.status !== "followed_up") return undefined;
  if (c.repliedAt || c.call || c.referral || c.outcome) return undefined;
  if (bank && (bank.status === "paused" || bank.status === "moved_on")) return undefined;
  const q = queuedAt(c);
  if (q && new Date(q) > now) return undefined;
  const due = moveOnDate(c, s, now);
  return due && due <= now ? due : undefined;
}

/** Moved on by the rule above (not bounced / left / a no). */
export const autoMovedOn = (c: Pick<Contact, "status" | "outcome">) => c.status === "ignored" && c.outcome?.kind === "no_reply";
