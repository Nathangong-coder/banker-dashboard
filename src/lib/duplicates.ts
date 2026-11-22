import type { Contact, Status as ContactStatus } from "./types";
import { canonBank } from "./banks";
import { latestIso } from "./util";

/**
 * The same banker twice in the tracker (owner, 2026-11-21: "Rikita Shah" / "Ritika Shah", "Kaden Watters-Geremia" /
 * "Kaden Geramia", "Khoa Le" / "Khoa Leanh", "Jesse" / "Jesse Waller", "Joyce Chen" ×2: each pair one email address).
 * Each copy got its own follow-ups and half the Gmail history, so "who replied" was wrong for both. Pure.
 */

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const words = (s: string) => strip(s).split(/[^a-z]+/).filter(Boolean);

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Last names that are the same person's: equal, one inside the other ("le" / "leanh", hyphenated), or a 1–2 letter typo. */
function sameLast(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 2 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  return Math.min(a.length, b.length) >= 5 && lev(a, b) <= 2;
}

/**
 * Could two names be one person? Same first name (or one a 3+ letter start of the other: "Jon" / "Jonathan", one typo
 * allowed on 5+ letters), and the last names agree (any word of a hyphenated / double name) or one side has only a
 * first name. Callers only ask about people at the same firm.
 */
export function looseSameName(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return false;
  const [fx, fy] = [x[0], y[0]];
  const firstOk = fx === fy || (Math.min(fx.length, fy.length) >= 3 && (fx.startsWith(fy) || fy.startsWith(fx))) || (Math.min(fx.length, fy.length) >= 5 && lev(fx, fy) <= 1);
  if (!firstOk) return false;
  if (x.length === 1 || y.length === 1) return true;
  const lx = x.slice(1);
  const ly = y.slice(1);
  return lx.some((p) => ly.some((q) => sameLast(p, q))) || sameLast(lx.join(""), ly.join(""));
}

const addresses = (c: Contact) => [c.email, ...(c.aliases ?? [])].filter((e): e is string => !!e).map((e) => e.trim().toLowerCase());

export interface DuplicatePair {
  keep: Contact;
  drop: Contact;
  /** "same email" = certain; "same name at <bank>" = likely (one of them has no email yet). */
  reason: string;
  certain: boolean;
}

/** Which copy stays: the one with a spreadsheet row, then the one further along, then more filled in, then older. */
function keepFirst(a: Contact, b: Contact): [Contact, Contact] {
  const score = (c: Contact) =>
    (c.ref ? 1000 : 0) + (c.source === "sheet" ? 500 : 0) + STATUS_RANK[c.status] * 20 + [c.email, c.linkedin, c.position, c.team, c.location, c.comment].filter(Boolean).length * 3 + (c.chats?.length ?? 0) * 10;
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? [a, b] : [b, a];
  return (a.ref?.row ?? 1e9) <= (b.ref?.row ?? 1e9) ? [a, b] : [b, a];
}

export function findDuplicates(contacts: Contact[]): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  const used = new Set<string>();
  const byAddress = new Map<string, Contact[]>();
  for (const c of contacts) for (const e of addresses(c)) byAddress.set(e, [...(byAddress.get(e) ?? []), c]);
  for (const [email, list] of byAddress) {
    const uniq = [...new Map(list.map((c) => [c.id, c])).values()].filter((c) => !used.has(c.id));
    for (let i = 1; i < uniq.length; i++) {
      const [keep, drop] = keepFirst(uniq[0], uniq[i]);
      used.add(drop.id);
      out.push({ keep, drop, reason: `same email (${email})`, certain: true });
    }
  }
  // Likely: same firm, names that fit, and only one of them has an email (or both on the same domain).
  const byBank = new Map<string, Contact[]>();
  for (const c of contacts) if (c.bank && !used.has(c.id)) byBank.set(canonBank(c.bank), [...(byBank.get(canonBank(c.bank)) ?? []), c]);
  for (const list of byBank.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]];
        if (used.has(a.id) || used.has(b.id) || !looseSameName(a.name, b.name)) continue;
        const da = a.email?.split("@")[1]?.toLowerCase();
        const db = b.email?.split("@")[1]?.toLowerCase();
        if (da && db) continue; // two different addresses: two people (or let the email decide)
        // Only a first name on one side is a guess unless the other is the only one at the firm with that first name.
        const single = words(a.name).length === 1 || words(b.name).length === 1;
        if (single && list.filter((c) => words(c.name)[0] === words(a.name)[0] || words(c.name)[0] === words(b.name)[0]).length > 2) continue;
        const [keep, drop] = keepFirst(a, b);
        used.add(drop.id);
        out.push({ keep, drop, reason: `same name at ${a.bank}`, certain: false });
      }
  return out;
}

const STATUS_RANK: Record<ContactStatus, number> = { new: 0, drafted: 1, sent: 2, followed_up: 3, replied: 4, call_scheduled: 5, done: 6, ignored: -1 };

const earliestIso = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);
const uniqBy = <T,>(list: T[], key: (x: T) => string) => [...new Map(list.map((x) => [key(x), x])).values()];

/**
 * What `keep` becomes after taking in `drop`: every address, the earliest first email and latest of every other date,
 * the furthest status (a moved-on copy doesn't win over a live one), the larger follow-up count, every chat / history
 * line / signal, and anything only `drop` had (call, referral, draft, queued send, LinkedIn, title…).
 */
export function mergedPatch(keep: Contact, drop: Contact): Partial<Contact> {
  const mails = [...new Set([...addresses(keep), ...addresses(drop)])];
  const email = keep.email || drop.email;
  const status = keep.status === "ignored" && drop.status !== "ignored" ? drop.status : drop.status !== "ignored" && STATUS_RANK[drop.status] > STATUS_RANK[keep.status] ? drop.status : keep.status;
  const fill = <K extends keyof Contact>(k: K) => (keep[k] === undefined || keep[k] === "" || keep[k] === null ? drop[k] : keep[k]);
  return {
    email,
    aliases: mails.filter((m) => m !== email?.toLowerCase()).slice(0, 6),
    status,
    followUps: Math.max(keep.followUps ?? 0, drop.followUps ?? 0),
    sentAt: earliestIso(keep.sentAt, drop.sentAt),
    lastTouchAt: latestIso(keep.lastTouchAt, drop.lastTouchAt),
    lastEmailedAt: latestIso(keep.lastEmailedAt, drop.lastEmailedAt),
    repliedAt: earliestIso(keep.repliedAt, drop.repliedAt),
    lastHeardAt: latestIso(keep.lastHeardAt, drop.lastHeardAt),
    scheduledAt: fill("scheduledAt"),
    threadId: fill("threadId"),
    lastMessageId: fill("lastMessageId"),
    linkedin: fill("linkedin"),
    position: fill("position"),
    headline: fill("headline"),
    team: fill("team"),
    location: fill("location"),
    school: fill("school"),
    phone: fill("phone"),
    profile: fill("profile"),
    call: fill("call"),
    referral: fill("referral"),
    referredBy: fill("referredBy"),
    draft: fill("draft"),
    draftMeta: fill("draftMeta"),
    followUpDraft: fill("followUpDraft"),
    serverSend: fill("serverSend"),
    outcome: keep.outcome && drop.status !== "ignored" && keep.status === "ignored" ? undefined : fill("outcome"),
    comment: [keep.comment, drop.comment].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" | ").slice(0, 2000),
    chats: uniqBy([...(keep.chats ?? []), ...(drop.chats ?? [])], (x) => x.id),
    signals: uniqBy([...(keep.signals ?? []), ...(drop.signals ?? [])], (x) => `${x.kind}|${x.at}|${"name" in x ? String(x.name) : ""}`),
    metAt: uniqBy([...(keep.metAt ?? []), ...(drop.metAt ?? [])], (x) => x.sessionId),
    history: [...(keep.history ?? []), ...(drop.history ?? [])].sort((a, b) => a.at.localeCompare(b.at)).slice(-200),
  };
}
