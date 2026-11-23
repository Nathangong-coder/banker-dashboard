/**
 * A company's record (owner, 2026-11-22: "edit everything about the company… more info (copy like something from
 * their wiki or their website + something that leads directly to their job app portal)"). Pure.
 *
 * Stored per bank key in `coverage.firms` (a `cm:` sync doc each). Facts from Wikipedia / Wikidata come in through
 * `api/firms/info` and are marked with their source; anything you type wins and is marked "you".
 */
import { canonBank } from "./banks";
import { boardOf, type Board } from "./jobFinder";

export interface FirmProfile {
  /** Your spelling of the name (shown everywhere: buildCoverage applies it). */
  name?: string;
  website?: string;
  /** The careers / job application portal. */
  careersUrl?: string;
  about?: string;
  hq?: string;
  founded?: string;
  employees?: string;
  notes?: string;
  /** Where `about` / hq / founded / employees came from, and when (`none` = looked, found nothing). */
  source?: { kind: "wikipedia" | "you" | "none"; url?: string; at: string };
}

export function boardUrl(b: Board): string {
  if (b.kind === "workday") return `https://${b.host}/${b.site}`;
  if (b.kind === "greenhouse") return `https://job-boards.greenhouse.io/${b.board}`;
  return `https://jobs.lever.co/${b.board}`;
}

/**
 * The job portal: yours → a career board learned from Find jobs for this firm → the board of a job you track there →
 * a careers search (always works, never a guessed URL).
 */
export function careersFor(
  key: string,
  name: string,
  profile: FirmProfile | undefined,
  boards: Board[],
  jobs: { company: string; url?: string; applyUrl?: string }[],
): { url: string; source: "you" | "board" | "job" | "search"; label: string } {
  if (profile?.careersUrl) return { url: profile.careersUrl, source: "you", label: hostOf(profile.careersUrl) };
  const learned = boards.find((b) => b.company && canonBank(b.company) === key);
  if (learned) return { url: boardUrl(learned), source: "board", label: `${learned.kind[0].toUpperCase()}${learned.kind.slice(1)} careers site` };
  for (const j of jobs) {
    if (canonBank(j.company) !== key) continue;
    for (const link of [j.applyUrl, j.url]) {
      const b = link ? boardOf(link) : null;
      if (b) return { url: boardUrl(b), source: "job", label: `${b.kind[0].toUpperCase()}${b.kind.slice(1)} careers site` };
    }
  }
  return { url: `https://www.google.com/search?q=${encodeURIComponent(`${name} investment banking summer analyst careers apply`)}`, source: "search", label: "Search for the careers page" };
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only http(s) links are kept (a typed "javascript:" or bare word isn't a link). */
export function cleanUrl(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
