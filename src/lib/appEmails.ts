/**
 * Application emails in Gmail → the job tracker + Gmail labels (owner, 2026-10-26). Pure: no store, no network, so
 * `npm run check:jobs` covers it.
 *
 * Gmail is searched for the emails firms send about applications ("Thank you for applying", Workday / Greenhouse /
 * Lever notifications…). Each one is classified (by the AI when you have a key, else by the fixed rules here): what
 * kind it is, the firm, the role and the summer it's for. Then:
 *   - a confirmation makes the tracked job **Off. applied** (`confirmed`); a job you submitted with no confirmation yet
 *     stays **Pend. applied** (`submitted`). A confirmation for a job you don't track adds it (you applied elsewhere).
 *   - interviews / rejections move the status forward (never back).
 *   - the email gets a Gmail label: "Applications/Summer 2027", "Applications/Summer 2028" (or "Applications/Year
 *     unclear"), so your inbox shows what you applied for too.
 */
import { canonBank } from "./banks";
import type { JobApplication, JobStatus } from "./apply";

export type AppEmailKind = "confirmation" | "interview" | "assessment" | "rejection" | "offer" | "other";

export interface AppEmail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  text: string;
}

export interface AppEmailRead {
  id: string;
  kind: AppEmailKind;
  company: string;
  role: string;
  /** Summer the internship is for; undefined = the email doesn't say. */
  summer?: number;
}

/** The Gmail search for application emails (≤ 180 days; never your sent mail). */
export function applicationQuery(days = 180): string {
  const subjects = [
    "thank you for applying",
    "thanks for applying",
    "application received",
    "we received your application",
    "we've received your application",
    "your application",
    "application submitted",
    "application confirmation",
    "thank you for your application",
    "thank you for your interest",
    "next steps",
    "interview",
    "assessment",
    "hirevue",
  ];
  const senders = [
    "myworkday.com",
    "myworkdayjobs.com",
    "greenhouse.io",
    "greenhouse-mail.io",
    "lever.co",
    "hire.lever.co",
    "icims.com",
    "taleo.net",
    "successfactors.com",
    "oraclecloud.com",
    "avature.net",
    "eightfold.ai",
    "smartrecruiters.com",
    "ashbyhq.com",
    "jobvite.com",
    "brassring.com",
    "hirevue.com",
    "tal.net",
    "joinhandshake.com",
  ];
  return `newer_than:${days}d -in:sent -in:chats (${[...subjects.map((s) => `subject:"${s}"`), ...senders.map((d) => `from:${d}`)].join(" OR ")})`;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The summer an email / posting is for. "Summer 2027", "2027 Summer Analyst", "Summer Analyst 2027" → 2027; "class of
 * 2028" / "graduating in 2028" → 2027 (the summer before senior year). Only years in a sane window; several different
 * summers named = unclear.
 */
export function summerOf(text: string, now = new Date()): number | undefined {
  const t = text.toLowerCase();
  const ok = (y: number) => y >= now.getFullYear() - 1 && y <= now.getFullYear() + 3;
  const summers = new Set<number>();
  for (const m of t.matchAll(/\bsummer\s+(?:analyst\s+|associate\s+|intern(?:ship)?\s+|internship program\s+|program\s+)?(20\d{2})\b|\b(20\d{2})\s+(?:[a-z&]+\s+){0,4}?summer\b|\bsummer\s+(?:[a-z&]+\s+){1,4}(20\d{2})\b/g)) {
    const y = Number(m[1] ?? m[2] ?? m[3]);
    if (ok(y)) summers.add(y);
  }
  if (summers.size === 1) return [...summers][0];
  if (summers.size > 1) return undefined;
  const grad = t.match(/\b(?:class of|graduat(?:e|es|ing|ion)(?: date)?(?: in| between)?|expected graduation:?)\s+(?:[a-z]+\s+)?(20\d{2})\b/);
  if (grad && ok(Number(grad[1]) - 1)) return Number(grad[1]) - 1;
  return undefined;
}

/** What kind of email it is, by fixed phrases (used when there's no AI key; the AI does this better). */
export function kindOf(subject: string, text: string): AppEmailKind {
  const t = `${subject}\n${text}`.toLowerCase();
  if (/\b(unfortunately|regret to inform|not (?:be )?(?:moving|move) forward|decided to (?:move forward|pursue) (?:with )?other|no longer under consideration|will not be (?:moving|proceeding))\b/.test(t)) return "rejection";
  if (/\b(pleased to (?:offer|extend)|offer of (?:employment|internship)|congratulations[^.]{0,60}offer)\b/.test(t)) return "offer";
  if (/\b(invite you to (?:an? )?(?:interview|superday)|schedule (?:an? |your )?interview|superday|first[- ]round interview)\b/.test(t)) return "interview";
  if (/\b(hirevue|online assessment|complete (?:the|an|your) (?:assessment|test|video interview)|pymetrics|codesignal|aptitude test)\b/.test(t)) return "assessment";
  if (/\b(thank(?:s| you) for (?:applying|your application|submitting)|(?:we(?:'ve| have)? )?received your application|application (?:has been )?(?:received|submitted|complete)|successfully (?:applied|submitted))\b/.test(t)) return "confirmation";
  return "other";
}

/** The firm from the sender ("Goldman Sachs Recruiting <noreply@gs.com>", "Evercore via Workday <…@myworkday.com>"). */
export function companyOf(from: string, subject: string): string {
  const name = clean(from.replace(/<[^>]*>/, "").replace(/"/g, ""));
  const fromName = clean(name.replace(/\b(via|from)\b.*$/i, "").replace(/\b(recruiting|recruitment|careers?|talent( acquisition)?|campus|university|early careers?|hr|team|no[- ]?reply|notifications?|jobs?|hiring)\b/gi, "").replace(/[|,-]+$/, ""));
  if (fromName && !/^(workday|greenhouse|lever|icims|taleo|do not reply|donotreply)$/i.test(fromName)) return fromName;
  const subj = subject.match(/\b(?:at|with|to)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})/);
  if (subj) return clean(subj[1]);
  const domain = (from.match(/@([a-z0-9.-]+)/i)?.[1] ?? "").split(".").slice(-2, -1)[0] ?? "";
  return /^(myworkday|myworkdayjobs|greenhouse|lever|icims|taleo|gmail)$/i.test(domain) ? "" : domain;
}

/** The role named in the subject ("Thank you for applying to 2027 Summer Analyst - Investment Banking"). */
export function roleOf(subject: string): string {
  const m = subject.match(/(?:for|to)\s+(?:the\s+)?(?:position\s+(?:of\s+)?)?["“]?([^"”|]{4,120}?)["”]?(?:\s+(?:at|with|position|role)\b.*)?$/i);
  return clean(m?.[1] ?? "").replace(/^(?:your )?application\s*/i, "");
}

/** The rules-only read of an email (no AI). */
export function ruleRead(e: AppEmail): AppEmailRead {
  return { id: e.id, kind: kindOf(e.subject, e.text), company: companyOf(e.from, e.subject), role: roleOf(e.subject), summer: summerOf(`${e.subject}\n${e.text}`) };
}

/** The Gmail label for an application email. */
export function labelFor(summer?: number): string {
  return summer ? `Applications/Summer ${summer}` : "Applications/Year unclear";
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["the", "and", "for", "program", "analyst", "summer", "intern", "internship"].includes(w)));

/** The tracked job an email is about: same firm, then the closest role (and the same summer when both are known). */
export function matchJob(r: AppEmailRead, jobs: JobApplication[]): JobApplication | undefined {
  const firm = canonBank(r.company);
  if (!firm) return undefined;
  const same = jobs.filter((j) => canonBank(j.company) === firm || (j.company.length > 3 && r.company.toLowerCase().includes(j.company.toLowerCase())));
  if (same.length <= 1) return same[0];
  const want = words(r.role);
  const score = (j: JobApplication) => {
    const have = words(j.role);
    let s = [...want].filter((w) => have.has(w)).length;
    if (r.summer && j.summer === r.summer) s += 2;
    if (r.summer && j.summer && j.summer !== r.summer) s -= 5;
    if (j.status === "submitted") s += 1; // waiting for exactly this email
    return s;
  };
  return [...same].sort((a, b) => score(b) - score(a))[0];
}

const RANK: Record<JobStatus, number> = { saved: 0, applying: 1, submitted: 2, confirmed: 3, interview: 4, offer: 6, rejected: 5, withdrawn: 5 };
const KIND_STATUS: Partial<Record<AppEmailKind, JobStatus>> = { confirmation: "confirmed", interview: "interview", assessment: "confirmed", rejection: "rejected", offer: "offer" };

/** What an email changes on its job: status only moves forward; a rejection or offer ends it either way. */
export function statusAfter(cur: JobStatus, kind: AppEmailKind): JobStatus {
  const next = KIND_STATUS[kind];
  if (!next) return cur;
  if (next === "rejected" || next === "offer") return cur === "offer" ? cur : next;
  return RANK[next] > RANK[cur] ? next : cur;
}

/**
 * The verification / activation link in an email from an application site: only an https link on that same site (its
 * registrable domain; Workday's family of domains for Workday) worded like a verification. Pure, for check:jobs.
 */
export function pickVerificationLink(html: string, text: string, siteHost: string): string | null {
  const base = siteHost.split(".").slice(-2).join(".");
  // Workday sends from myworkday.com while the site is myworkdayjobs.com / myworkdaysite.com.
  const family = /^myworkday(jobs|site)?\.com$/.test(base) ? ["myworkday.com", "myworkdayjobs.com", "myworkdaysite.com", "workday.com"] : [base];
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((x) => ({ url: x[1].replace(/&amp;/g, "&"), label: x[2].replace(/<[^>]+>/g, " ") }));
  for (const u of text.match(/https:\/\/[^\s<>"')]+/g) ?? []) links.push({ url: u, label: "" });
  for (const l of links) {
    let u: URL;
    try {
      u = new URL(l.url);
    } catch {
      continue;
    }
    const onSite = family.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
    if (u.protocol === "https:" && onSite && /verif|activat|confirm|validate|registration/i.test(`${u.pathname}${u.search} ${l.label}`)) return u.href;
  }
  return null;
}
