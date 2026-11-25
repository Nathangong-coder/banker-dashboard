import type { BankMeta, Contact, HistoryEvent, Settings } from "./types";
import { dayLabel, lastEmailOf, moveOnDate, queuedAt } from "./followups";
import { personName, splitName } from "./util";
import { officePatch } from "./officeEvidence";

/**
 * Upkeep the dashboard does by itself (owner, 2026-10-27), run on load and after changes (Shell#useContactUpkeep):
 * - names read First Last ("Zhu, Kevin" → "Kevin Zhu");
 * - the office (region) follows the best evidence: lib/officeEvidence.ts;
 * - someone whose last follow-up went unanswered through the end of that work week is moved on (status ignored,
 *   outcome no_reply). It's never a to-do: the desk frees up and the bank shows it needs new people. A reply later
 *   brings them back (Gmail sync / tracking).
 */
export function upkeepPatches(contacts: Contact[], s: Settings["followUp"], banks: Record<string, BankMeta> = {}, now = new Date(), myPhone?: string) {
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
    // The office follows the best evidence (Location column > their signature > phone > LinkedIn), unless you set it.
    const office = officePatch(c, myPhone);
    if (office) {
      Object.assign(patch, office);
      if (office.region !== c.region) event = { at: now.toISOString(), type: "note", note: `Office ${c.region} → ${office.region} (from ${office.regionSource})` };
    }
    // A Gmail Schedule-send email whose time passed went out: count it now, not at the next Gmail re-read.
    const went = sentFromSchedule(c, now);
    if (went) {
      Object.assign(patch, went);
      if (went.lastEmailedAt) event = { at: now.toISOString(), type: "note", note: `Scheduled email went out ${dayLabel(new Date(went.lastEmailedAt))}` };
    }
    const due = shouldMoveOn({ ...c, ...patch }, s, banks[`${c.bank}|${c.region}`], now);
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
/**
 * Gmail's Schedule send went out (owner, 2026-11-24: Justin Lutsch's follow-up #2 went at 9:30 AM and still showed as
 * due; the conversation of someone who hasn't replied is re-read only every 2 days). Once `scheduledAt` has passed:
 * a first email → sent that day; a follow-up → one more follow-up; anyone else (a check-in) → only the dates. The
 * new `lastEmailedAt` also makes the next sync re-read their conversation (mailLedger.ts#ledgerDue), which corrects
 * it if the email was cancelled.
 */
export function sentFromSchedule(c: Contact, now = new Date()): Partial<Contact> | null {
  if (!c.scheduledAt || Date.parse(c.scheduledAt) > now.getTime()) return null;
  const at = c.scheduledAt;
  const last = [c.lastEmailedAt, c.lastTouchAt, c.sentAt].filter((x): x is string => !!x).sort().pop();
  if (last && last >= at) return { scheduledAt: undefined };
  if ((c.status === "new" || c.status === "drafted") && !c.sentAt) return { scheduledAt: undefined, status: "sent", sentAt: at, lastTouchAt: at, lastEmailedAt: at };
  if (c.status === "sent" || c.status === "followed_up") return { scheduledAt: undefined, status: "followed_up", followUps: c.followUps + 1, lastTouchAt: at, lastEmailedAt: at };
  return { scheduledAt: undefined, lastEmailedAt: at };
}

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
