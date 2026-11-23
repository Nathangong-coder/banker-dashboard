import type { Contact, GmailLabelSettings } from "./types";
import { canonBank } from "./banks";
import { teamOf } from "./locationTeam";

/**
 * Gmail labels that mirror the tracker (owner, 2026-11-23: "improve email labelling… for users that are more manual and
 * want to see changes"). It follows the owner's own scheme, read from their Gmail: `IB/SF`, `IB/SF/Bank/Harris
 * Williams`, `IB/NY/Group/Tech`, `Outreach/Sent - waiting`, `Outreach/Replied`. Coverage only ever REMOVES the four
 * state labels below (the state moved on); office / bank / group labels are only added, and labels you made yourself
 * ("DO NOT SEND - MOVED ON", "HOLD - desk full", "Good") are never touched. Every change is shown before it's applied
 * and kept in a log you can undo.
 */
export const STATE = {
  waiting: "Outreach/Sent - waiting",
  replied: "Outreach/Replied",
  movedOn: "Outreach/Moved on",
  bounced: "Outreach/Bounced",
} as const;
const STATE_SET = new Set<string>(Object.values(STATE));

export const DEFAULT_LABELS: GmailLabelSettings = { state: true, office: true, auto: false };

export function stateLabel(c: Contact): string | null {
  if (c.outcome?.kind === "bounced" || c.outcome?.kind === "left") return STATE.bounced;
  if (c.repliedAt || ["replied", "call_scheduled", "done"].includes(c.status)) return STATE.replied;
  if (c.status === "ignored") return STATE.movedOn;
  if (c.status === "sent" || c.status === "followed_up") return STATE.waiting;
  return null;
}

/** The bank's part of the label: a bank label you already have for it (by canonBank) wins over the tracker's name. */
export function bankSegment(bank: string, existing: string[]) {
  const key = canonBank(bank);
  // "Houlihan" is your label for Houlihan Lokey: the same key, or one key starting the other (4+ letters).
  const same = (k: string) => k === key || (Math.min(k.length, key.length) >= 4 && (key.startsWith(k) || k.startsWith(key)));
  const mine = existing.map((n) => n.match(/^IB\/[^/]+\/Bank\/(.+)$/)?.[1]).find((b) => b && same(canonBank(b)));
  return (mine ?? bank).replace(/\//g, "-").trim();
}

export function wantedLabels(c: Contact, rules: GmailLabelSettings, existing: string[]): string[] {
  const out: string[] = [];
  if (rules.state) {
    const s = stateLabel(c);
    if (s) out.push(s);
  }
  if (rules.office && c.region !== "Other") {
    out.push(`IB/${c.region}`);
    if (c.bank) out.push(`IB/${c.region}/Bank/${bankSegment(c.bank, existing)}`);
    const team = teamOf(c);
    if (team) out.push(`IB/${c.region}/Group/${team.replace(/\//g, "-")}`);
  }
  return out;
}

/** Threads to label: ones you wrote in (cold outreach and replies), from the conversation Coverage keeps per person. */
export const threadsOf = (c: Contact) => [...new Set((c.mail?.messages ?? []).filter((m) => m.dir === "out").map((m) => m.threadId))];

export type LabelChange = { threadId: string; contactId: string; name: string; subject: string; add: string[]; remove: string[] };

/** What would change, given each thread's current label NAMES. */
export function planLabels(contacts: Contact[], rules: GmailLabelSettings, current: Map<string, string[]>, existing: string[]): LabelChange[] {
  const out: LabelChange[] = [];
  for (const c of contacts) {
    if (c.mail?.otherPerson) continue;
    const want = wantedLabels(c, rules, existing);
    for (const t of threadsOf(c)) {
      const have = current.get(t);
      if (!have) continue;
      const add = want.filter((l) => !have.includes(l));
      const remove = rules.state ? have.filter((l) => STATE_SET.has(l) && !want.includes(l)) : [];
      if (add.length || remove.length) {
        const subject = c.mail!.messages.find((m) => m.threadId === t)?.subject ?? "";
        out.push({ threadId: t, contactId: c.id, name: c.name, subject, add, remove });
      }
    }
  }
  return out;
}
