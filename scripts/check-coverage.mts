/**
 * The coverage page must react to the desks checked in the recruiting plan.
 *   npm run check:coverage -- "path/to/file.xlsx"
 * Prints the scoreboard (banks and desks) for: no desks / SF·Tech / NY·Generalist / both, and fails if any two match,
 * or if "no desks" differs from the unscoped list.
 */
import fs from "node:fs";
import { parseWorkbook } from "../src/lib/workbook";
import { buildCoverage, scoreboard, type ScoreUnit } from "../src/lib/coverage";
import { DESK_PRESETS, type DeskTarget } from "../src/lib/desks";
import { coverageInsights } from "../src/lib/insights";
import { DEFAULT_SETTINGS } from "../src/lib/defaults";
import { readOfficeMap, setOfficeMap } from "../src/lib/offices";
import { BANK_STAGES, bankStage, bankUrgency, bankWork } from "../src/lib/bankWork";

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run check:coverage -- "file.xlsx"');
  process.exit(1);
}
const b = fs.readFileSync(file);
const p = await parseWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
// What the store does when the sheets load: the COVERAGE tab's offices drive "not offered" and office team guesses.
const offices = readOfficeMap(p.snapshots);
setOfficeMap(offices);
console.log(`COVERAGE tab: ${offices.size} banks with office data`);

const desk = (i: number, enabled = true): DeskTarget => ({ ...DESK_PRESETS[i], id: `d${i}`, enabled });
// DESK_PRESETS: SF Tech, LA Tech, NY Generalist, LA Generalist, Texas Energy.
const only = (...on: number[]) => DESK_PRESETS.map((_, i) => desk(i, on.includes(i)));
const views: [string, DeskTarget[]][] = [
  ["no desks", []],
  ["SF · Tech", only(0)],
  ["NY · Generalist", only(2)],
  ["all 5 desks", only(0, 1, 2, 3, 4)],
];

const base = { contacts: p.contacts, tables: p.tables, targets: p.targets, banks: {}, followUp: DEFAULT_SETTINGS.followUp };
const cov = (plan?: DeskTarget[]) => ({ hidden: [], added: [], includeStarter: false, plan });
const out: Record<string, string> = {};
for (const [name, plan] of views) {
  const rows = buildCoverage({ ...base, coverage: cov(plan) });
  const enabled = plan.filter((t) => t.enabled).length;
  const line = (unit: ScoreUnit) => {
    const s = scoreboard(rows, unit);
    return `${unit}: ${s.reached} reached / ${s.ready} ready / ${s.cold} cold of ${s.total} (${s.pct}%), replied ${s.replied}`;
  };
  out[name] = `${line("banks")} | ${enabled ? line("desks") : "desks: n/a"}`;
  console.log(`\n== ${name} (${rows.length} banks in view${enabled > 1 ? ", default unit: desks" : ""})`);
  console.log("  " + line("banks"));
  if (enabled) console.log("  " + line("desks"));
  for (const i of coverageInsights(rows, plan, p.contacts, DEFAULT_SETTINGS.followUp.livePerBank).slice(0, 4)) console.log(`  · ${i.text}`);
}

const unscoped = scoreboard(buildCoverage({ ...base, coverage: cov(undefined) }), "banks");
const noDesks = scoreboard(buildCoverage({ ...base, coverage: cov([]) }), "banks");
const values = Object.values(out);
if (JSON.stringify(unscoped) !== JSON.stringify(noDesks)) {
  console.error("\nNO-DESKS VIEW DIFFERS FROM THE UNSCOPED PAGE");
  process.exit(1);
}
if (new Set(values).size !== values.length) {
  console.error("\nTWO VIEWS HAVE THE SAME SCOREBOARD: the desks aren't scoping the page");
  process.exit(1);
}
console.log("\ncoverage scoping OK (4 different scoreboards, no-desks = today's page)");

// The ranked table (app/coverage): counts cover every contact at a bank, even with desks checked and no team set.
const scopedRows = buildCoverage({ ...base, coverage: cov(only(0, 1, 2, 3, 4)) });
const ranked = scopedRows
  .filter((r) => !r.notOffered)
  .map((r) => {
    const w = bankWork({ name: r.name, contacts: r.allContacts, allContacts: p.contacts, banks: {}, followUp: DEFAULT_SETTINGS.followUp });
    return { r, w, u: bankUrgency(r, w) };
  })
  .sort((a, b) => b.u.score - a.u.score);
console.log("\n== urgency (all 5 desks checked), top 15");
for (const { r, w, u } of ranked.slice(0, 15))
  console.log(`  ${String(u.score).padStart(3)} ${r.name.padEnd(26)} ${w.contacts} contacts · ${w.emailed} emailed · ${w.live} live · ${w.replied} replied · ${w.referrals} ref · ${w.outstanding} to do → ${w.next?.label ?? "-"}`);
for (const { r, w } of ranked) {
  const active = r.allContacts.filter((c) => c.status !== "ignored").length;
  if (w.contacts !== active || w.live > w.emailed) {
    console.error(`\nBANK WORK MISCOUNTS ${r.name}: ${w.contacts} of ${active} contacts, ${w.live} live of ${w.emailed} emailed`);
    process.exit(1);
  }
}
const stageCounts = Object.fromEntries(BANK_STAGES.map((st) => [st, ranked.filter((x) => bankStage(x.r.allContacts) === st).length]));
console.log(`board stages: ${BANK_STAGES.map((st) => `${st} ${stageCounts[st]}`).join(" · ")}`);
console.log("bank work OK (every contact counted, live ≤ emailed)");
