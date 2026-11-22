import type { Contact } from "./types";
import { locationMatches } from "./desks";
import { teamGuess } from "./locationTeam";
import { wasEmailed } from "./bankWork";
import { officeInfo } from "./offices";

/**
 * Bank coverage as a bank × office grid (owner, 2026-11-22; docs/DESIGN.md L-1, D-2): each cell = how far you've got
 * at that office (nobody → found → emailed → talked → referral), the team, and whether that team is confirmed or only
 * guessed from the office ("Tech?"). Pure.
 */

export const GRID_OFFICES = ["SF", "NY", "LA", "Chicago", "Texas"] as const;
export type Level = 0 | 1 | 2 | 3 | 4;
export const LEVEL_LABEL = ["Nobody yet", "People found", "Emailed", "Talked", "Referral"] as const;

export interface GridCell {
  office: string;
  /** false = that office doesn't hire summer analysts (COVERAGE tab, the built-in lists or your Corrections). */
  hires: boolean;
  /** One of the offices you're recruiting for at this bank (the plan's desks / your usual desks). */
  inPlan: boolean;
  level: Level;
  /** The group: what the people there are on, else the desk you're after. */
  team: string;
  /** Somebody there has that team from your sheet, a correction, their title, notes or LinkedIn (not just the office). */
  teamConfirmed: boolean;
  note: string;
  people: Contact[];
  /** People there whose team is only a guess (to confirm). */
  guessed: Contact[];
}

const talked = (c: Contact) => !!(c.call || c.chats?.length || c.chatEvidence?.length || c.repliedAt || c.lastHeardAt || c.status === "call_scheduled" || c.status === "done");

/** Where a person's team comes from, in words (DESIGN: show the source next to the team). */
export function teamSourceLabel(c: Contact): { team: string; source: string; confirmed: boolean } {
  const g = teamGuess(c);
  if (!g) return { team: "", source: "unknown", confirmed: false };
  const words: Record<string, string> = { sheet: "from your sheet", manual: "set by you", position: "from their title", comment: "from your notes", headline: "from LinkedIn", office: "guessed from the office" };
  const confirmed = g.source !== "office" && g.confidence === "high";
  return { team: g.team, source: words[g.source] ?? g.source, confirmed };
}

export function gridCell(bank: string, office: string, contacts: Contact[], plan?: { team: string }): GridCell {
  const info = officeInfo(bank, office);
  const here = contacts.filter((c) => (c.status !== "ignored" || c.referral) && locationMatches(office, c));
  const level: Level = here.some((c) => c.referral) ? 4 : here.some(talked) ? 3 : here.some(wasEmailed) ? 2 : here.length ? 1 : 0;
  const teams = here.map(teamSourceLabel);
  const counts = new Map<string, number>();
  for (const t of teams) if (t.team) counts.set(t.team, (counts.get(t.team) ?? 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const team = common ?? plan?.team ?? "";
  const teamConfirmed = !here.length || teams.some((t) => t.confirmed && t.team === team);
  const n = (f: (c: Contact) => boolean) => here.filter(f).length;
  const note =
    level === 4 ? "referral" : level === 3 ? `${n(talked)} talked` : level === 2 ? `${n(wasEmailed)} emailed` : level === 1 ? `${here.length} found` : "nobody yet";
  return {
    office,
    hires: info?.hires !== false,
    inPlan: !!plan,
    level,
    team,
    teamConfirmed,
    note,
    people: here,
    guessed: here.filter((c, i) => !teams[i].confirmed),
  };
}

/* ---------------- saved views (DESIGN L-4) ---------------- */

export interface CoverageView {
  id: string;
  name: string;
  /** Offices shown as columns (empty = all). */
  offices: string[];
  /** Hide banks with nothing started at the shown offices. */
  startedOnly?: boolean;
  /** Banks only (hide private equity and firms that aren't banks). Default true. */
  banksOnly?: boolean;
  display?: "grid" | "list";
  /** Opens by default. */
  pinned?: boolean;
}

export const ALL_VIEW: CoverageView = { id: "all", name: "All offices", offices: [], banksOnly: true, display: "grid" };

/** The built-in view, yours, and the one to open (pinned, else the last used, else All). */
export function viewsOf(mine: Record<string, CoverageView> | undefined, lastId?: string) {
  const list = [ALL_VIEW, ...Object.values(mine ?? {}).sort((a, b) => a.name.localeCompare(b.name))];
  const open = list.find((v) => v.pinned) ?? list.find((v) => v.id === lastId) ?? ALL_VIEW;
  return { list, open };
}

/** Offices a view shows, in the standard order (all of them when it names none). */
export const viewOffices = (v: CoverageView) => (v.offices.length ? GRID_OFFICES.filter((o) => v.offices.includes(o)) : [...GRID_OFFICES]);

/** "Offices: SF, NY" / "All offices", for the meta line. */
export const viewSummary = (v: CoverageView) => [v.offices.length ? `Offices: ${viewOffices(v).join(", ")}` : "All offices", v.startedOnly ? "started only" : ""].filter(Boolean).join(" · ");
