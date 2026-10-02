/**
 * Sanity-check the spreadsheet parser + write-back against a real workbook, outside the browser.
 *   npm run check:workbook -- "path/to/file.xlsx"
 * Prints detected contacts per bank/region, then round-trips a fake email + status through
 * contactPatches -> buildWorkbook -> parseWorkbook and asserts it comes back.
 */
import fs from "node:fs";
import ExcelJS from "exceljs";
import { allocateRow, applyPatches, buildWorkbook, contactPatches, locationTeamDropdowns, mergePatches, parseSnapshots, parseWorkbook, shiftTableRows, splitLocationTeamPatches, syncGridEdits, type Patches } from "../src/lib/workbook";
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

// Excel-style row delete/insert inside a contact table: people below move, banners/other tables and "#" stay put.
{
  const info = p.tables.find((t) => t.sheet === "MS" && t.cols.linkedin) ?? p.tables.find((t) => t.cols.linkedin && t.cols.name)!;
  const conv = p.tables.find((t) => t.sheet === info.sheet && t !== info);
  const snap = p.snapshots.find((s) => s.name === info.sheet)!;
  const people = p.contacts.filter((c) => c.ref?.sheet === info.sheet && c.ref.row > info.headerRow).sort((a, b) => a.ref!.row - b.ref!.row);
  const first = people[0];
  const del = shiftTableRows({ snapshot: snap, sheetPatches: {}, tables: p.tables, row: first.ref!.row, count: 1, mode: "delete" });
  if ("error" in del) throw new Error(del.error);
  const after = parseSnapshots(applyPatches(p.snapshots, { [info.sheet]: del.patches }));
  const namesAt = (list: typeof p.contacts) => list.filter((c) => c.ref?.sheet === info.sheet && c.ref.row > info.headerRow).map((c) => `${c.ref!.row}:${c.name}`).sort();
  const expected = people.slice(1).map((c) => `${del.moveRow(c.ref!.row)}:${c.name}`).sort();
  const got = namesAt(after.contacts).filter((x) => Number(x.split(":")[0]) > info.headerRow);
  const numberColIntact = Object.keys(del.patches).every((k) => !k.endsWith(":1"));
  const header = (x: typeof p.snapshots) => x.find((s) => s.name === info.sheet)!.cells[`${info.headerRow}:${info.cols.name}`]?.v;
  console.log(`delete row ${first.ref!.row} (${first.name}) on ${info.sheet}: ${people.length} -> ${got.length} people, # column untouched=${numberColIntact}`);
  if (JSON.stringify(expected) !== JSON.stringify(got) || !numberColIntact || header(applyPatches(p.snapshots, { [info.sheet]: del.patches })) !== header(p.snapshots)) {
    console.error("ROW DELETE FAILED", expected.slice(0, 3), got.slice(0, 3));
    process.exit(1);
  }
  // Deleting in the Conversation table must stop at the "Contact | Information" banner.
  if (conv) {
    const convDel = shiftTableRows({ snapshot: snap, sheetPatches: {}, tables: p.tables, row: conv.headerRow + 1, count: 1, mode: "delete" });
    const touched = "error" in convDel ? [] : Object.keys(convDel.patches).map((k) => Number(k.split(":")[0]));
    const maxTouched = Math.max(0, ...touched);
    console.log(`conversation-table delete touches rows up to ${maxTouched} (next header at ${info.headerRow})`);
    if (maxTouched >= info.headerRow - 1 && touched.length) {
      console.error("ROW DELETE CROSSED A SECTION");
      process.exit(1);
    }
  }
  const ins = shiftTableRows({ snapshot: snap, sheetPatches: {}, tables: p.tables, row: first.ref!.row, count: 1, mode: "insert" });
  if ("error" in ins) throw new Error(ins.error);
  const afterIns = parseSnapshots(applyPatches(p.snapshots, { [info.sheet]: ins.patches }));
  const insGot = namesAt(afterIns.contacts);
  const insExpected = people.map((c) => `${c.ref!.row + 1}:${c.name}`).sort();
  if (JSON.stringify(insGot) !== JSON.stringify(insExpected)) {
    console.error("ROW INSERT FAILED", insExpected.slice(0, 3), insGot.slice(0, 3));
    process.exit(1);
  }
  // And the file written from those patches reads back the same way.
  const savedDel = await parseWorkbook(await buildWorkbook(ab, { [info.sheet]: del.patches }));
  if (JSON.stringify(namesAt(savedDel.contacts).filter((x) => Number(x.split(":")[0]) > info.headerRow)) !== JSON.stringify(expected)) {
    console.error("ROW DELETE SAVE FAILED");
    process.exit(1);
  }
  console.log("row delete/insert OK");
}

// Links between tabs (OVERVIEW → bank tab, title → OVERVIEW): read into snapshots and kept through a save, even when the
// linked cell is retyped. ExcelJS alone drops them.
{
  const internal = (snaps: typeof p.snapshots) =>
    snaps.flatMap((s) => Object.entries(s.cells).filter(([, x]) => x.link?.startsWith("#")).map(([k, x]) => `${s.name}!${k}=${x.link}`)).sort();
  const before = internal(p.snapshots);
  console.log(`tab links: ${before.length}`, before.slice(0, 3).join(", "));
  if (before.length) {
    const s0 = p.snapshots.find((s) => Object.values(s.cells).some((x) => x.link?.startsWith("#")))!;
    const sheet = s0.name;
    const addr = Object.keys(s0.cells).find((k) => s0.cells[k].link?.startsWith("#"))!;
    const savedLinks = await parseWorkbook(await buildWorkbook(ab, { [sheet]: { [addr]: { v: "Retyped title" } } }));
    const after = internal(savedLinks.snapshots);
    const retyped = savedLinks.snapshots.find((s) => s.name === sheet)!.cells[addr];
    const shown = applyPatches(p.snapshots, { [sheet]: { [addr]: { v: "Retyped title" } } }).find((s) => s.name === sheet)!.cells[addr];
    console.log(`after save: ${after.length} tab links; retyped cell = ${JSON.stringify(retyped)}`);
    if (JSON.stringify(after) !== JSON.stringify(before) || retyped?.v !== "Retyped title" || shown?.link !== retyped.link) {
      console.error("TAB LINKS LOST ON SAVE", before.filter((x) => !after.includes(x)).slice(0, 5));
      process.exit(1);
    }
    const cleared = internal((await parseWorkbook(await buildWorkbook(ab, { [sheet]: { [addr]: { v: "" } } }))).snapshots);
    if (cleared.length !== before.length - 1) {
      console.error("CLEARING A LINKED CELL KEPT ITS LINK");
      process.exit(1);
    }
    console.log("tab links OK");
  }
  // A workbook whose links were stripped by an older save: rebuild them and check they survive a save.
  const { tabLinkPatches } = await import("../src/lib/sheetLinks");
  const { canonBank, cleanBankName } = await import("../src/lib/banks");
  const restore = tabLinkPatches(p.snapshots, (n) => canonBank(cleanBankName(n)));
  const sample = Object.entries(restore.patches).flatMap(([sh, cells]) => Object.entries(cells).map(([k, x]) => `${sh}!${k} "${x.v}" → ${x.link}`)).slice(0, 4);
  console.log(`restorable tab links: ${restore.count}`, sample.join("; "));
  if (restore.count) {
    const restored = internal((await parseWorkbook(await buildWorkbook(ab, restore.patches))).snapshots);
    if (restored.length !== before.length + restore.count) {
      console.error("RESTORED LINKS DIDN'T SURVIVE THE SAVE", restored.length, before.length, restore.count);
      process.exit(1);
    }
    console.log("restored tab links OK");
  }
}

// Teams: from the Team cell, else inferred from title → notes → headline. Anyone whose title says Tech/TMT/Software/Internet
// must come out as Tech or TMT.
{
  const { teamGuess, teamOf } = await import("../src/lib/locationTeam");
  // As the store does: the COVERAGE tab (if any) feeds office-based team guesses.
  const { readOfficeMap, setOfficeMap } = await import("../src/lib/offices");
  setOfficeMap(readOfficeMap(p.snapshots));
  const counts = { sheet: 0, inferredHigh: 0, inferredLow: 0, none: 0 };
  const low: string[] = [];
  const bySource: Record<string, number> = {};
  for (const c of p.contacts) {
    const g = teamGuess(c);
    if (!g) counts.none++;
    else if (g.source === "sheet" || g.source === "manual") counts.sheet++;
    else {
      bySource[g.source] = (bySource[g.source] ?? 0) + 1;
      if (g.confidence === "high") counts.inferredHigh++;
      else {
        counts.inferredLow++;
        low.push(`${c.name} (${c.bank}): "${c.position}" → ${g.team}`);
      }
    }
  }
  console.log("teams:", JSON.stringify(counts), "inferred from:", JSON.stringify(bySource));
  const sample = p.contacts
    .map((c) => ({ c, g: teamGuess(c) }))
    .filter((x) => x.g && x.g.source !== "sheet")
    .slice(0, 8)
    .map((x) => `${x.c.name}: "${x.c.position}" → ${x.g!.team} [${x.g!.source}, ${x.g!.confidence}, "${x.g!.match}"]`);
  console.log(sample.join("\n"));
  if (low.length) console.log("lowest-confidence:\n  " + low.slice(0, 10).join("\n  "));
  const wrong = p.contacts.filter((c) => /\b(tech|technology|tmt|software|internet)\b/i.test(c.position) && !["Tech", "TMT"].includes(teamOf(c)) && !/\b(tech|tmt|technology)\b/i.test(c.team ?? ""));
  if (wrong.length) {
    console.error("TECH TITLES NOT SORTED AS TECH/TMT:", wrong.slice(0, 5).map((c) => `${c.name}: ${c.position} → ${teamOf(c) || "none"} (sheet: ${c.team || "-"})`));
    process.exit(1);
  }
  // The examples from docs/outreach-rules.md (Part B).
  const { inferTeam } = await import("../src/lib/locationTeam");
  const cases: [string, string | undefined, { bank?: string; region?: string }?][] = [
    ["Analyst - Tech M&A", "Tech"],
    ["VP - Software IB", "Tech"],
    ["Associate - Healthcare M&A", "Healthcare"],
    ["MD - Head of Consumer & Retail", "Consumer"],
    ["IB Analyst - Debt Advisory & Restructuring", "RX"],
    ["Investment Banking Analyst, Technology, Media & Telecom", "TMT"],
    ["Analyst, Media, Entertainment & Sports", "TMT"],
    ["Associate, Financial Sponsors Group", "Sponsors"],
    ["Analyst - Strategic Advisory", "Generalist"],
    ["Investment Banking Analyst", "Generalist", { bank: "Moelis & Company" }],
    ["Investment Banking Analyst", undefined, { bank: "Evercore", region: "SF" }],
    ["Investment Banking Analyst", "Generalist", { bank: "Evercore", region: "NY" }],
    ["Analyst", undefined],
    ["Analyst - SF", undefined],
  ];
  const bad = cases.filter(([t, want, ctx]) => inferTeam(t, ctx)?.team !== want);
  if (bad.length) {
    console.error("INFER TEAM FAILED", bad.map(([t, want, ctx]) => `${t} → ${inferTeam(t, ctx)?.team} (want ${want})`));
    process.exit(1);
  }
  console.log("team inference OK");
}
