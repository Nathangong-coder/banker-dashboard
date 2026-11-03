import { domainOf, personalDomain } from "./offSheet";

/**
 * Incremental Gmail reads (owner, 2026-11-02): instead of one search per tracked person every hour, the server asks
 * Gmail what changed since a saved history id (`users.history.list`, one call) and re-checks only the people those
 * messages involve. Pure so `npm run check:tracking` covers it.
 */

export interface ChangedMsg {
  id: string;
  threadId: string;
  /** Every address in From / To / Cc / Bcc, lower case. */
  addrs: string[];
}

export interface WatchedPerson {
  contactId: string;
  emails: string[];
  /** Threads already known to involve them (TrackResult.threadIds). */
  threadIds?: string[];
}

/**
 * The people a batch of new messages could change: an address of theirs on it, a thread of theirs, or (for a work
 * domain) anyone at the same domain, since replies from a new alias (iestrella@ → IDeLaCruz@) or intros come from there.
 * Personal / school domains and your own never count as a firm.
 */
export function touchedPeople(people: WatchedPerson[], msgs: ChangedMsg[], me: string[] = []): Set<string> {
  const byAddr = new Map<string, string[]>();
  const byDomain = new Map<string, string[]>();
  const byThread = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, id: string) => m.set(k, [...(m.get(k) ?? []), id]);
  for (const p of people) {
    for (const e of p.emails) {
      const email = e.trim().toLowerCase();
      if (!email) continue;
      add(byAddr, email, p.contactId);
      const d = domainOf(email);
      if (!personalDomain(d, me)) add(byDomain, d, p.contactId);
    }
    for (const t of p.threadIds ?? []) add(byThread, t, p.contactId);
  }
  const out = new Set<string>();
  for (const m of msgs) {
    for (const id of byThread.get(m.threadId) ?? []) out.add(id);
    for (const a of m.addrs) {
      for (const id of byAddr.get(a) ?? []) out.add(id);
      for (const id of byDomain.get(domainOf(a)) ?? []) out.add(id);
    }
  }
  return out;
}
