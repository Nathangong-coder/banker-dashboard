/**
 * Sanity-check the spreadsheet parser + write-back against a real workbook, outside the browser.
 *   npm run check:workbook -- "path/to/file.xlsx"
 * Prints detected contacts per bank/region, then round-trips a fake email + status through
 * contactPatches -> buildWorkbook -> parseWorkbook and asserts it comes back.
 */
import fs from "node:fs";
import ExcelJS from "exceljs";
import { followUpsFromSheet, statusFromSheet } from "../src/lib/workbook";
import { formatContacted, parseContacted } from "../src/lib/contacted";
import { teamMatches } from "../src/lib/desks";
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

// Send dates live in the Contacted column (added next to Status when missing) and come back on re-import; sheet
// statuses mean what the owner means by them.
{
  const problems: string[] = [];
  const sample = p.contacts.find((c) => c.ref?.cols.status && c.ref.cols.linkedin);
  if (sample) {
    const dated = { ...sample, status: "followed_up" as const, followUps: 1, sentAt: new Date(2026, 8, 17, 16).toISOString(), lastTouchAt: new Date(2026, 8, 25, 19).toISOString() };
    const queued = p.contacts.find((c) => c.ref?.sheet === sample.ref!.sheet && c.id !== sample.id && c.ref?.cols.status);
    const sched = queued && { ...queued, status: "drafted" as const, scheduledAt: new Date(2026, 9, 6, 9).toISOString() };
    const pt = contactPatches([dated, ...(sched ? [sched] : [])], p.snapshots);
    const back = await parseWorkbook(await buildWorkbook(ab, pt));
    const d = back.contacts.find((c) => c.id === sample.id);
    const q = sched && back.contacts.find((c) => c.id === sched.id);
    const day = (s?: string) => (s ? new Date(s).toDateString() : "-");
    console.log(`contacted: ${JSON.stringify(pt[sample.ref!.sheet])} → sent ${day(d?.sentAt)} last ${day(d?.lastTouchAt)} f/u ${d?.followUps}${q ? `; scheduled ${q.scheduledAt}` : ""}`);
    if (day(d?.sentAt) !== day(dated.sentAt) || day(d?.lastTouchAt) !== day(dated.lastTouchAt)) problems.push("dates didn't round-trip");
    if (d?.followUps !== 1 || d?.status !== "followed_up") problems.push(`follow-ups/status ${d?.followUps}/${d?.status}`);
    if (q && (q.status !== "drafted" || new Date(q.scheduledAt ?? 0).getTime() !== new Date(sched!.scheduledAt).getTime())) problems.push(`scheduled send ${q.status} ${q.scheduledAt}`);
    // Writing again changes nothing (dates compared by meaning).
    const again2 = contactPatches([{ ...d!, ...dated, ref: d!.ref }], back.snapshots);
    if (again2[sample.ref!.sheet] && Object.keys(again2[sample.ref!.sheet]).some((k) => k.endsWith(`:${d!.ref!.cols.contacted}`))) problems.push("Contacted cell rewritten with the same dates");
  }
  const expect: [string, string, number][] = [
    ["Scheduled", "drafted", 0],
    ["Call scheduled", "call_scheduled", 0],
    ["Coffee chat 10/9", "call_scheduled", 0],
    ["Followed up (2x)", "followed_up", 2],
    ["Followed up", "followed_up", 1],
    ["Removed", "ignored", 0],
    ["Bounced", "ignored", 0],
    ["Hold - backup", "new", 0],
    ["Pending", "new", 0],
  ];
  for (const [text, status, fu] of expect) if (statusFromSheet(text) !== status || followUpsFromSheet(text) !== fu) problems.push(`"${text}" → ${statusFromSheet(text)}/${followUpsFromSheet(text)}`);
  const parsed: [string, Partial<Record<"sentAt" | "lastTouchAt" | "scheduledAt", string>>][] = [
    ["9/17/2026", { sentAt: "Thu Sep 17 2026" }],
    ["9/17/2026 · last 9/25/2026", { sentAt: "Thu Sep 17 2026", lastTouchAt: "Fri Sep 25 2026" }],
    ["Scheduled 10/6/2026 9:00 AM", { scheduledAt: "Tue Oct 06 2026 09:00" }],
    ["2026-09-30", { sentAt: "Wed Sep 30 2026" }],
    ["Sep 30, 2026", { sentAt: "Wed Sep 30 2026" }],
  ];
  for (const [text, want] of parsed) {
    const got = parseContacted(text);
    for (const [k, v] of Object.entries(want)) {
      const d = got[k as keyof typeof got];
      const shown = d ? (k === "scheduledAt" ? `${new Date(d).toDateString()} ${new Date(d).toTimeString().slice(0, 5)}` : new Date(d).toDateString()) : "-";
      if (shown !== v) problems.push(`"${text}" ${k} = ${shown}, want ${v}`);
    }
  }
  if (formatContacted({ sentAt: new Date(2026, 8, 17).toISOString(), lastTouchAt: new Date(2026, 8, 25).toISOString() }) !== "9/17/2026 · last 9/25/2026") problems.push("format");
  if (problems.length) {
    console.error("CONTACTED FAILED", problems);
    process.exit(1);
  }
  console.log("contacted dates + sheet statuses OK");
}

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
  const wrong = p.contacts.filter((c) => /\b(tech|technology|tmt|software|internet)\b/i.test(c.position) && !["Tech", "TMT"].includes(teamOf(c)) && !teamMatches("Tech", c.team));
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

// Bank tabs (lib/tabChanges.ts, the same function the app runs on import): every bank on the lists gets a tab named by a
// ticker, a malformed bank tab is rebuilt (people kept), every bank tab is linked from OVERVIEW, and tabs saved by the
// first version with long names (KEYBANC) are renamed. Running again on the saved file changes nothing.
{
  const { computeTabChanges } = await import("../src/lib/tabChanges");
  const { bankTabIndex } = await import("../src/lib/bankTabs");
  const { EMPTY_OPS } = await import("../src/lib/sheetOps");
  const { buildCoverage } = await import("../src/lib/coverage");
  const { readOfficeMap, setOfficeMap } = await import("../src/lib/offices");
  const { DEFAULT_SETTINGS } = await import("../src/lib/defaults");
  const { canonBank } = await import("../src/lib/banks");
  const { renameLink, tabLink } = await import("../src/lib/sheetLinks");
  type Parsed = Awaited<ReturnType<typeof parseWorkbook>>;
  const banksOf = (q: Parsed) =>
    buildCoverage({ contacts: q.contacts, tables: q.tables, targets: q.targets, coverage: { hidden: [], added: [], includeStarter: false }, banks: {}, followUp: DEFAULT_SETTINGS.followUp }).map(
      (r) => ({ name: r.name, tier: r.tier }),
    );
  const run = (q: Parsed) => {
    setOfficeMap(readOfficeMap(q.snapshots));
    return computeTabChanges({ snapshots: q.snapshots, patches: {}, contacts: q.contacts, tables: q.tables, ops: EMPTY_OPS }, banksOf(q));
  };
  const save = async (buf: ArrayBuffer, r: ReturnType<typeof run>, rename?: (tab: string) => string) => {
    let patches = mergePatches(r.state.patches, r.planPatches);
    let ops = r.state.ops;
    if (rename) {
      // Simulate the first version: same tabs, long names.
      const map = new Map(ops.clones.map((c) => [c.name, rename(c.name)]));
      const relink = (l?: string) => (l ? [...map].reduce((acc, [a, b]) => renameLink(acc, a, b), l) : l);
      patches = Object.fromEntries(Object.entries(patches).map(([sh, cells]) => [map.get(sh) ?? sh, Object.fromEntries(Object.entries(cells).map(([k, x]) => [k, { ...x, link: relink(x.link) }]))]));
      ops = { ...ops, clones: ops.clones.map((c) => ({ ...c, name: map.get(c.name)!, after: c.after && (map.get(c.after) ?? c.after) })) };
    }
    const out = await buildWorkbook(buf, patches, [], ops);
    return { out, parsed: await parseWorkbook(out) };
  };
  const problems: string[] = [];
  const checkSaved = (q: Parsed, label: string) => {
    const ov = q.snapshots.find((s) => s.name === "OVERVIEW");
    const links = new Set(Object.values(ov?.cells ?? {}).map((c) => c.link));
    for (const [, tab] of bankTabIndex(q.snapshots)) {
      if (/\(NY\)/.test(tab)) continue;
      const snap = q.snapshots.find((s) => s.name === tab)!;
      if (!/application tracker/i.test(snap.cells["1:1"]?.v ?? "")) problems.push(`${label}: ${tab} has no tracker title`);
      if (ov && !links.has(tabLink(tab))) problems.push(`${label}: ${tab} not linked from OVERVIEW`);
    }
    if (q.contacts.length !== p.contacts.length) problems.push(`${label}: contacts ${p.contacts.length} → ${q.contacts.length}`);
  };

  // A: the workbook as it is.
  const a = run(p);
  console.log(`bank tabs: +${a.changes.added.length} (${a.changes.added.map((x) => x.tab).join(", ")}); rebuilt: ${a.changes.repaired.join(", ") || "none"}; OVERVIEW rows: ${a.changes.listed.length}; skipped: ${a.changes.skipped.map((x) => `${x.bank} (${x.why})`).join(", ") || "none"}`);
  const savedA = await save(ab, a);
  checkSaved(savedA.parsed, "A");
  for (const t of a.changes.added) if (t.tab.length > 4) problems.push(`A: ${t.tab} isn't a ticker`);
  if (a.changes.repaired.includes("BNP")) {
    const bnp = savedA.parsed.contacts.filter((c) => c.ref?.sheet === "BNP");
    console.log("BNP after rebuild:", bnp.map((c) => `${c.id} ${c.name} ${c.location} ${c.linkedin ? "linkedin" : ""} ${c.sheetStatus ?? ""}`).join("; "));
    if (!bnp.length || !bnp.every((c) => c.linkedin && c.ref!.row > 18)) problems.push("A: BNP's people didn't land in Contact Information");
    // The dashboard's record of a moved person is refreshed from the rebuilt row (no junk team, right region) and
    // writes nothing extra back.
    const moved = a.state.contacts.filter((c) => c.ref?.sheet === "BNP");
    const writes = contactPatches(moved, a.state.snapshots).BNP ?? {};
    if (moved.some((c) => (c.team && /linkedin|justinshue/i.test(c.team)) || c.region !== "NY")) problems.push(`A: moved BNP contact not refreshed: ${JSON.stringify(moved.map((c) => [c.team, c.region]))}`);
    if (Object.keys(writes).some((k) => Number(k.split(":")[1]) === 7)) problems.push(`A: moved BNP contact writes a Team cell: ${JSON.stringify(writes)}`);
  }
  const againA = run(savedA.parsed);
  if (againA.changed) problems.push(`A: second run changes things: ${JSON.stringify(againA.changes).slice(0, 200)}`);

  // B: a file saved by the first version (long tab names) gets tickers, links follow.
  const legacy = (tab: string) => (canonBank(a.state.ops.clones.find((c) => c.name === tab)!.bank) || tab).toUpperCase();
  const savedLegacy = await save(ab, a, legacy);
  if (process.env.LEGACY_TO) fs.writeFileSync(process.env.LEGACY_TO, Buffer.from(savedLegacy.out));
  const b = run(savedLegacy.parsed);
  console.log(`legacy names: ${b.changes.renamed.map((r) => `${r.from}→${r.to}`).join(", ")}`);
  const savedB = await save(savedLegacy.out, b);
  checkSaved(savedB.parsed, "B");
  const names = new Set(savedB.parsed.snapshots.map((s) => s.name));
  for (const t of a.changes.added) if (!names.has(t.tab)) problems.push(`B: ${t.tab} missing after renaming`);
  if (names.has("KEYBANC") || names.has("SOCIETE GENERALE")) problems.push("B: long names still there");
  if (run(savedB.parsed).changed) problems.push("B: second run changes things");

  if (problems.length) {
    console.error("BANK TABS FAILED", problems.slice(0, 10));
    process.exit(1);
  }
  if (process.env.SAVE_TO) fs.writeFileSync(process.env.SAVE_TO, Buffer.from(savedB.out));
  console.log("bank tabs OK");
}

// Applications: a submitted summer analyst application to a firm on no list makes it a tracked bank (tab, OVERVIEW row,
// COVERAGE rows with the applied office marked); an unsubmitted one adds nothing.
{
  const appsSheet = p.snapshots.find((s) => Object.values(s.cells).some((c) => /^program type$/i.test(c.v.trim())));
  if (appsSheet) {
    const { computeTabChanges } = await import("../src/lib/tabChanges");
    const { EMPTY_OPS } = await import("../src/lib/sheetOps");
    const { buildCoverage } = await import("../src/lib/coverage");
    const { readOfficeMap, setOfficeMap, findCoverageSheets } = await import("../src/lib/offices");
    const { DEFAULT_SETTINGS } = await import("../src/lib/defaults");
    const hasCoverage = findCoverageSheets(p.snapshots).length > 0;
    const head = Object.entries(appsSheet.cells).find(([, c]) => /^institution name$/i.test(c.v.trim()))!;
    const hr = Number(head[0].split(":")[0]);
    const col = (re: RegExp) => Number(Object.entries(appsSheet.cells).find(([k, c]) => Number(k.split(":")[0]) === hr && re.test(c.v.trim().toLowerCase()))![0].split(":")[1]);
    const c = { program: col(/^program/), name: col(/^institution name$/), type: col(/^institution type$/), submitted: col(/submitted/), loc: col(/target location/) };
    let free = hr + 1;
    while (appsSheet.cells[`${free}:${c.name}`]?.v.trim() || appsSheet.cells[`${free + 1}:${c.name}`]?.v.trim()) free++;
    const apps = {
      [appsSheet.name]: {
        [`${free}:${c.program}`]: { v: "Summer Analyst" },
        [`${free}:${c.name}`]: { v: "Intrepid Investment Bankers" },
        [`${free}:${c.type}`]: { v: "Investment Bank" },
        [`${free}:${c.submitted}`]: { v: "2026-10-04" },
        [`${free}:${c.loc}`]: { v: "LA" },
        [`${free + 1}:${c.program}`]: { v: "Summer Analyst" },
        [`${free + 1}:${c.name}`]: { v: "Not Submitted Capital" },
      },
    };
    // Typed left to right: the row counts as submitted once the date is in, and the location comes after.
    const loc = `${free}:${c.loc}`;
    const step1 = { [appsSheet.name]: Object.fromEntries(Object.entries(apps[appsSheet.name]).filter(([k]) => k !== loc)) };
    const banksFor = (q: { tables: typeof p.tables; targets: typeof p.targets }) =>
      buildCoverage({ contacts: p.contacts, tables: q.tables, targets: q.targets, coverage: { hidden: [], added: [], includeStarter: false }, banks: {}, followUp: DEFAULT_SETTINGS.followUp }).map((r) => ({ name: r.name, tier: r.tier, applied: r.applied }));
    setOfficeMap(readOfficeMap(p.snapshots));
    const live1 = parseSnapshots(applyPatches(p.snapshots, step1));
    const r1 = computeTabChanges({ snapshots: p.snapshots, patches: step1, contacts: p.contacts, tables: live1.tables, ops: EMPTY_OPS }, banksFor(live1));
    const after1 = mergePatches(mergePatches(r1.state.patches, r1.planPatches), { [appsSheet.name]: { [loc]: { v: "LA" } } });
    const live = parseSnapshots(applyPatches(r1.state.snapshots, after1));
    const intrepid = live.targets.find((t) => /intrepid/i.test(t.name));
    const r = computeTabChanges({ ...r1.state, patches: after1, tables: live.tables }, banksFor(live));
    r.changes.added.push(...r1.changes.added);
    r.changes.coverageRows.push(...r1.changes.coverageRows);
    const tab = r.changes.added.find((a) => /intrepid/i.test(a.bank))?.tab;
    console.log(`applications: Intrepid applied=${!!intrepid?.applied} tab=${tab}; COVERAGE rows for: ${r.changes.coverageRows.join(", ")}`);
    const saved = await parseWorkbook(await buildWorkbook(ab, mergePatches(r.state.patches, r.planPatches), [], r.state.ops));
    const map = readOfficeMap(saved.snapshots).get("intrepid investment bankers");
    const ov = saved.snapshots.find((s) => s.name === "OVERVIEW");
    const problems = [
      !intrepid?.applied && "the application wasn't read",
      live.targets.some((t) => /not submitted/i.test(t.name)) && "an unsubmitted application was counted",
      !tab && "no tab for Intrepid",
      tab && !saved.snapshots.some((s) => s.name === tab) && "Intrepid tab not saved",
      // Only workbooks with a COVERAGE tab get rows there.
      hasCoverage && !r.changes.coverageRows.some((x) => /intrepid/i.test(x)) && "Intrepid not added to COVERAGE",
      hasCoverage && map?.offices.LA?.hires !== true && `COVERAGE LA not "Yes" (${JSON.stringify(map?.offices)})`,
      hasCoverage && map?.offices.SF?.hires !== undefined && "COVERAGE SF should be unclear",
      ov && !Object.values(ov.cells).some((x) => /intrepid/i.test(x.v) && x.link) && "no linked OVERVIEW row",
    ].filter(Boolean);
    const savedBanks = buildCoverage({ contacts: saved.contacts, tables: saved.tables, targets: saved.targets, coverage: { hidden: [], added: [], includeStarter: false }, banks: {}, followUp: DEFAULT_SETTINGS.followUp }).map((x) => ({ name: x.name, tier: x.tier, applied: x.applied }));
    setOfficeMap(readOfficeMap(saved.snapshots));
    if (computeTabChanges({ snapshots: saved.snapshots, patches: {}, contacts: saved.contacts, tables: saved.tables, ops: EMPTY_OPS }, savedBanks).changed) problems.push("second run changes things");
    if (problems.length) {
      console.error("APPLICATIONS FAILED", problems);
      process.exit(1);
    }
    console.log("applications OK");
  }
}
