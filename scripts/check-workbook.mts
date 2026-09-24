/**
 * Sanity-check the spreadsheet parser + write-back against a real workbook, outside the browser.
 *   npm run check:workbook -- "path/to/file.xlsx"
 * Prints detected contacts per bank/region, then round-trips a fake email + status through
 * contactPatches -> buildWorkbook -> parseWorkbook and asserts it comes back.
 */
import fs from "node:fs";
import { allocateRow, buildWorkbook, contactPatches, parseWorkbook } from "../src/lib/workbook";

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
