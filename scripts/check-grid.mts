/**
 * Bank coverage grid (docs/DESIGN.md L-1, L-4, D-2): progress per bank × office, guessed vs confirmed teams, offices
 * that don't hire, saved views.
 *   npm run check:grid
 */
import { ALL_VIEW, gridCell, teamSourceLabel, viewOffices, viewSummary, viewsOf, type CoverageView } from "../src/lib/coverageGrid";
import { setOfficeOverrides } from "../src/lib/offices";
import type { Contact } from "../src/lib/types";

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) {
    failed++;
    if (detail !== undefined) console.log("       got:", JSON.stringify(detail));
  }
};

const base: Contact = {
  id: "a", name: "Daniel Brooks", firstName: "Daniel", lastName: "Brooks", bank: "Evercore", region: "SF", location: "SF",
  position: "Analyst", email: "d@x.com", linkedin: "", comment: "", status: "new", source: "sheet", followUps: 0, history: [],
};
const p = (o: Partial<Contact>): Contact => ({ ...base, ...o });

const empty = gridCell("Evercore", "SF", [], { team: "Tech" });
check("nobody at the office → level 0, the desk's team, not flagged as a guess", empty.level === 0 && empty.team === "Tech" && empty.teamConfirmed && empty.note === "nobody yet", empty);
check("found → 1", gridCell("Evercore", "SF", [p({})], { team: "Tech" }).level === 1);
check("emailed → 2", gridCell("Evercore", "SF", [p({ status: "sent", sentAt: "2026-11-01T00:00:00Z" })]).level === 2);
check("replied / chatted → 3", gridCell("Evercore", "SF", [p({ status: "replied", repliedAt: "2026-11-02T00:00:00Z" })]).level === 3);
check("referral → 4", gridCell("Evercore", "SF", [p({ referral: { at: "2026-11-03T00:00:00Z" } })]).level === 4);
check("someone in NY doesn't count for SF", gridCell("Evercore", "SF", [p({ region: "NY", location: "NY" })]).level === 0);
check("moved on (ignored) doesn't count", gridCell("Evercore", "SF", [p({ status: "ignored" })]).level === 0);

const fromSheet = p({ team: "Tech" });
check("team from the sheet = confirmed", teamSourceLabel(fromSheet).confirmed && teamSourceLabel(fromSheet).source === "from your sheet");
const fromTitle = p({ position: "Analyst - Technology M&A" });
check("team from the title = confirmed, says so", teamSourceLabel(fromTitle).confirmed && teamSourceLabel(fromTitle).source === "from their title");
const moelis = p({ bank: "Moelis & Company", position: "Investment Banking Analyst", location: "SF" });
const guess = teamSourceLabel(moelis);
check("Moelis 'Investment Banking Analyst' → Generalist, only a low-confidence guess (unconfirmed)", !guess.confirmed && guess.team === "Generalist", guess);
check("no team anywhere → unknown, unconfirmed", !teamSourceLabel(p({ bank: "Some Bank", position: "Analyst" })).confirmed);
const mc = gridCell("Moelis & Company", "SF", [moelis], { team: "Generalist" });
check("…so the cell shows the team with a '?' (teamConfirmed false) and lists them to confirm", !mc.teamConfirmed && mc.guessed.length === 1, mc);
check("…confirmed by you → no longer a guess", gridCell("Moelis & Company", "SF", [p({ ...moelis, team: "Generalist", teamSource: "manual" })], { team: "Generalist" }).teamConfirmed);

setOfficeOverrides({ "evercore|LA": { hires: false } });
check("an office that doesn't hire → hires false (shown as —)", gridCell("Evercore", "LA", []).hires === false);
setOfficeOverrides({});

const mine: Record<string, CoverageView> = {
  w: { id: "w", name: "West coast", offices: ["LA", "SF"] },
  n: { id: "n", name: "New York", offices: ["NY"], pinned: true },
};
check("views: All first, then yours by name", viewsOf(mine).list.map((v) => v.name).join() === "All offices,New York,West coast");
check("the pinned view opens", viewsOf(mine, "w").open.id === "n");
check("else the last used", viewsOf({ w: mine.w }, "w").open.id === "w" && viewsOf({}, "gone").open.id === "all");
check("offices keep the standard order (SF before LA)", viewOffices(mine.w).join() === "SF,LA" && viewOffices(ALL_VIEW).length === 5);
check("meta line text", viewSummary({ ...mine.w, startedOnly: true }) === "Offices: SF, LA · started only" && viewSummary(ALL_VIEW) === "All offices");

console.log(failed ? `\n${failed} failed` : "\nall grid checks passed");
process.exit(failed ? 1 : 0);
