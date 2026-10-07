/**
 * Guardrails for the built-in firm facts (which offices hire, specialist firms), without a browser:
 *   npm run check:firms                       (the built-in lists + golden cases)
 *   npm run check:firms -- "file.xlsx"        (also: where your COVERAGE tab disagrees with the built-in lists)
 *
 * These facts aren't from a live feed (no public API lists banks' summer-analyst desks). They come from the owner's
 * COVERAGE tab first, then hand-checked lists in src/lib/offices.ts and src/lib/specialty.ts. This script fails on:
 * name collisions, unknown teams, broken golden cases, and the guardrails (your data must beat the lists), and warns
 * when the lists haven't been reviewed in a year.
 */
import fs from "node:fs";
import { canonBank } from "../src/lib/banks";
import { DEFAULT_TEAMS, inferTeam } from "../src/lib/locationTeam";
import { BUILT_IN_OFFICES, OFFICE_FACTS_REVIEWED, readOfficeMap, setOfficeMap, type Office } from "../src/lib/offices";
import { BUILT_IN_SPECIALTIES, SPECIALTY_REVIEWED, specialtyOf } from "../src/lib/specialty";
import { deskStatus, teamMatches, type DeskTarget } from "../src/lib/desks";
import { withEvidence } from "../src/lib/coverage";
import type { Contact, SheetSnapshot } from "../src/lib/types";

let failed = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

// 1. The lists themselves.
{
  const seen = new Map<string, string>();
  for (const [names] of BUILT_IN_SPECIALTIES)
    for (const n of names) {
      const k = canonBank(n);
      const prev = seen.get(k);
      check(`specialty name "${n}" has its own key (${k})`, !prev || names.includes(prev));
      seen.set(k, n);
    }
  for (const [names, teams] of BUILT_IN_SPECIALTIES) check(`${names[0]}: teams ${teams.join("/")} are standard teams`, teams.every((t) => DEFAULT_TEAMS.includes(t)));
  const office = new Map<string, string>();
  for (const name of Object.keys(BUILT_IN_OFFICES)) {
    const k = canonBank(name);
    check(`office list "${name}" doesn't collide (${k})`, !office.has(k) || canonBank(office.get(k)!) === k && office.get(k) === name);
    office.set(k, name);
  }
  // A specialist that "hires" only into teams outside its specialty would be contradictory.
  for (const [names, teams] of BUILT_IN_SPECIALTIES) {
    const offices = BUILT_IN_OFFICES[names[0]] ?? {};
    for (const [o, info] of Object.entries(offices)) {
      if (!info?.hires || !info.teams) continue;
      check(`${names[0]} ${o}: built-in office teams (${info.teams}) fit its specialty (${teams.join("/")})`, teams.some((t) => info.teams!.toLowerCase().includes(t.toLowerCase())));
    }
  }
}

// 2. Golden cases: facts the owner confirmed or that are well established. If one of these changes, it's on purpose.
const desk = (location: string, team: string): DeskTarget => ({ id: `${location}-${team}`, location, team, scope: "all", tiers: [], banks: [], enabled: true });
const person = (over: Partial<Contact>): Contact => ({
  id: Math.random().toString(36).slice(2), name: "A B", firstName: "A", lastName: "B", bank: "X", region: "SF", location: "SF", team: "",
  position: "Analyst", email: "", linkedin: "", comment: "", status: "new", source: "sheet", followUps: 0, history: [], ...over,
});
const state = (bank: string, location: string, team: string, people: Contact[] = [], specialty = specialtyOf(bank)) => deskStatus(desk(location, team), people, bank, specialty?.teams).state;
setOfficeMap(new Map());
const golden: [string, string, string, string][] = [
  ["Leerink Partners", "SF", "Tech", "not_offered"],
  ["Leerink Partners", "NY", "Healthcare", "empty"],
  ["Qatalyst Partners", "SF", "Tech", "empty"],
  ["Qatalyst Partners", "NY", "Generalist", "not_offered"],
  ["LionTree Partners", "SF", "Tech", "empty"],
  ["Goldman Sachs", "SF", "Tech", "empty"],
  ["Goldman Sachs", "Texas", "Energy", "empty"],
  ["Tudor, Pickering, Holt & Co.", "Texas", "Energy", "empty"],
  ["Qatalyst Partners", "Texas", "Energy", "not_offered"],
  ["Raine Group", "SF", "Tech", "not_offered"],
  ["Morgan Stanley", "LA", "Tech", "not_offered"],
];
for (const [bank, loc, team, want] of golden) check(`${bank} · ${loc} · ${team} → ${want}`, state(bank, loc, team) === want);

// 3. Guardrails: your own data beats the built-in lists.
{
  const leerinkTech = person({ bank: "Leerink Partners", team: "Tech", email: "x@leerink.com" });
  check("someone you found on a desk counts even at a specialist", state("Leerink Partners", "SF", "Tech", [leerinkTech]) === "ready");
  const sp = withEvidence(specialtyOf("Leerink Partners"), [{ program: "Technology Investment Banking Summer Analyst", submitted: "9/1", status: "", location: "SF", sheet: "Apps", row: 3 }]);
  check("an application to a Tech program opens the Tech desk", state("Leerink Partners", "SF", "Tech", [], sp) === "empty");
  check("…and says why", !!sp?.evidence?.some((e) => e.team === "Tech"));
  const plain = withEvidence(specialtyOf("Leerink Partners"), [{ program: "Summer Analyst", submitted: "9/1", status: "", location: "", sheet: "Apps", row: 4 }]);
  check("a generic application doesn't open anything", state("Leerink Partners", "SF", "Tech", [], plain) === "not_offered");
  // The owner's COVERAGE tab says Leerink SF recruits Tech: that wins.
  const tab: SheetSnapshot = {
    name: "COVERAGE",
    rows: 2,
    cols: 6,
    cells: {
      "1:1": { v: "Bank" }, "1:2": { v: "Tier" }, "1:3": { v: "Office" }, "1:4": { v: "SA seats here?" }, "1:5": { v: "Teams / groups recruiting here" },
      "2:1": { v: "Leerink Partners" }, "2:2": { v: "MM" }, "2:3": { v: "SF" }, "2:4": { v: "Yes" }, "2:5": { v: "Healthcare; Tech (digital health)" },
    },
  };
  setOfficeMap(readOfficeMap([tab]));
  check("your COVERAGE tab listing Tech at Leerink SF wins over the list", state("Leerink Partners", "SF", "Tech") === "empty");
  setOfficeMap(new Map());
  check("full-service override (null) removes the specialty", !specialtyOf("Leerink Partners", { [canonBank("Leerink Partners")]: null }));
  check("TMT counts for Tech, not Generalist", teamMatches("Tech", "TMT") && !teamMatches("Generalist", "TMT"));
}

// 4. Freshness: nobody publishes this data, so it needs a human look about once a year.
for (const [what, when] of [["Specialist list (src/lib/specialty.ts)", SPECIALTY_REVIEWED], ["Office list (src/lib/offices.ts)", OFFICE_FACTS_REVIEWED]] as const) {
  const days = Math.round((Date.now() - new Date(when).getTime()) / 86_400_000);
  console.log(`${days > 365 ? "WARN" : "ok  "} ${what} last reviewed ${when} (${days} days ago)${days > 365 ? ": re-check firms' recruiting pages, then bump the date" : ""}`);
}

// 5. Optional: where the owner's COVERAGE tab disagrees with the built-in lists (the tab wins; this is for fixing the lists).
const file = process.argv[2];
if (file) {
  const { parseWorkbook } = await import("../src/lib/workbook");
  const b = fs.readFileSync(file);
  const p = await parseWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  const map = readOfficeMap(p.snapshots);
  let n = 0;
  for (const [key, bank] of map) {
    const builtIn = Object.entries(BUILT_IN_OFFICES).find(([name]) => canonBank(name) === key)?.[1];
    for (const [o, info] of Object.entries(bank.offices) as [Office, { hires?: boolean; teams?: string }][]) {
      const bi = builtIn?.[o];
      if (bi?.hires !== undefined && info.hires !== undefined && bi.hires !== info.hires) {
        n++;
        console.log(`  differs: ${bank.name} ${o}: your tab says ${info.hires ? "hires" : "doesn't hire"}, built-in says ${bi.hires ? "hires" : "doesn't"}`);
      }
    }
    const sp = specialtyOf(bank.name);
    if (sp)
      for (const [o, info] of Object.entries(bank.offices)) {
        // Compare by team (inferTeam), not by text: "media, entertainment" is TMT.
        const outside = (info?.teams ?? "")
          .replace(/\([^)]*\)?/g, " ")
          .split(/[;,/]|\band\b/)
          .map((x) => inferTeam(x.trim())?.team)
          .filter((t): t is string => !!t && t !== "Generalist" && t !== "M&A" && !sp.teams.some((s) => s === t || teamMatches(s, t) || teamMatches(t, s) || (s === "TMT" && t === "Tech")));
        if (info?.hires !== false && outside.length) {
          n++;
          console.log(`  differs: ${bank.name} ${o}: your tab lists ${outside.join(", ")}, built-in specialty is ${sp.teams.join("/")} (your tab wins)`);
        }
      }
  }
  console.log(`${n ? "note" : "ok  "} COVERAGE tab vs built-in lists: ${n} difference${n === 1 ? "" : "s"}`);
}

if (failed) {
  console.error(`\n${failed} firm check(s) failed`);
  process.exit(1);
}
console.log("\nfirm facts OK");
