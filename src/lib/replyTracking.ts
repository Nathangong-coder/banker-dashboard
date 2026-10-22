/**
 * Reply / thank-you / referral tracking from Gmail message headers (owner, 2026-10-22). Pure: the server's hourly run
 * (lib/server/gmailTrack.ts) fetches the messages, this decides what they mean. No keywords: every email ends with
 * "Thanks, Nathan." in the signature, so "thanks" in the text means nothing. What counts:
 * - **You emailed them** = a SENT message with them in To, Cc or Bcc (the thank-you is the first one after the call).
 * - **They wrote** = a message from one of their addresses. Addresses are learned: someone at the same firm domain
 *   replying in a thread you have with them, with their first or last name, is them (Isaiah wrote from
 *   iestrella@ and replied from IDeLaCruz@).
 * - **An intro** = their message adds someone new to the To/Cc (Benjamin cc'd Kevin Zhu: "feel free to reach out to
 *   Kevin cc'd here"). Referrals with nobody cc'd ("I passed your resume on") come from the AI read of the text
 *   (api/replies/classify); both are only suggestions until you confirm them.
 */

export interface Addr {
  name: string;
  email: string;
}

export interface MailMsg {
  id: string;
  threadId: string;
  /** Epoch ms (Gmail internalDate). */
  at: number;
  labels: string[];
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  snippet: string;
}

export interface TrackPerson {
  contactId: string;
  name: string;
  /** Their address on file first, then addresses learned before. */
  emails: string[];
}

export interface Intro {
  messageId: string;
  threadId: string;
  at: string;
  /** Who made the intro (their address). */
  by: string;
  people: Addr[];
  /** Your first email to one of the new people after the intro (the outreach to them already happened). */
  youWroteAt?: string;
}

export interface TrackResult {
  contactId: string;
  firstSentAt?: string;
  lastEmailedAt?: string;
  /** Their first real reply after your first email. */
  repliedAt?: string;
  lastHeardAt?: string;
  sentCount: number;
  /** Emails you sent before their first reply (1 = first email only). */
  outreachCount: number;
  /** Addresses learned for them (not including the ones already known). */
  aliases: string[];
  threadIds: string[];
  intros: Intro[];
  /** Their real messages (newest last), ids only; the text is fetched separately for the AI read. */
  replies: { id: string; threadId: string; at: string }[];
  /** An auto-reply saying they've left the firm. */
  leftNote?: string;
}

const AUTO_REPLY = /^(automatic reply|auto[- ]?reply|autoreply|out of (?:the )?office|ooo\b)/i;
const LEFT = /\b(no longer (?:with|at|employed|working)|has left|have left|left the (?:firm|company|bank)|last day (?:at|with))\b/i;
/** Machine senders / list addresses never count as a person introduced to you. */
const ROLE = /^(no-?reply|do-?not-?reply|notifications?|calendar|mailer-daemon|postmaster|bounce|info|recruiting|careers|hr|support)\b/i;

const lc = (s: string) => s.trim().toLowerCase();
const domain = (e: string) => lc(e).split("@")[1] ?? "";
const iso = (ms: number) => new Date(ms).toISOString();

/** "Shen, Kevin" <Kevin.Shen@psc.com>, b@x.com → [{name, email}] (lowercased emails). */
export function parseAddrs(header: string | undefined): Addr[] {
  if (!header) return [];
  const out: Addr[] = [];
  // Split on commas outside quotes and angle brackets.
  let cur = "";
  let q = false;
  let angle = false;
  for (const ch of header) {
    if (ch === '"') q = !q;
    if (ch === "<") angle = true;
    if (ch === ">") angle = false;
    if (ch === "," && !q && !angle) {
      out.push(...one(cur));
      cur = "";
    } else cur += ch;
  }
  out.push(...one(cur));
  return out;
  function one(s: string): Addr[] {
    const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    const email = lc(m ? m[2] : s);
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) return [];
    return [{ name: (m?.[1] ?? "").trim().replace(/^'|'$/g, ""), email }];
  }
}

/** Name words to recognise them by: "Isaiah De La Cruz" → ["isaiah", "cruz", "delacruz"]. */
function nameKeys(name: string) {
  const words = lc(name)
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  const joined = lc(name).replace(/[^a-z]/g, "");
  const keys = new Set(words);
  // Multi-word last names ("De La Cruz") also appear joined in addresses (IDeLaCruz@).
  const parts = lc(name).split(/\s+/);
  if (parts.length > 2) keys.add(parts.slice(1).join("").replace(/[^a-z]/g, ""));
  if (joined.length >= 4) keys.add(joined);
  return [...keys];
}

function looksLikeThem(a: Addr, person: TrackPerson) {
  const keys = nameKeys(person.name);
  const words = new Set(lc(a.name).split(/[^a-z]+/).filter(Boolean));
  const local = lc(a.email.split("@")[0]).replace(/[^a-z]/g, "");
  return keys.some((k) => words.has(k) || (k.length >= 4 && local.includes(k)));
}

/**
 * What Gmail says about one person, from every message in the threads that involve them (both directions).
 * `me` = your own addresses (the Gmail account's; addresses SENT messages came from are added automatically).
 */
export function analyzePerson(person: TrackPerson, msgs: MailMsg[], me: string[]): TrackResult {
  const sorted = [...msgs].sort((a, b) => a.at - b.at);
  const mine = new Set(me.map(lc));
  for (const m of sorted) if (m.labels.includes("SENT")) mine.add(lc(m.from.email));
  const known = new Set(person.emails.map(lc).filter(Boolean));
  const domains = new Set([...known].map(domain));
  const involves = (m: MailMsg) => [m.from, ...m.to, ...m.cc, ...m.bcc].some((a) => known.has(a.email));

  // Learn addresses: someone at their firm's domain, with their name, writing in a thread that involves them.
  const threadsWithThem = new Set(sorted.filter(involves).map((m) => m.threadId));
  const aliases: string[] = [];
  for (const m of sorted) {
    const f = m.from;
    if (!threadsWithThem.has(m.threadId) || mine.has(f.email) || known.has(f.email) || !domains.has(domain(f.email))) continue;
    // Or, with no name to go on: a new address at their firm answering your 1:1 thread with them, to you only. Someone
    // who was already on the thread (a colleague they cc'd, then you wrote to) doesn't count.
    const earlier = sorted.filter((x) => x.threadId === m.threadId && x.at < m.at);
    const wasOnThread = earlier.some((x) => [x.from, ...x.to, ...x.cc, ...x.bcc].some((a) => a.email === f.email));
    const lastBefore = earlier[earlier.length - 1];
    const answersYou =
      !wasOnThread &&
      !!lastBefore &&
      mine.has(lastBefore.from.email) &&
      [...lastBefore.to, ...lastBefore.cc].every((a) => known.has(a.email)) &&
      // To you alone: someone writing for them (an assistant) cc's them.
      [...m.to, ...m.cc].every((a) => mine.has(a.email));
    if (looksLikeThem(f, person) || answersYou) {
      known.add(f.email);
      aliases.push(f.email);
    }
  }

  const sent = sorted.filter((m) => m.labels.includes("SENT") && [...m.to, ...m.cc, ...m.bcc].some((a) => known.has(a.email)));
  const fromThem = sorted.filter((m) => known.has(m.from.email) && !m.labels.includes("SENT"));
  const auto = (m: MailMsg) => AUTO_REPLY.test(m.subject);
  const real = fromThem.filter((m) => !auto(m));
  const left = fromThem.find((m) => auto(m) && LEFT.test(m.snippet));
  const first = sent[0];
  const firstReply = first ? real.find((m) => m.at > first.at) : real[0];
  const outreach = firstReply ? sent.filter((m) => m.at < firstReply.at) : sent;

  // Intros: their message brings in someone who wasn't on the thread before.
  const intros: Intro[] = [];
  for (const m of real) {
    const before = new Set<string>();
    for (const x of sorted) {
      if (x.threadId !== m.threadId || x.at >= m.at) continue;
      for (const a of [x.from, ...x.to, ...x.cc, ...x.bcc]) before.add(a.email);
    }
    const people = [...m.to, ...m.cc].filter(
      (a, i, all) => !mine.has(a.email) && !known.has(a.email) && !before.has(a.email) && !ROLE.test(a.email) && all.findIndex((b) => b.email === a.email) === i,
    );
    if (!people.length) continue;
    const wrote = sorted.find((x) => x.labels.includes("SENT") && x.at > m.at && [...x.to, ...x.cc].some((a) => people.some((p) => p.email === a.email)));
    intros.push({ messageId: m.id, threadId: m.threadId, at: iso(m.at), by: m.from.email, people, youWroteAt: wrote ? iso(wrote.at) : undefined });
  }

  return {
    contactId: person.contactId,
    firstSentAt: first ? iso(first.at) : undefined,
    lastEmailedAt: sent.length ? iso(sent[sent.length - 1].at) : undefined,
    repliedAt: firstReply ? iso(firstReply.at) : undefined,
    lastHeardAt: real.length ? iso(real[real.length - 1].at) : undefined,
    sentCount: sent.length,
    outreachCount: outreach.length,
    aliases,
    threadIds: [...new Set([...sent, ...fromThem].map((m) => m.threadId))],
    intros,
    replies: real.slice(-10).map((m) => ({ id: m.id, threadId: m.threadId, at: iso(m.at) })),
    leftNote: left ? left.snippet.slice(0, 160) : undefined,
  };
}

/** The Gmail search for everything to or from these addresses since `since` (one query, both directions). */
export function personQuery(emails: string[], since?: string) {
  const parts = emails.slice(0, 4).flatMap((e) => [`from:${e}`, `to:${e}`, `cc:${e}`, `bcc:${e}`]);
  const after = since ? ` after:${since.slice(0, 10).replace(/-/g, "/")}` : "";
  return `{${parts.join(" ")}}${after}`;
}

/** Their new text in a reply: quoted history and the "From: … Sent: …" block cut off. */
export function stripQuotedText(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*>/.test(l)) break;
    if (/^On .{5,200}wrote:\s*$/i.test(l) || (/^On .{5,200}$/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? ""))) break;
    if (/^\s*(From|De|Von):\s.+/i.test(l) && lines.slice(i, i + 4).some((x) => /^\s*(Sent|Date|To|Subject):/i.test(x))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l)) break;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Was the call thanked? Any email you sent them after it (to, cc or bcc; any subject). */
export const thankedAfter = (lastEmailedAt: string | undefined, callAt: string) => !!lastEmailedAt && lastEmailedAt > callAt;
