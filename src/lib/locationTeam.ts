import type { Contact, Region } from "./types";

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
  [/^(la|los angeles)$/i, "LA"],
];
const TEAM_ALIASES: [RegExp, string][] = [
  [/^(tech|technology)$/i, "Tech"],
  [/^(hc|healthcare|health care)$/i, "Healthcare"],
  [/^(rx|restructuring)$/i, "RX"],
  [/^(generalist|general|gen)$/i, "Generalist"],
];
const PLACES =
  /^(sf|san francisco|bay area|sf bay area|ny|nyc|new york|new york city|manhattan|la|los angeles|menlo park|palo alto|silicon valley|chicago|houston|boston|dallas|charlotte|london|atlanta|miami|seattle|denver|minneapolis|nashville|salt lake city|austin|toronto|century city|remote)$/i;

const alias = (list: [RegExp, string][], v: string) => list.find(([re]) => re.test(v))?.[1] ?? v;
export const normLocation = (v: string) => alias(LOCATION_ALIASES, v.trim().replace(/\s+/g, " "));
export const normTeam = (v: string) => alias(TEAM_ALIASES, v.trim().replace(/\s+/g, " "));

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
  const team = tokens.filter((t) => t !== place).map(normTeam);
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
  return region;
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
