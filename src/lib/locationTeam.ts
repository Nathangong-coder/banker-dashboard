import { regionInfo, type Contact, type Region } from "./types";
import { officeTeam } from "./offices";

/**
 * Location and team used to share one "Location/Team" column ("SF/Tech", "Tech, SF", "San Francisco (TMT)").
 * They're now separate fields, each a "semi-dropdown": pick a common value or type your own, and whatever
 * you type joins the list (options are derived from the defaults plus every value in use).
 */
export const DEFAULT_LOCATIONS = ["SF", "NY", "LA", "Menlo Park", "Palo Alto", "Chicago", "Houston", "Boston"];
export const DEFAULT_TEAMS = ["Tech", "Healthcare", "RX", "Generalist", "TMT", "Industrials", "Consumer", "FIG", "Energy", "Real Estate", "M&A", "Sponsors", "LevFin"];

const LOCATION_ALIASES: [RegExp, string][] = [
  [/^(sf|san francisco|bay area|sf bay area)$/i, "SF"],
  [/^(ny|nyc|new york|new york city|manhattan)$/i, "NY"],
  [/^(la|l\.a\.|los angeles)$/i, "LA"],
  [/^(chi|chicago)$/i, "Chicago"],
  [/^(tx|texas)$/i, "Texas"],
];
const TEAM_ALIASES: [RegExp, string][] = [
  [/^(tech|technology)$/i, "Tech"],
  [/^(hc|healthcare|health care)$/i, "Healthcare"],
  [/^(rx|restructuring)$/i, "RX"],
  [/^(generalist|general|gen)$/i, "Generalist"],
];
const PLACES =
  /^(sf|san francisco|bay area|sf bay area|ny|nyc|new york|new york city|manhattan|la|los angeles|menlo park|palo alto|silicon valley|burlingame|san mateo|redwood city|chicago|houston|boston|dallas|charlotte|london|atlanta|miami|seattle|denver|minneapolis|nashville|salt lake city|austin|texas|tx|toronto|century city|santa monica|remote)$/i;

export const isPlace = (v: string) => PLACES.test(v.trim());

/**
 * Team cells that mean "unknown, needs checking" ("?", "-", "n/a", "unknown"), or aren't a team at all (a LinkedIn
 * URL pasted in the wrong column): treated as blank, never as a team.
 */
export const isBlankTeam = (v: string) => /^(\?+|-+|—|n\/?a|unknown|tbd|tbc)$/i.test(v.trim()) || /https?:|linkedin\.com|www\./i.test(v);

const alias = (list: [RegExp, string][], v: string) => list.find(([re]) => re.test(v))?.[1] ?? v;
export const normLocation = (v: string) => alias(LOCATION_ALIASES, v.trim().replace(/\s+/g, " "));
// "FIG?" (a guess the owner flagged) is FIG.
export const normTeam = (v: string) => (isBlankTeam(v) ? "" : alias(TEAM_ALIASES, v.trim().replace(/\s+/g, " ").replace(/\s*\?+$/, "")));

/** "SF/Tech" | "Tech, SF" | "San Francisco (TMT)" | "NY Tech" -> { location: "SF", team: "Tech" }. */
export function splitLocationTeam(raw: string): { location: string; team: string } {
  const tokens = raw
    .split(/\s*(?:[/,|·;()]|\s-\s)\s*/)
    .flatMap((t) => {
      const m = t.trim().match(/^(SF|NY|NYC|LA)\s+(.+)$/i);
      return m ? [m[1], m[2]] : [t.trim()];
    })
    .filter(Boolean);
  const place = tokens.find((t) => PLACES.test(t));
  const team = tokens.filter((t) => t !== place).map(normTeam).filter(Boolean);
  return { location: place ? normLocation(place) : "", team: [...new Set(team)].join(" / ") };
}

/** What the sheet says, whether the table has one combined column or separate Location and Team columns. */
export function readLocationTeam(locCell: string, teamCell?: string): { location: string; team: string } {
  const split = splitLocationTeam(locCell);
  if (teamCell === undefined) return split;
  // A dedicated Location column: a place we don't know (e.g. "Frankfurt") is still the location, not a team.
  const location = split.location || normLocation(locCell);
  const teamFromLoc = split.location ? split.team : "";
  return { location, team: teamCell.trim() ? normTeam(teamCell) : teamFromLoc };
}

/** The value written to a single combined "Location/Team" column. */
export const joinLocationTeam = (location?: string, team?: string) => [location, team].filter(Boolean).join(" · ");

/** When the region is changed by hand, the location becomes that region unless it's already a place in it. */
export function locationForRegion(location: string, region: Region, detect: (s: string) => Region): string {
  if (region === "Other" || (location && detect(location) === region)) return location;
  return regionInfo(region).short;
}

/** Dropdown options: the defaults, then anything in use (so values people type join the list). */
export function locationTeamOptions(contacts: Pick<Contact, "location" | "team">[]) {
  const uniq = (defaults: string[], used: string[]) => {
    const seen = new Set(defaults.map((d) => d.toLowerCase()));
    const extra = [...new Set(used.map((u) => u.trim()).filter((u) => u && !seen.has(u.toLowerCase())))].sort();
    return [...defaults, ...extra];
  };
  return {
    locations: uniq(DEFAULT_LOCATIONS, contacts.map((c) => c.location)),
    teams: uniq(DEFAULT_TEAMS, contacts.map((c) => c.team ?? "")),
  };
}

/* ---------------- team inference (Team cell empty) ---------------- */

export type TeamSource = "sheet" | "position" | "comment" | "headline" | "office" | "manual";
export interface TeamGuess {
  team: string;
  /** "high" = an explicit team word ("Analyst - Tech M&A"); "low" = the generalist-pool fallback. */
  confidence: "high" | "low";
  source: TeamSource;
  /** The words that matched, for the "from title" tooltip. */
  match: string;
}

// Most specific first: "Tech M&A" is Tech, "Technology, Media & Telecom" is TMT, plain "M&A" only when nothing else matches.
const TEAM_RULES: [string, RegExp][] = [
  ["RX", /\b(restructuring|rx|debt advisory|liability management|special situations)\b/i],
  ["LevFin", /\b(leveraged finance|lev ?fin|dcm[- ]hy|high[- ]yield)\b/i],
  ["Sponsors", /\b(financial sponsors?|fsg|private capital|growth capital|sponsor coverage|pe (?:&|and) vc)\b/i],
  ["Healthcare", /\b(healthcare|health care|life sciences?|biotech|medtech|pharma\w*)\b|\bHC\b/i],
  ["Real Estate", /\b(real estate|reits?|lodging|gaming (?:&|and) leisure)\b/i],
  ["FIG", /\b(fig|financial institutions?|insurance|asset management|banks)\b/i],
  ["Energy", /\b(energy|power|utilities|oil (?:&|and) gas|renewables?|natural resources)\b/i],
  ["Industrials", /\b(industrials?|metals (?:&|and) mining|aerospace|a&d|transportation|chemicals)\b/i],
  // Case-sensitive so the "CR" abbreviation doesn't match ordinary words.
  ["Consumer", /\b(?:[Cc]onsumer|CONSUMER|[Rr]etail|RETAIL|[Ff]ood (?:&|and) [Bb]everage|[Rr]estaurants?)\b|\bCR\b/],
  ["TMT", /\b(tmt|media|telecom\w*|entertainment|sports)\b/i],
  ["Tech", /\b(tech|technology|software|internet|semis|semiconductors?|fintech|saas|cyber\w*|data infra\w*|digital infrastructure)\b|\bAI\b/i],
  ["M&A", /\bM&A\b|\bmergers (?:&|and) acquisitions\b/i],
  ["Generalist", /\b(generalist|strategic advisory)\b/i],
];

/** Firms whose analysts start in a generalist pool (Evercore and Lazard only in New York). */
const GENERALIST_POOL: [RegExp, boolean][] = [
  [/moelis/i, false],
  [/centerview/i, false],
  [/\bpjt\b/i, false],
  [/evercore/i, true],
  [/lazard/i, true],
];

/** A team from free text (title, notes, headline). Office words are never teams. */
export function inferTeam(text: string, ctx?: { bank?: string; location?: string; region?: string }): Omit<TeamGuess, "source"> | undefined {
  const t = text.replace(/\s+/g, " ");
  for (const [team, re] of TEAM_RULES) {
    const m = t.match(re);
    if (m) return { team, confidence: "high", match: m[0] };
  }
  const banker = /\b(investment banking|ib)\b.*\b(analyst|associate)\b|\b(analyst|associate)\b.*\b(investment banking|ib)\b/i.test(t);
  const pool = ctx?.bank && GENERALIST_POOL.find(([re]) => re.test(ctx.bank!));
  if (banker && pool && (!pool[1] || ctx?.region === "NY" || /^(ny|new york)/i.test(ctx?.location ?? ""))) {
    return { team: "Generalist", confidence: "low", match: `${ctx!.bank} analysts start as generalists` };
  }
  return undefined;
}

type TeamInputs = Pick<Contact, "team" | "position" | "comment" | "bank" | "location" | "region"> & {
  headline?: string;
  profile?: { text: string };
  teamSource?: TeamSource;
};

/** Where a contact's team comes from: the sheet, else the first of title → notes → LinkedIn headline / captured profile. */
export function teamGuess(c: TeamInputs): TeamGuess | undefined {
  const sheet = normTeam(c.team ?? "");
  if (sheet) return { team: sheet, confidence: "high", source: c.teamSource === "manual" ? "manual" : "sheet", match: sheet };
  const ctx = { bank: c.bank, location: c.location, region: c.region };
  const sources: [TeamSource, string | undefined][] = [
    ["position", c.position],
    ["comment", c.comment],
    ["headline", [c.headline, c.profile?.text.slice(0, 400)].filter(Boolean).join(" · ")],
  ];
  let low: TeamGuess | undefined;
  for (const [source, text] of sources) {
    if (!text?.trim()) continue;
    const g = inferTeam(text, ctx);
    if (g?.confidence === "high") return { ...g, source };
    low ??= g && { ...g, source };
  }
  // Last: what the COVERAGE tab says their office recruits (Qatalyst SF = Tech M&A only; Moelis = Generalist).
  const office = officeTeam(c.bank, c.location || (c.region !== "Other" ? regionInfo(c.region).short : ""));
  if (office?.confidence === "high" && !low) return { ...office, source: "office" };
  return low ?? (office && { ...office, source: "office" });
}

/** The team the app acts on: the sheet's, else a high-confidence guess the user hasn't rejected. Blank = unsorted. */
export function teamOf(c: TeamInputs & { teamRejected?: string }): string {
  const g = teamGuess(c);
  if (!g) return "";
  if (g.source === "sheet" || g.source === "manual") return g.team;
  return g.confidence === "high" && c.teamRejected !== g.team ? g.team : "";
}
