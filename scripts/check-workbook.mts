/**
 * Sanity-check the spreadsheet parser + write-back against a real workbook, outside the browser.
 *   npm run check:workbook -- "path/to/file.xlsx"
 * Prints detected contacts per bank/region, then round-trips a fake email + status through
 * contactPatches -> buildWorkbook -> parseWorkbook and asserts it comes back.
 */
import fs from "node:fs";
import ExcelJS from "exceljs";
import { allocateRow, applyPatches, buildWorkbook, contactPatches, locationTeamDropdowns, mergePatches, parseSnapshots, parseWorkbook, splitLocationTeamPatches, syncGridEdits, type Patches } from "../src/lib/workbook";
import { locationTeamOptions } from "../src/lib/locationTeam";

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run check:workbook -- "file.xlsx"');
  process.exit(1);
}
const b = fs.readFileSync(file);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const p = await parseWorkbook(ab);

const byBank: Record<string, number> = {};
for (const c of p.contacts) byBank[`${c.bank} [${c.region}]`] = (byBank[`${c.bank} [${c.region}]`] ?? 0) + 1;
console.log(`contacts=${p.contacts.length} tables=${p.tables.length} sheets=${p.snapshots.length}`);
console.log(`with email=${p.contacts.filter((c) => c.email).length} with linkedin=${p.contacts.filter((c) => c.linkedin).length}`);
console.table(byBank);

const target = p.contacts.find((c) => !c.email && c.ref?.cols.email);
if (!target) {
  console.log("No contact without email to round-trip; done.");
  process.exit(0);
}
const edited = { ...target, email: "roundtrip@example.com", status: "sent" as const };
const patches = contactPatches([edited], p.snapshots);
const out = await buildWorkbook(ab, patches);
const again = await parseWorkbook(out);
const back = again.contacts.find((c) => c.id === target.id);
console.log("patches:", JSON.stringify(patches));
console.log("new-row slot for", target.bank, "->", allocateRow(target.bank, p.tables, new Set()));
if (back?.email !== "roundtrip@example.com" || back.status !== "sent") {
  console.error("ROUND-TRIP FAILED", back);
  process.exit(1);
}
console.log("round-trip OK");

// Typing a new person into the grid should create a contact immediately, then pick up the LinkedIn edit.
const table = p.tables.find((t) => t.cols.name && t.cols.linkedin);
if (table) {
  const slot = allocateRow(table.bank, p.tables, new Set());
  const addr = (c: number) => `${slot.row}:${c}`;
  const named: Patches = { [slot.sheet]: { [addr(slot.cols.name!)]: { v: "Grid Test Person" } } };
  const step1 = syncGridEdits(p.contacts, p.snapshots, {}, named);
  const linked: Patches = { [slot.sheet]: { ...named[slot.sheet], [addr(slot.cols.linkedin!)]: { v: "https://www.linkedin.com/in/grid-test" } } };
  const step2 = syncGridEdits(step1.contacts, p.snapshots, named, linked);
  const person = step2.contacts.find((c) => c.name === "Grid Test Person");
  const step3 = syncGridEdits(step2.contacts, p.snapshots, linked, { [slot.sheet]: { ...linked[slot.sheet], [addr(slot.cols.name!)]: { v: "" } } });
  console.log("grid-added contact:", person?.id, person?.bank, person?.region, person?.linkedin);
  if (step1.added.length !== 1 || person?.linkedin !== "https://www.linkedin.com/in/grid-test" || step3.contacts.some((c) => c.name === "Grid Test Person")) {
    console.error("GRID SYNC FAILED");
    process.exit(1);
  }
  if (step2.contacts.length !== p.contacts.length + 1) {
    console.error("GRID SYNC touched other contacts", step2.contacts.length, p.contacts.length);
    process.exit(1);
  }
  console.log("grid sync OK");
}


// Untouched contacts must not produce write-backs (location/team are compared by meaning, not text).
const idle = contactPatches(p.contacts, p.snapshots);
const idleCells = Object.values(idle).reduce((n, x) => n + Object.keys(x).length, 0);
console.log("write-backs with no changes:", idleCells, idleCells ? JSON.stringify(idle).slice(0, 300) : "");
if (idleCells) {
  console.error("SPURIOUS WRITE-BACKS");
  process.exit(1);
}

// Location/Team split: patches -> live parse -> save with dropdowns -> re-read; every person keeps location, team, region.
const split = splitLocationTeamPatches(p.snapshots, p.tables);
const live = parseSnapshots(applyPatches(p.snapshots, split.patches));
const opts = locationTeamOptions(p.contacts);
const saved = await buildWorkbook(ab, mergePatches(contactPatches(live.contacts, p.snapshots), split.patches), locationTeamDropdowns(live.tables, opts));
const reread = await parseWorkbook(saved);
const key = (c: { id: string; location: string; team?: string; region: string }) => `${c.id}|${c.location}|${c.team ?? ""}|${c.region}`;
const beforeKeys = p.contacts.map(key).sort();
const afterKeys = reread.contacts.map(key).sort();
const diff = beforeKeys.filter((k) => !afterKeys.includes(k));
console.log(`split: ${split.tables} tables, ${Object.values(split.patches).reduce((n, x) => n + Object.keys(x).length, 0)} cells; with team column after save: ${reread.tables.filter((t) => t.cols.team).length}`);
console.log("locations:", opts.locations.join(", "), "| teams:", opts.teams.join(", "));
const sample = reread.contacts.filter((c) => c.team).slice(0, 4).map((c) => `${c.name}: ${c.location} / ${c.team} [${c.region}]`);
console.log(sample.join("; "));
const wb2 = new ExcelJS.Workbook();
await wb2.xlsx.load(saved);
const ms = reread.tables.find((t) => t.sheet === "MS" && t.cols.team);
const dv = ms ? wb2.getWorksheet("MS")!.getCell(ms.headerRow + 1, ms.cols.team!).dataValidation : undefined;
console.log("MS team dropdown:", JSON.stringify(dv));
if (diff.length || reread.contacts.length !== p.contacts.length || !dv?.formulae?.length) {
  console.error("SPLIT FAILED", diff.slice(0, 5), reread.contacts.length, p.contacts.length);
  process.exit(1);
}
console.log("location/team split OK");
