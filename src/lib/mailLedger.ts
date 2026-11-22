import { AUTO_REPLY, CALENDAR, analyzePerson, type MailMsg, type TrackPerson } from "./replyTracking";
import { addressIsPerson } from "./nameMatch";

/**
 * One person's email conversation, both directions, every thread (owner, 2026-11-22). Built on the server from Gmail
 * (api/server/conversation), kept on the contact (`contact.mail`), and the ONE source Things to think about and the
 * 9 PM text read "who wrote last" from. Before this, the dates came from several partial reads: a thank-you sent as a
 * new email (not in the chain) didn't count (Ryan Kowlowski, Joe Romagnoli), Colin Bryant's reply and your nudge were
 * missing, and calendar responses / group emails counted as "they wrote back". Pure.
 */

export interface LedgerMsg {
  id: string;
  threadId: string;
  /** ISO. */
  at: string;
  /** "in" = they wrote to you, "out" = you wrote to them. */
  dir: "in" | "out";
  subject: string;
  snippet: string;
}

export interface MailLedger {
  checkedAt: string;
  /** Newest last, at most 12. */
  messages: LedgerMsg[];
  /** Their newest message's own text (quoted history cut). */
  lastIn?: { id: string; at: string; text: string };
  /** Your newest message to them. */
  lastOut?: { id: string; at: string; text: string };
  /**
   * The address on file belongs to someone else, by the names Gmail shows on it ("Jess Zhang" had Jacob Zhang's
   * address): those names. The person is kept off the lists until the address is fixed.
   */
  otherPerson?: string;
}

export interface LedgerRaw {
  /** Real messages, oldest first. */
  messages: LedgerMsg[];
  aliases: string[];
  /** Display names Gmail showed on the address on file. */
  namesOnFile: string[];
  lastInId?: string;
  lastOutId?: string;
}

const lc = (s: string) => s.trim().toLowerCase();

export function buildLedger(person: TrackPerson, msgs: MailMsg[], me: string[]): LedgerRaw {
  const sorted = [...msgs].sort((a, b) => a.at - b.at);
  const r = analyzePerson(person, sorted, me);
  const known = new Set([...person.emails, ...r.aliases].map(lc));
  const mine = new Set(me.map(lc));
  for (const m of sorted) if (m.labels.includes("SENT")) mine.add(lc(m.from.email));
  const out = sorted.filter((m) => m.labels.includes("SENT") && [...m.to, ...m.cc, ...m.bcc].some((a) => known.has(a.email)));
  const myThreads = new Set(out.map((m) => m.threadId));
  const inn = sorted.filter(
    (m) =>
      known.has(m.from.email) &&
      !m.labels.includes("SENT") &&
      !AUTO_REPLY.test(m.subject) &&
      !CALENDAR.test(m.subject) &&
      ([...m.to, ...m.cc].some((a) => mine.has(a.email)) || myThreads.has(m.threadId)),
  );
  const onFile = lc(person.emails[0] ?? "");
  const namesOnFile = [
    ...new Set(
      sorted
        .flatMap((m) => [m.from, ...m.to, ...m.cc])
        .filter((a) => a.email === onFile && a.name.trim())
        .map((a) => a.name.trim()),
    ),
  ];
  const messages: LedgerMsg[] = [...out.map((m) => ({ m, dir: "out" as const })), ...inn.map((m) => ({ m, dir: "in" as const }))]
    .sort((a, b) => a.m.at - b.m.at)
    .map(({ m, dir }) => ({ id: m.id, threadId: m.threadId, at: new Date(m.at).toISOString(), dir, subject: m.subject.slice(0, 160), snippet: m.snippet.slice(0, 220) }));
  return { messages, aliases: r.aliases, namesOnFile, lastInId: inn[inn.length - 1]?.id, lastOutId: out[out.length - 1]?.id };
}

/**
 * The names Gmail shows on their address are someone else's (none of them could be First Last). Undefined = fine or
 * no names to go on.
 */
export function otherPersonOnAddress(name: string, email: string, names: string[]): string | undefined {
  const [first, ...rest] = name.trim().split(/\s+/);
  const real = names.filter((n) => n.split(/\s+/).length >= 2 && !/@/.test(n));
  if (!real.length || !rest.length) return undefined;
  if (real.some((n) => addressIsPerson({ name: n, email }, first, rest.join(" ")))) return undefined;
  // A display name "Last, First" or with a title is still them if the mailbox says so.
  if (addressIsPerson({ name: "", email }, first, rest.join(" "))) return undefined;
  return real[0];
}

const DAY = 86_400_000;
const latest = (...xs: (string | undefined)[]) => xs.filter((x): x is string => !!x).sort().pop();

/** Who wrote last, from the ledger, with anything newer the contact's own dates know (a reply since the read). */
export function lastExchange(c: { mail?: MailLedger; lastHeardAt?: string; lastEmailedAt?: string; lastTouchAt?: string; sentAt?: string; handledAt?: string }) {
  const L = c.mail;
  const ins = L?.messages.filter((m) => m.dir === "in") ?? [];
  const outs = L?.messages.filter((m) => m.dir === "out") ?? [];
  // The ledger wins for their side (it drops calendar responses / group emails); a reply after the read still counts.
  const heard = L ? latest(ins[ins.length - 1]?.at, c.lastHeardAt && c.lastHeardAt > L.checkedAt ? c.lastHeardAt : undefined) : c.lastHeardAt;
  // Your side: anything you sent by any route (sheet dates, Schedule send, done by hand) counts.
  const you = latest(outs[outs.length - 1]?.at, c.lastEmailedAt, c.lastTouchAt ?? c.sentAt, c.handledAt);
  return { heard, you, inCount: ins.length, outCount: outs.length };
}

/** Is a ledger read due? Engaged people every 6 hours, others every 2 days; "force" = now. */
export function ledgerDue(c: { mail?: MailLedger; lastHeardAt?: string; lastEmailedAt?: string }, engaged: boolean, now = Date.now()) {
  if (!c.mail) return true;
  const at = Date.parse(c.mail.checkedAt);
  // Something new since the read (the hourly tracking saw a reply or an email): read again.
  if ((c.lastHeardAt && c.lastHeardAt > c.mail.checkedAt) || (c.lastEmailedAt && c.lastEmailedAt > c.mail.checkedAt)) return now - at > 10 * 60_000;
  return now - at > (engaged ? 6 * 3600_000 : 2 * DAY);
}
