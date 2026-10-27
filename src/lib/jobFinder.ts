/**
 * Finding internships (Applications → Find jobs, owner 2026-10-24). Pure: no store, no network, so
 * `npm run check:jobs` can run it.
 *
 * Sources, in the order they're trusted:
 *   1. The banks' own career boards. Greenhouse and Lever publish official public job feeds; Workday career sites
 *      load their job list from a public endpoint (/wday/cxs/<tenant>/<site>/jobs). api/jobs/search reads them.
 *      A board is learned from any application link Coverage sees (search results, jobs you track), so the list
 *      gets better over time (`ApplyState.boards`).
 *   2. Google search (Serper / Brave) over those application systems, for banks whose board isn't known yet.
 *   3. LinkedIn Jobs, read by the extension in your own browser (opt-in, test build only; see extension/README.md).
 */
import { canonBank } from "./banks";
import type { JobReview } from "./jobReview";

export type JobSource = "workday" | "greenhouse" | "lever" | "search" | "linkedin" | "handshake";

export interface FoundJob {
  /** Stable id: the posting's address without tracking parameters. */
  key: string;
  company: string;
  title: string;
  url: string;
  location?: string;
  /** As the board says it ("Posted 3 Days Ago", an ISO date…). */
  posted?: string;
  source: JobSource;
  snippet?: string;
  description?: string;
  applyUrl?: string;
  linkedinJobId?: string;
  handshakeJobId?: string;
  foundAt: string;
  /** The AI's read of it (stored, so a job is never sent to the AI twice). */
  review?: JobReview;
}

/** A career board Coverage can list jobs from. */
export type Board =
  | { kind: "workday"; host: string; tenant: string; site: string; company?: string }
  | { kind: "greenhouse"; board: string; company?: string }
  | { kind: "lever"; board: string; company?: string };

const SLUG = /^[A-Za-z0-9_-]{1,80}$/;
const WORKDAY_HOST = /^[a-z0-9-]{1,63}\.wd\d{1,3}\.(myworkdayjobs|myworkdaysite)\.com$/;

/** The board a job / careers link belongs to, if it's one of the systems we can list. */
export function boardOf(raw: string): Board | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.split("/").filter(Boolean);
  if (WORKDAY_HOST.test(host)) {
    // <tenant>.wd5.myworkdayjobs.com/[en-US/]<site>/job/…   ·   …/wday/cxs/<tenant>/<site>/…
    const tenant = host.split(".")[0];
    const rest = path[0] === "wday" && path[1] === "cxs" ? path.slice(3) : /^[a-z]{2}-[A-Z]{2}$/.test(path[0] ?? "") ? path.slice(1) : path;
    const site = rest[0];
    if (!site || !SLUG.test(site) || site === "job" || !SLUG.test(tenant)) return null;
    return { kind: "workday", host, tenant, site };
  }
  if (/^(boards|job-boards)\.greenhouse\.io$/.test(host) || host === "boards-api.greenhouse.io") {
    const board = host === "boards-api.greenhouse.io" ? path[2] : path[0] === "embed" ? u.searchParams.get("for") ?? "" : path[0];
    return board && SLUG.test(board) ? { kind: "greenhouse", board: board.toLowerCase() } : null;
  }
  if (host === "jobs.lever.co" || host === "api.lever.co") {
    const board = host === "api.lever.co" ? path[2] : path[0];
    return board && SLUG.test(board) ? { kind: "lever", board: board.toLowerCase() } : null;
  }
  return null;
}

export const boardId = (b: Board) => (b.kind === "workday" ? `workday:${b.host}/${b.site}` : `${b.kind}:${b.board}`);

/** Add newly seen boards to the saved list (by id; a company name fills in when known). */
export function mergeBoards(saved: Board[], seen: Board[], max = 150): Board[] {
  const out = new Map(saved.map((b) => [boardId(b), b]));
  for (const b of seen) {
    const prev = out.get(boardId(b));
    out.set(boardId(b), prev ? { ...prev, company: prev.company || b.company } : b);
  }
  return [...out.values()].slice(-max);
}

/** The posting's address without tracking parameters or fragments, as the job's id. */
export function jobKey(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|source|src|ref|gh_src|lever-|trk|refId|trackingId)/i.test(p)) u.searchParams.delete(p);
    const li = u.pathname.match(/\/jobs\/view\/(\d+)/);
    if (/(^|\.)linkedin\.com$/i.test(u.hostname) && li) return `linkedin:${li[1]}`;
    const hs = u.pathname.match(/\/(?:stu\/)?(?:jobs|job-search)\/(\d+)/);
    if (/(^|\.)joinhandshake\.com$/i.test(u.hostname) && hs) return `handshake:${hs[1]}`;
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Internship-type postings (summer analyst, intern, early insight / sophomore programs), optionally for a year. */
export function isInternship(title: string, years: number[] = []): boolean {
  const t = title.toLowerCase();
  if (!/\b(intern|internship|summer analyst|summer associate|early insights?|sophomore|freshman|discovery|insight (program|day|week)|spring week|fellowship|externship)\b/.test(t)) return false;
  if (/\b(full[- ]time|experienced|vice president|director|managing director)\b/.test(t)) return false;
  if (!years.length) return true;
  const named = [...t.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  // No year in the title: keep it (most boards only say "Summer Analyst").
  return !named.length || named.some((y) => years.includes(y));
}

/**
 * Investment-banking-ish. Titles are formulaic ("Services - Summer Analyst", "2027 Investment Banking Summer
 * Analyst"), so fixed words do it: banking words win; a named non-banking division loses; a bare "Summer Analyst"
 * (the bank's main program) stays.
 */
export function isBankingRole(title: string, snippet = ""): boolean {
  const t = title.toLowerCase();
  const BANKING = /\b(investment bank(ing)?|ib|m&a|mergers|advisory|corporate finance|capital markets|leveraged finance|restructuring|financial sponsors|corporate (and|&) investment bank(ing)?|cib|banking)\b/;
  if (BANKING.test(t)) return true;
  const OTHER = /\b(software|engineer(ing)?|technology|tech|infrastructure|data scien\w*|cyber|risk|wealth|private bank(ing)?|services|operations|compliance|audit|human resources|marketing|retail|consumer bank(ing)?|branch|teller|nurse|research|sales|trading|markets|asset management|quant\w*)\b/;
  if (OTHER.test(t)) return false;
  if (/\bsummer (analyst|associate)\b/.test(t)) return true;
  return BANKING.test(snippet.toLowerCase());
}

const US_STATES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia";
const US_CITIES = "new york|nyc|san francisco|menlo park|palo alto|los angeles|chicago|houston|dallas|boston|charlotte|atlanta|seattle|miami|denver|austin|philadelphia|minneapolis|nashville|richmond|baltimore|st\\.? louis|cleveland|salt lake";
const US_NAMES = new RegExp(`\\b(united states|usa|u\\.s\\.|${US_STATES}|${US_CITIES})\\b`, "i");
/** "New York, NY" / "Menlo Park, CA" (upper-case state codes only, so "Remote, in…" isn't Indiana). */
const US_CODE = /,\s*(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY])\b/;

/** A posting in the United States (or with no location given: kept, to be safe). */
export function inUS(location?: string): boolean {
  const l = (location ?? "").trim();
  if (!l || /^\d+ locations?$/i.test(l) || /remote/i.test(l)) return true;
  return US_NAMES.test(l) || US_CODE.test(l);
}

const QUERY_SITES = ["myworkdayjobs.com", "boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co"];

/** Google queries (≤ 30 words: Google cuts at 32) over the application systems banks use. */
export function searchQueries(terms: string, years: number[], banks: string[] = []): string[] {
  const words = terms.trim() || "summer analyst investment banking";
  const yearPart = years.length ? `(${years.map((y) => `"${y}"`).join(" OR ")})` : "";
  const sites = `(${QUERY_SITES.map((s) => `site:${s}`).join(" OR ")})`;
  const base = [`${sites} "${words.replace(/"/g, "")}" ${yearPart}`.trim()];
  // Banks you cover, a few per query, for boards that aren't known yet.
  for (let i = 0; i < Math.min(banks.length, 24); i += 4) {
    const names = banks.slice(i, i + 4).map((b) => `"${b.replace(/"/g, "")}"`).join(" OR ");
    base.push(`${sites} (${names}) ("summer analyst" OR intern) ${yearPart}`.trim());
  }
  return base.map((q) => q.split(/\s+/).slice(0, 30).join(" "));
}

/** "Goldman Sachs - 2027 Summer Analyst | Workday" → title and company from a search result. */
export function parseResultTitle(title: string): { title: string; company: string } {
  const clean = title.replace(/\s*[|·]\s*(workday|greenhouse|lever|careers?|jobs?).*$/i, "").replace(/^job application for\s+/i, "").trim();
  const at = clean.match(/^(.*?)\s+at\s+(.+)$/i);
  if (at) return { title: at[1].trim(), company: at[2].trim() };
  const parts = clean.split(/\s+[-–—|]\s+/);
  return { title: (parts[0] ?? clean).trim(), company: parts.length > 1 ? parts[parts.length - 1].trim() : "" };
}

/** Workday tenants are often ticker-ish ("ms", "jpmc"): show a known bank's real name when the tenant reads as one. */
export function companyFor(raw: string, banks: string[]): string {
  const k = canonBank(raw);
  return banks.find((b) => canonBank(b) === k) ?? raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface TrackedLike {
  url: string;
  applyUrl?: string;
  linkedinJobId?: string;
  handshakeJobId?: string;
  company: string;
  role: string;
}

/** New finds only: not already tracked (by link, LinkedIn id, or firm + title), not dismissed, not seen twice. */
export function freshJobs(found: FoundJob[], tracked: TrackedLike[], dismissed: string[]): FoundJob[] {
  const keys = new Set(dismissed);
  for (const j of tracked) {
    for (const u of [j.url, j.applyUrl]) if (u) keys.add(jobKey(u));
    if (j.linkedinJobId) keys.add(`linkedin:${j.linkedinJobId}`);
    if (j.handshakeJobId) keys.add(`handshake:${j.handshakeJobId}`);
    keys.add(`${canonBank(j.company)}|${j.role.trim().toLowerCase()}`);
  }
  const out: FoundJob[] = [];
  for (const f of found) {
    const byName = `${canonBank(f.company)}|${f.title.trim().toLowerCase()}`;
    if (keys.has(f.key) || keys.has(byName)) continue;
    keys.add(f.key);
    keys.add(byName);
    out.push(f);
  }
  return out;
}

/** Order: firms on your coverage list first, then newest finds. */
export function rankJobs(found: FoundJob[], banks: string[]): FoundJob[] {
  const known = new Set(banks.map(canonBank));
  return [...found].sort((a, b) => Number(known.has(canonBank(b.company))) - Number(known.has(canonBank(a.company))) || b.foundAt.localeCompare(a.foundAt));
}

/** A LinkedIn Jobs search address for the extension's opt-in job reader. Past month, internships. */
export function linkedinJobsUrl(terms: string, location: string): string {
  const u = new URL("https://www.linkedin.com/jobs/search/");
  u.searchParams.set("keywords", terms.trim() || "summer analyst investment banking");
  if (location.trim()) u.searchParams.set("location", location.trim());
  u.searchParams.set("f_TPR", "r2592000");
  u.searchParams.set("f_E", "1");
  return u.toString();
}

/** A Handshake job search address for the extension's opt-in job reader. */
export function handshakeJobsUrl(terms: string): string {
  const u = new URL("https://app.joinhandshake.com/job-search");
  u.searchParams.set("query", terms.trim() || "summer analyst");
  u.searchParams.set("per_page", "25");
  return u.toString();
}

/** Ids of every job you already have (found, dismissed, tracked), so the readers skip them without reading. */
export function knownIds(found: FoundJob[], dismissed: string[], tracked: TrackedLike[], site: "linkedin" | "handshake"): string[] {
  const out = new Set<string>();
  const add = (k: string) => k.startsWith(`${site}:`) && out.add(k.slice(site.length + 1));
  for (const f of found) add(f.key);
  for (const k of dismissed) add(k);
  for (const j of tracked) {
    if (site === "linkedin" && j.linkedinJobId) out.add(j.linkedinJobId);
    if (site === "handshake" && j.handshakeJobId) out.add(j.handshakeJobId);
    for (const u of [j.url, j.applyUrl]) if (u) add(jobKey(u));
  }
  return [...out].slice(-3000);
}
