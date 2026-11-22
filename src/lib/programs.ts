import type { JobApplication } from "./apply";

/**
 * Summer Analyst vs everything else (owner, 2026-11-21: JP Morgan showed "Applied" because an insight program was
 * tracked; its summer analyst posting isn't out). Only a Summer Analyst application for the summer you're recruiting
 * for counts as "applied" on the Process tracker, Bank coverage and the 9 PM text. Pure.
 */
export type ProgramKind = "sa" | "insight" | "other";

const INSIGHT = /\binsights?\b|early insight|discover(y|ing)?\b|explor(e|ation|atory)\b|spring week|sophomore|freshman|first[- ]year|second[- ]year|pre[- ]?internship|launch|academy|summit|experience (day|program)|virtual experience|early (careers?|identification|id)\b|diversity|pathways?|bridge program|\bseo\b|\bmlt\b|women in|black|hispanic|latinx|leadership program|fellowship|externship|bootcamp|forum|conference|open house/i;
const SUMMER_ANALYST = /summer (analyst|associate|intern(ship)?)|\bsa\b|investment banking (analyst )?intern|ib (summer )?intern|analyst intern(ship)?|summer (20)?\d{2}\b.*(analyst|intern)|(analyst|intern).*summer (20)?\d{2}\b|(\d{4}|'\d{2}) summer/i;

/** What kind of program a job / application row is (your override on the job wins). */
export function programKind(j: { role?: string; program?: ProgramKind; description?: string }): ProgramKind {
  if (j.program) return j.program;
  const title = j.role ?? "";
  // The title decides; the description only breaks a tie (postings for insight programs mention "summer analyst" a lot).
  if (INSIGHT.test(title)) return "insight";
  if (SUMMER_ANALYST.test(title)) return "sa";
  const desc = (j.description ?? "").slice(0, 1500);
  if (INSIGHT.test(desc) && !SUMMER_ANALYST.test(desc)) return "insight";
  if (SUMMER_ANALYST.test(desc)) return "sa";
  return "other";
}

/** The summer a job is for: what Gmail / the posting said, else a year in the title ("2028 Summer Analyst", "'28"). */
export function summerOf(j: { summer?: number; role?: string }): number | undefined {
  if (j.summer) return j.summer;
  const m = (j.role ?? "").match(/\b(20\d{2})\b/) ?? (j.role ?? "").match(/[''](\d{2})\b/);
  if (!m) return undefined;
  const y = Number(m[1].length === 2 ? `20${m[1]}` : m[1]);
  return y >= 2024 && y <= 2035 ? y : undefined;
}

/**
 * The summer you're recruiting for: the one before you graduate (class of 2029 → Summer 2028). Reads the first of
 * `years` with a year in it: Applications → My info's graduation date, then Settings → Profile's class year.
 */
export function targetSummer(years: string | (string | undefined)[] | undefined, now = new Date()): number {
  for (const s of Array.isArray(years) ? years : [years]) {
    const y = Number((s ?? "").match(/(?:^|\D)(20\d{2})(?!\d)/)?.[1]);
    if (y > 2000) return y - 1;
  }
  return now.getFullYear() + 1;
}

/**
 * The jobs that belong on a recruiting cycle's board. Your target summer: Summer Analyst postings for that summer (or
 * with no year). Any other summer (e.g. 2027): every program for that summer (insight, sophomore programs…).
 */
export function jobsForCycle<J extends Pick<JobApplication, "role" | "summer" | "description"> & { program?: ProgramKind }>(jobs: J[], cycle: number, target: number): J[] {
  return jobs.filter((j) => {
    const s = summerOf(j);
    if (cycle === target) return programKind(j) === "sa" && (s === undefined || s === cycle);
    return s === cycle;
  });
}

/** A row of the workbook's applications tab ("Summer Analyst", "Sophomore Insight Day 2027") counts for this cycle. */
export function appRowForCycle(program: string, cycle: number, target: number) {
  const s = summerOf({ role: program });
  if (cycle === target) return programKind({ role: program }) !== "insight" && (s === undefined || s === cycle);
  return s === cycle;
}
