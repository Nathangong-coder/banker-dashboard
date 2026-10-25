import "server-only";
import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { keysFrom } from "@/lib/server/keys";
import { webSearch } from "@/lib/server/search";
import { boardOf, inUS, isBankingRole, isInternship, jobKey, parseResultTitle, type Board, type FoundJob } from "@/lib/jobFinder";

export const maxDuration = 60;

/**
 * Applications → Find jobs. Stateless: reads public job lists and returns postings; nothing is stored or logged.
 *   boards  = career boards to list (Workday's public job endpoint, Greenhouse's and Lever's official job feeds).
 *   queries = Google searches (your Serper / Brave key) over those systems, for banks whose board isn't known yet;
 *             every board a result points to is listed too, and returned as `boards` so the browser remembers it.
 * Only these three systems' own hosts are ever fetched (no user-supplied addresses: SSRF).
 */
const BoardZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workday"), host: z.string().regex(/^[a-z0-9-]{1,63}\.wd\d{1,3}\.(myworkdayjobs|myworkdaysite)\.com$/), tenant: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), site: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), company: z.string().max(120).optional() }),
  z.object({ kind: z.literal("greenhouse"), board: z.string().regex(/^[a-z0-9_-]{1,80}$/), company: z.string().max(120).optional() }),
  z.object({ kind: z.literal("lever"), board: z.string().regex(/^[a-z0-9_-]{1,80}$/), company: z.string().max(120).optional() }),
]);
const Body = z.object({
  terms: z.string().max(120).default("summer analyst"),
  years: z.array(z.number().int().min(2024).max(2035)).max(4).default([]),
  boards: z.array(BoardZ).max(40).default([]),
  queries: z.array(z.string().max(400)).max(8).default([]),
  /** Keep only investment-banking-ish internships (on by default). */
  bankingOnly: z.boolean().default(true),
  /** Keep only US postings (or ones with no location given). */
  usOnly: z.boolean().default(true),
});

const TIMEOUT = 9000;
const get = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "");

async function listBoard(b: Board, terms: string): Promise<Omit<FoundJob, "foundAt">[]> {
  const company = b.company ?? (b.kind === "workday" ? b.tenant : b.board);
  if (b.kind === "workday") {
    const out: Omit<FoundJob, "foundAt">[] = [];
    for (const searchText of [...new Set([terms, "intern"])]) {
      const res = await get(`https://${b.host}/wday/cxs/${b.tenant}/${b.site}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText }),
      });
      if (!res.ok) throw new Error(`${b.host}: ${res.status}`);
      const j = (await res.json()) as { jobPostings?: { title?: string; externalPath?: string; locationsText?: string; postedOn?: string }[] };
      for (const p of j.jobPostings ?? []) {
        if (!p.title || !p.externalPath?.startsWith("/")) continue;
        const url = `https://${b.host}/${b.site}${p.externalPath}`;
        out.push({ key: jobKey(url), company, title: clip(p.title, 200), url, location: clip(p.locationsText, 120) || undefined, posted: clip(p.postedOn, 40) || undefined, source: "workday" });
      }
    }
    return out;
  }
  if (b.kind === "greenhouse") {
    const res = await get(`https://boards-api.greenhouse.io/v1/boards/${b.board}/jobs`);
    if (!res.ok) throw new Error(`greenhouse ${b.board}: ${res.status}`);
    const j = (await res.json()) as { jobs?: { title?: string; absolute_url?: string; location?: { name?: string }; updated_at?: string }[] };
    return (j.jobs ?? []).flatMap((p) =>
      p.title && p.absolute_url?.startsWith("https://")
        ? [{ key: jobKey(p.absolute_url), company, title: clip(p.title, 200), url: p.absolute_url, location: clip(p.location?.name, 120) || undefined, posted: clip(p.updated_at, 40) || undefined, source: "greenhouse" as const }]
        : [],
    );
  }
  const res = await get(`https://api.lever.co/v0/postings/${b.board}?mode=json`);
  if (!res.ok) throw new Error(`lever ${b.board}: ${res.status}`);
  const j = (await res.json()) as { text?: string; hostedUrl?: string; categories?: { location?: string }; createdAt?: number }[];
  return (Array.isArray(j) ? j : []).flatMap((p) =>
    p.text && p.hostedUrl?.startsWith("https://")
      ? [{ key: jobKey(p.hostedUrl), company, title: clip(p.text, 200), url: p.hostedUrl, location: clip(p.categories?.location, 120) || undefined, posted: p.createdAt ? new Date(p.createdAt).toISOString() : undefined, source: "lever" as const }]
      : [],
  );
}

export async function POST(req: Request) {
  try {
    const { terms, years, boards, queries, bankingOnly, usOnly } = Body.parse(await req.json());
    const serperKeys = keysFrom(req, "serper");
    const braveKeys = keysFrom(req, "brave");
    if (!boards.length && (!queries.length || (!serperKeys.length && !braveKeys.length)))
      throw new HttpError(400, "Add a Serper or Brave Search key (Settings → Data) to search, or track a job on a bank's Workday / Greenhouse / Lever site so Coverage can list that board.");

    const warnings: string[] = [];
    const found: Omit<FoundJob, "foundAt">[] = [];
    const learned = new Map<string, Board>();

    // 1. Google over the application systems (sequential: Brave's free plan is 1 request/second).
    if (serperKeys.length || braveKeys.length) {
      for (const q of queries) {
        try {
          for (const r of await webSearch(serperKeys, braveKeys, q, 10, warnings)) {
            if (!r.link || !/^https:\/\//.test(r.link)) continue;
            const b = boardOf(r.link);
            const parsed = parseResultTitle(r.title ?? "");
            if (b) learned.set(JSON.stringify(b), { ...b, company: parsed.company || undefined });
            if (/\/job(s)?\//.test(r.link) || b?.kind !== "workday")
              found.push({ key: jobKey(r.link), company: parsed.company || (b ? (b.kind === "workday" ? b.tenant : b.board) : ""), title: clip(parsed.title, 200), url: r.link, snippet: clip(r.snippet, 300) || undefined, source: "search" });
          }
        } catch (e) {
          warnings.push(`Search: ${(e as Error).message}`);
          break;
        }
      }
    }

    // 2. Every board: given, plus learned from the search (capped).
    const all = new Map<string, Board>();
    for (const b of [...boards, ...learned.values()]) {
      const id = b.kind === "workday" ? `w:${b.host}/${b.site}` : `${b.kind}:${b.board}`;
      if (!all.has(id)) all.set(id, b);
    }
    const list = [...all.values()].slice(0, 40);
    for (let i = 0; i < list.length; i += 6) {
      const batch = await Promise.allSettled(list.slice(i, i + 6).map((b) => listBoard(b, terms)));
      batch.forEach((r, k) => {
        if (r.status === "fulfilled") found.push(...r.value);
        else warnings.push(`Couldn't list ${list[i + k].kind === "workday" ? (list[i + k] as { host: string }).host : (list[i + k] as { board: string }).board}: ${(r.reason as Error).message}`);
      });
    }

    const seen = new Set<string>();
    const jobs = found.filter((f) => {
      if (!f.title || seen.has(f.key)) return false;
      seen.add(f.key);
      return isInternship(f.title, years) && (!bankingOnly || isBankingRole(f.title, f.snippet)) && (!usOnly || inUS(f.location));
    });
    return Response.json({ jobs: jobs.slice(0, 300), boards: [...learned.values()], warnings: warnings.slice(0, 10) });
  } catch (e) {
    return errorResponse(e);
  }
}
