/**
 * Apply the dashboard's bank-tab upkeep straight to a workbook file (no browser):
 *   npm run fix:workbook -- "path/to/file.xlsx"            (writes the file in place, after a backup next to it)
 *   npm run fix:workbook -- "path/to/file.xlsx" --dry-run  (just print what would change)
 * Same logic the app runs on load / import / save (lib/tabChanges.ts): a tab + OVERVIEW row for every bank on the lists,
 * ticker names, malformed bank tabs rebuilt, COVERAGE rows for firms you applied to.
 */
import fs from "node:fs";
import path from "node:path";
import { buildWorkbook, mergePatches, parseWorkbook } from "../src/lib/workbook";
import { computeTabChanges, describeTabChanges } from "../src/lib/tabChanges";
import { EMPTY_OPS } from "../src/lib/sheetOps";
import { buildCoverage } from "../src/lib/coverage";
import { readOfficeMap, setOfficeMap } from "../src/lib/offices";
import { DEFAULT_SETTINGS } from "../src/lib/defaults";

const file = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!file) {
  console.error('Usage: npm run fix:workbook -- "file.xlsx" [--dry-run]');
  process.exit(1);
}
const b = fs.readFileSync(file);
const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const p = await parseWorkbook(ab);
setOfficeMap(readOfficeMap(p.snapshots));
const banks = buildCoverage({
  contacts: p.contacts,
  tables: p.tables,
  targets: p.targets,
  coverage: { hidden: [], added: [], includeStarter: false },
  banks: {},
  followUp: DEFAULT_SETTINGS.followUp,
}).map((r) => ({ name: r.name, tier: r.tier, applied: r.applied }));

const r = computeTabChanges({ snapshots: p.snapshots, patches: {}, contacts: p.contacts, tables: p.tables, ops: EMPTY_OPS }, banks);
console.log(describeTabChanges(r.changes) || "Nothing to change: every bank has a tab and an OVERVIEW row.");
if (r.changes.skipped.length) console.log("Not given a tab:", r.changes.skipped.map((s) => `${s.bank} (${s.why})`).join(", "));
if (!r.changed || dry) process.exit(0);

const out = await buildWorkbook(ab, mergePatches(r.state.patches, r.planPatches), [], r.state.ops);
// Sanity check before touching the original: it parses, nobody went missing, and every new tab is there.
const check = await parseWorkbook(out);
const names = new Set(check.snapshots.map((s) => s.name));
const missing = r.changes.added.filter((a) => !names.has(a.tab));
if (check.contacts.length !== p.contacts.length || missing.length) {
  console.error("Not saved: the result didn't check out", { contacts: [p.contacts.length, check.contacts.length], missing });
  process.exit(1);
}
// Excel locks files it has open: find out before making a backup.
try {
  fs.closeSync(fs.openSync(file, "r+"));
} catch (e) {
  console.error(`Can't write ${file} (${(e as Error).message}). Close it in Excel and run again.`);
  process.exit(1);
}
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
const backup = path.join(path.dirname(file), `${path.basename(file, ".xlsx")} (backup ${stamp}).xlsx`);
fs.copyFileSync(file, backup);
try {
  fs.writeFileSync(file, Buffer.from(out));
} catch (e) {
  console.error(`Couldn't write ${file} (${(e as Error).message}). Close it in Excel and run again. Backup: ${backup}`);
  process.exit(1);
}
console.log(`Saved ${file}\nBackup of the original: ${backup}`);
