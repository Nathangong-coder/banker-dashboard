import { canonBank } from "./banks";
import type { Contact } from "./types";
import { BANK_DOMAINS } from "./util";

/**
 * Bankers you emailed who aren't in your tracker (owner, 2026-10-23): thank-yous sent straight after an info
 * session (Justin James at Morgan Stanley, 10/5) never got a row, so nothing reminded you to follow up.
 * Pure: the Gmail scan (gmailSync.ts#scanOffSheet) hands in the recipients of your sent mail, this decides who is a
 * banker missing from the tracker. A recipient counts when their domain is a bank's: one your tracker already uses
 * (any contact's email), a built-in bank domain, or a domain whose name reads like a known bank ("tdsecurities.com"
 * when "TD Securities" is on your lists). Other company domains are kept apart as "other" for you to look at;
 * personal / school / no-reply addresses are never listed. `npm run check:offsheet` covers it.
 */

export interface SentRecipient {
  email: string;
  name: string;
  at: number;
  subject: string;
  threadId: string;
}

export interface OffSheetPerson {
  email: string;
  name: string;
  bank: string;
  /** The domain is a bank's (tracker / built-in / name match); false = some other company, shown separately. */
  bankDomain: boolean;
  firstAt: string;
  lastAt: string;
  count: number;
  subject: string;
  threadId: string;
}

const PERSONAL = /^(gmail|googlemail|yahoo|ymail|icloud|me|mac|outlook|hotmail|live|msn|aol|proton|protonmail|pm|gmx|qq|163|126|comcast|verizon|att|sbcglobal)\./;
const ROLE = /^(no-?reply|do-?not-?reply|notifications?|calendar|mailer-daemon|postmaster|info|hello|support|careers|recruiting|campus|hr|admin|team|contact|jobs|talent|events?)\b/;

export const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** Domains that are never a banker's work address. */
export function personalDomain(domain: string, mine: string[] = []) {
  return !domain || PERSONAL.test(domain) || /\.edu$|\.ac\.[a-z]{2}$|\.k12\./.test(domain) || mine.some((m) => domainOf(m) === domain);
}

/** "us.bnpparibas.com" → "bnpparibas"; "mizuhogroup.com" → "mizuhogroup". */
const domainWord = (domain: string) => {
  const parts = domain.split(".");
  const core = parts.length > 2 && parts[parts.length - 2].length <= 3 && parts.length > 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  return (core ?? "").replace(/[^a-z]/g, "");
};
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
// Words a firm's domain adds to its name ("guggenheimsecurities", "mizuhogroup", "rbccm").
const SUFFIX = /(group|securities|partners|capital|markets|advisors|advisory|international|americas|global|bank|financial|inc|llc|co|cm|us)+$/;

/**
 * Domain → bank, from what the tracker already knows (each contact's email domain → their bank, the most common one
 * wins), then built-in bank domains. `banks` (every bank name on your lists) adds name matches for anything else.
 */
export function bankDomains(contacts: Contact[]) {
  const votes = new Map<string, Map<string, number>>();
  for (const c of contacts) {
    for (const e of [c.email, ...(c.aliases ?? [])]) {
      const d = e ? domainOf(e) : "";
      if (!d || !c.bank || personalDomain(d)) continue;
      const m = votes.get(d) ?? new Map<string, number>();
      m.set(c.bank, (m.get(c.bank) ?? 0) + 1);
      votes.set(d, m);
    }
  }
  const out: Record<string, string> = {};
  for (const [d, m] of votes) out[d] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (const [bank, d] of Object.entries(BANK_DOMAINS)) {
    if (!out[d]) out[d] = bank.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return out;
}

/** Which bank a domain belongs to, or null. */
export function bankForDomain(domain: string, map: Record<string, string>, banks: string[]): string | null {
  if (map[domain]) return map[domain];
  // A subdomain of a known bank domain (us.bnpparibas.com when bnpparibas.com is known).
  const parent = Object.keys(map).find((d) => domain.endsWith(`.${d}`));
  if (parent) return map[parent];
  const word = domainWord(domain);
  const stem = word.replace(SUFFIX, "");
  if (stem.length < 3) return null;
  for (const b of banks) {
    const full = squash(b);
    const canon = squash(canonBank(b));
    if (!full) continue;
    // Whole name, or the name without its suffix words, equals the domain word (or its stem). Never a mere substring:
    // "ms" in "msci" or "citi" in "citizensbank" must not match.
    if ([full, canon, full.replace(SUFFIX, "")].some((n) => n.length >= 3 && (n === word || n === stem))) return b;
  }
  return null;
}

const tokens = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/** Is this recipient someone already in the tracker (by address, alias, or name at that bank)? */
export function inTracker(r: { email: string; name: string }, contacts: Contact[], bank: string | null) {
  const email = r.email.toLowerCase();
  const local = email.split("@")[0].replace(/[^a-z]/g, "");
  const shown = new Set(tokens(r.name));
  return contacts.some((c) => {
    if (c.email?.toLowerCase() === email || c.aliases?.some((a) => a.toLowerCase() === email)) return true;
    const f = tokens(c.firstName || c.name.split(" ")[0])[0];
    const l = tokens(c.lastName || c.name.split(" ").slice(-1)[0]).join("");
    if (!f || !l) return false;
    const named = (shown.has(f) && tokens(r.name).join("").includes(l)) || (local.includes(l) && (local.includes(f) || local.startsWith(f[0])));
    if (!named) return false;
    // Same name at the same firm (or a contact with no bank / no email yet): the same person.
    return !c.email || !bank || canonBank(c.bank) === canonBank(bank) || domainOf(c.email) === domainOf(email);
  });
}

/** "justin.james@morganstanley.com" → "Justin James". */
export function nameFromAddress(email: string) {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter((w) => /^[a-z]+$/i.test(w) && w.length > 1)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const cleanName = (n: string) => {
  const t = n.replace(/["']/g, "").trim();
  // "James, Justin" → "Justin James"
  const m = t.match(/^([^,]+),\s*([^,]+)$/);
  return m ? `${m[2]} ${m[1]}` : t;
};

export function offSheetPeople(
  recipients: SentRecipient[],
  contacts: Contact[],
  opts: { me: string[]; banks: string[]; ignored?: string[] },
): OffSheetPerson[] {
  const map = bankDomains(contacts);
  const ignored = new Set((opts.ignored ?? []).map((e) => e.toLowerCase()));
  const mine = new Set(opts.me.map((e) => e.toLowerCase()));
  const byEmail = new Map<string, OffSheetPerson>();
  for (const r of [...recipients].sort((a, b) => a.at - b.at)) {
    const email = r.email.toLowerCase();
    const domain = domainOf(email);
    if (mine.has(email) || ignored.has(email) || personalDomain(domain, opts.me) || ROLE.test(email.split("@")[0])) continue;
    const bank = bankForDomain(domain, map, opts.banks);
    const name = cleanName(r.name) && !r.name.includes("@") ? cleanName(r.name) : nameFromAddress(email);
    if (inTracker({ email, name }, contacts, bank)) continue;
    const at = new Date(r.at).toISOString();
    const cur = byEmail.get(email);
    if (cur) {
      cur.count++;
      cur.lastAt = at;
      if (!cur.name && name) cur.name = name;
      continue;
    }
    const word = domainWord(domain);
    byEmail.set(email, {
      email,
      name,
      bank: bank ?? word.charAt(0).toUpperCase() + word.slice(1),
      bankDomain: !!bank,
      firstAt: at,
      lastAt: at,
      count: 1,
      subject: r.subject,
      threadId: r.threadId,
    });
  }
  return [...byEmail.values()].sort((a, b) => Number(b.bankDomain) - Number(a.bankDomain) || b.lastAt.localeCompare(a.lastAt));
}

export interface TrackerHit {
  contactId: string;
  email: string;
  firstAt: string;
  lastAt: string;
  threadId: string;
}

/**
 * Sent mail to someone already in the tracker under their name but not this address (owner, 2026-10-28: three Tidal
 * info-session thank-yous to people added from the session with no email): the address and dates to record. Only at
 * the same firm (the domain is that bank's) and only when the address isn't theirs or an alias yet.
 */
export function trackerHits(recipients: SentRecipient[], contacts: Contact[], opts: { banks: string[] }): TrackerHit[] {
  const map = bankDomains(contacts);
  const byContact = new Map<string, TrackerHit>();
  for (const r of [...recipients].sort((a, b) => a.at - b.at)) {
    const email = r.email.toLowerCase();
    const bank = bankForDomain(domainOf(email), map, opts.banks);
    if (!bank) continue;
    const name = cleanName(r.name) && !r.name.includes("@") ? cleanName(r.name) : nameFromAddress(email);
    const local = email.split("@")[0].replace(/[^a-z]/g, "");
    const shown = tokens(name);
    const hits = contacts.filter((c) => {
      if (!c.bank || canonBank(c.bank) !== canonBank(bank)) return false;
      if (c.email?.toLowerCase() === email || c.aliases?.some((a) => a.toLowerCase() === email)) return false;
      const f = tokens(c.firstName || c.name.split(" ")[0])[0];
      const l = tokens(c.lastName || c.name.split(" ").slice(-1)[0]).join("");
      if (!f || !l || l.length < 2) return false;
      return (shown.includes(f) && shown.join("").includes(l)) || (local.includes(l) && (local.includes(f) || local.startsWith(f[0])));
    });
    // Two people at the firm fit: leave it for you.
    if (hits.length !== 1) continue;
    const at = new Date(r.at).toISOString();
    const cur = byContact.get(hits[0].id);
    if (cur && cur.email === email) cur.lastAt = at;
    else if (!cur) byContact.set(hits[0].id, { contactId: hits[0].id, email, firstAt: at, lastAt: at, threadId: r.threadId });
  }
  return [...byContact.values()];
}
