"use client";

import { blobs, useStore } from "./store";
import { allocateRow, applyPatches, buildWorkbook, contactPatches, detectRegion, locationTeamDropdowns, mergePatches, parseSnapshots, parseWorkbook, splitLocationTeamPatches, type Patches } from "./workbook";
import { locationForRegion, locationTeamOptions, normLocation, normTeam } from "./locationTeam";
import { reconcileTitle } from "./titles";
import { callApi } from "./api";
import { canWriteInPlace, ensureWritePermission, pickWorkbook, readFile, readHandle, writeToHandle } from "./files";
import { chunk, download, guessDomain, linkedinSlug, splitName, uid } from "./util";
import { canonBank, cleanBankName } from "./banks";
import { tabLink, tabLinkPatches } from "./sheetLinks";
import { EMPTY_OPS, planBankTabs } from "./bankTabs";
import { buildCoverage } from "./coverage";
import type { EnrichResult } from "@/app/api/enrich/route";
import type { CellRef, Contact, Prospect, Region, SheetSnapshot } from "./types";

export async function importFile(file: File, handle?: FileSystemFileHandle, opts: { keepManualEdits?: boolean; buffer?: ArrayBuffer } = {}) {
  const buf = opts.buffer ?? (await readFile(file));
  const parsed = await parseWorkbook(buf);
  await blobs.setWorkbook(buf);
  await blobs.setFileHandle(handle);
  const manual = useStore.getState().patches;
  const ops = useStore.getState().sheetOps;
  const r = useStore.getState().importWorkbook({
    meta: {
      fileName: file.name,
      loadedAt: new Date().toISOString(),
      sheetNames: parsed.snapshots.map((s) => s.name),
      hasHandle: !!handle,
      lastModified: file.lastModified,
    },
    contacts: parsed.contacts,
    tables: parsed.tables,
    snapshots: parsed.snapshots,
    targets: parsed.targets,
  });
  if (opts.keepManualEdits) useStore.setState({ patches: manual, sheetOps: ops });
  // Banks listed in the workbook (or added on /coverage) without a tab get one, with a linked OVERVIEW row.
  const tabs = ensureBankTabs();
  return { ...r, tabs };
}

/**
 * Give every bank on the coverage list that has no tab a new tab (a copy of a bank tab's layout, no people) and a
 * linked OVERVIEW row, as pending edits. Runs on every import, so banks added in Excel get tabs automatically.
 * `all` also includes banks whose auto-created tab was undone before. Also re-attaches pending tabs after a rebase.
 */
export function ensureBankTabs(opts: { all?: boolean } = {}) {
  const s = useStore.getState();
  if (!s.workbook || !s.snapshots.length) return [];
  let snaps = s.snapshots;
  const lost = (s.sheetOps?.clones ?? []).filter((c) => !snaps.some((x) => x.name === c.name));
  for (const c of lost) {
    const tpl = snaps.find((x) => x.name === c.from);
    if (tpl) snaps = insertAfter(snaps, { name: c.name, rows: tpl.rows, cols: tpl.cols, cells: {}, format: tpl.format }, c.after);
  }
  const banks = buildCoverage({
    contacts: s.contacts,
    tables: s.tables,
    targets: s.targets,
    coverage: { ...s.coverage, plan: undefined, includeStarter: false },
    banks: s.banks,
    followUp: s.settings.followUp,
  }).filter((r) => r.bucket !== "hidden");
  const plan = planBankTabs({ snaps: applyPatches(snaps, s.patches), tables: s.tables, banks, skip: opts.all ? [] : s.coverage.skipTabs });
  if (!lost.length && !plan.added.length) return [];
  plan.ops.clones.forEach((c, i) => (snaps = insertAfter(snaps, plan.snapshots[i], c.after)));
  // Show the new OVERVIEW rows with the look they'll have in Excel.
  for (const x of plan.ops.rowStyles)
    snaps = snaps.map((sn) => {
      if (sn.name !== x.sheet || !sn.format) return sn;
      const cellStyle = { ...sn.format.cellStyle };
      for (let c = 1; c <= sn.cols; c++) {
        const st = sn.format.cellStyle[`${x.from}:${c}`];
        if (st !== undefined) cellStyle[`${x.row}:${c}`] = st;
      }
      const rowHeights = { ...sn.format.rowHeights };
      if (rowHeights[x.from]) rowHeights[x.row] = rowHeights[x.from];
      return { ...sn, format: { ...sn.format, cellStyle, rowHeights } };
    });
  const ops = s.sheetOps ?? EMPTY_OPS;
  useStore.setState({ snapshots: snaps, sheetOps: { clones: [...ops.clones, ...plan.ops.clones], rowStyles: [...ops.rowStyles, ...plan.ops.rowStyles] } });
  void blobs.setSnapshots(snaps);
  if (plan.added.length) useStore.getState().applyCellEdits(plan.patches);
  return plan.added;
}

function insertAfter(list: SheetSnapshot[], item: SheetSnapshot, after?: string) {
  const i = after ? list.findIndex((x) => x.name === after) : -1;
  return i < 0 ? [...list, item] : [...list.slice(0, i + 1), item, ...list.slice(i + 1)];
}

/** Drop the pending new tabs and their OVERVIEW rows, and don't create them automatically again. */
export function undoBankTabs() {
  const s = useStore.getState();
  const ops = s.sheetOps ?? EMPTY_OPS;
  if (!ops.clones.length) return 0;
  const gone = new Set(ops.clones.map((c) => c.name));
  const rows = new Map<string, Set<number>>();
  for (const x of ops.rowStyles) (rows.get(x.sheet) ?? rows.set(x.sheet, new Set()).get(x.sheet)!).add(x.row);
  const patches: Patches = {};
  for (const [sheet, cells] of Object.entries(s.patches)) {
    if (gone.has(sheet)) continue;
    const keep = Object.entries(cells).filter(([k, p]) => {
      if (rows.get(sheet)?.has(Number(k.split(":")[0]))) return false;
      // A link to a removed tab (an OVERVIEW name that was already listed).
      return !(p.link && [...gone].some((t) => p.link === tabLink(t)));
    });
    if (keep.length) patches[sheet] = Object.fromEntries(keep);
  }
  const skip = [...new Set([...(s.coverage.skipTabs ?? []), ...ops.clones.map((c) => canonBank(c.bank))])];
  const snapshots = s.snapshots.filter((x) => !gone.has(x.name));
  const parsed = parseSnapshots(applyPatches(snapshots, patches));
  useStore.setState({ snapshots, patches, tables: parsed.tables, sheetOps: EMPTY_OPS, coverage: { ...s.coverage, skipTabs: skip }, gridUndo: [] });
  void blobs.setSnapshots(snapshots);
  return gone.size;
}

/** Returns true if a file was chosen via the native picker; false means fall back to <input type=file>. */
export async function pickAndImport(): Promise<{ added: number; updated: number } | "fallback" | null> {
  if (!canWriteInPlace()) return "fallback";
  const picked = await pickWorkbook();
  if (!picked) return null;
  return importFile(picked.file, picked.handle, { buffer: picked.buffer });
}

export function currentPatches() {
  const s = useStore.getState();
  return mergePatches(contactPatches(s.contacts, s.snapshots), s.patches);
}

export async function saveWorkbook(mode: "in-place" | "download") {
  const s = useStore.getState();
  if (!s.workbook) throw new Error("Upload a spreadsheet first.");
  let rebased = false;
  const handle = mode === "in-place" ? await blobs.fileHandle() : undefined;
  if (mode === "in-place") {
    if (!handle) throw new Error("This browser can't save in place — use Download instead.");
    // If the file was edited in Excel / synced by OneDrive since we read it, rebase onto the disk
    // version first so those edits aren't overwritten. Dashboard changes are re-applied on top.
    await ensureWritePermission(handle);
    const disk = await readHandle(handle);
    if (s.workbook.lastModified && disk.file.lastModified !== s.workbook.lastModified) {
      await importFile(disk.file, handle, { keepManualEdits: true, buffer: disk.buffer });
      rebased = true;
    }
  }
  const buf = await blobs.workbook();
  if (!buf) throw new Error("Upload a spreadsheet first.");
  const now = useStore.getState();
  const dropdowns = locationTeamDropdowns(now.tables, locationTeamOptions(now.contacts));
  // New tabs whose content was undone (grid Ctrl+Z) aren't created empty.
  const pending = currentPatches();
  const ops = now.sheetOps ?? EMPTY_OPS;
  const out = await buildWorkbook(buf, pending, dropdowns, { ...ops, clones: ops.clones.filter((c) => pending[c.name]) });
  let name: string;
  const cur = useStore.getState().workbook!;
  if (mode === "in-place") {
    await writeToHandle(handle!, out);
    name = cur.fileName;
  } else {
    name = cur.fileName.replace(/\.xlsx$/i, "") + " (updated).xlsx";
    download(out, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  // The saved file is the new baseline: pending-change highlights clear.
  const parsed = await parseWorkbook(out);
  await blobs.setWorkbook(out);
  await blobs.setSnapshots(parsed.snapshots);
  const lastModified = mode === "in-place" && handle ? (await readHandle(handle)).file.lastModified : cur.lastModified;
  useStore.setState({
    snapshots: parsed.snapshots,
    tables: parsed.tables,
    targets: parsed.targets,
    patches: {},
    sheetOps: EMPTY_OPS,
    gridUndo: [],
    workbook: { ...cur, sheetNames: parsed.snapshots.map((x) => x.name), lastModified },
  });
  return { name, rebased };
}

export async function enrichContacts(ids: string[], onProgress?: (done: number, total: number) => void) {
  const s = useStore.getState();
  const targets = s.contacts.filter((c) => ids.includes(c.id) && !c.email && (c.linkedin || (c.firstName && c.lastName)));
  let found = 0;
  let done = 0;
  const errors: string[] = [];
  for (const batch of chunk(targets, 10)) {
    try {
      const { results } = await callApi<{ results: EnrichResult[] }>(
        "/api/enrich",
        {
          revealPersonal: s.settings.enrich.revealPersonalEmails,
          contacts: batch.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            name: c.name,
            bank: c.bank,
            domain: s.banks[`${c.bank}|${c.region}`]?.domain || guessDomain(c.bank),
            linkedin: c.linkedin || undefined,
            region: c.region,
            location: c.location || undefined,
          })),
        },
        useStore.getState().settings,
      );
      const now = new Date().toISOString();
      useStore.getState().updateContacts(
        results.map((r) => {
          const c = batch.find((b) => b.id === r.id)!;
          if (r.email) found++;
          return {
            id: r.id,
            patch: {
              ...(r.email ? { email: r.email, emailSource: r.source ?? undefined, emailStatus: r.emailStatus } : {}),
              linkedin: c.linkedin || r.linkedin || "",
              position: c.position || r.title || "",
              headline: r.headline ?? c.headline,
            },
            event: { at: now, type: "enriched" as const, note: r.email ? `Email found via ${r.source}` : r.note },
          };
        }),
      );
    } catch (e) {
      errors.push((e as Error).message);
      if (/key|401|403/i.test((e as Error).message)) break;
    }
    done += batch.length;
    onProgress?.(done, targets.length);
  }
  return { attempted: targets.length, found, errors };
}

export function addProspects(list: Prospect[], toSheet: boolean) {
  const s = useStore.getState();
  const taken = new Set(s.contacts.filter((c) => c.ref).map((c) => `${c.ref!.sheet}:${c.ref!.row}`));
  const existingSlugs = new Set(s.contacts.map((c) => c.linkedin.toLowerCase()).filter(Boolean));
  const contacts: Contact[] = [];
  for (const p of list) {
    if (p.linkedin && existingSlugs.has(p.linkedin.toLowerCase())) continue;
    const { first, last } = splitName(p.name);
    const region = p.region ?? "Other";
    const ref = toSheet && s.workbook ? allocateRow(p.bank, s.tables, taken) : undefined;
    if (ref) taken.add(`${ref.sheet}:${ref.row}`);
    contacts.push({
      id: uid("c"),
      name: p.name,
      firstName: p.firstName || first,
      lastName: p.lastName || last,
      bank: p.bank,
      region,
      location: locationForRegion("", region, detectRegion),
      team: p.team ? normTeam(p.team) : undefined,
      position: reconcileTitle(p.title, p.position) || p.title,
      email: "",
      linkedin: p.linkedin,
      comment: [p.school, p.reasons].filter(Boolean).join(" — "),
      school: p.school,
      headline: p.title,
      status: "new",
      source: "prospect",
      ref,
      followUps: 0,
      history: [{ at: new Date().toISOString(), type: "note", note: `Added from ${p.source} search` }],
    });
  }
  s.addContacts(contacts);
  return contacts;
}

export interface NewContact {
  name: string;
  bank: string;
  linkedin: string;
  email: string;
  position: string;
  location: string;
  team: string;
  region: Region;
  comment: string;
}

/** Add one person by hand from the contacts list; with a workbook loaded they get a row on the bank's tab. */
export function addManualContact(input: NewContact, toSheet: boolean, row?: CellRef): Contact {
  const s = useStore.getState();
  const name = input.name.trim().replace(/\s+/g, " ");
  const bank = input.bank.trim();
  const linkedin = input.linkedin.trim();
  const email = input.email.trim();
  if (!name || !bank) throw new Error("Name and bank are required.");
  if (linkedin && !/linkedin\.com\/in\//i.test(linkedin)) throw new Error("That LinkedIn link should look like linkedin.com/in/…");
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("That email address doesn't look right.");
  // Never re-contact anyone: duplicates by email, LinkedIn slug, or name + bank.
  const slug = linkedin ? linkedinSlug(linkedin) : "";
  const dup = s.contacts.find(
    (c) =>
      (email && c.email.toLowerCase() === email.toLowerCase()) ||
      (slug && linkedinSlug(c.linkedin) === slug) ||
      (c.name.toLowerCase() === name.toLowerCase() && canonBank(c.bank) === canonBank(bank)),
  );
  if (dup) throw new Error(`${dup.name} (${dup.bank}) is already in your contacts${dup.sentAt || dup.status !== "new" ? `, status ${dup.status.replace("_", " ")}` : ""}.`);

  const taken = new Set(s.contacts.filter((c) => c.ref).map((c) => `${c.ref!.sheet}:${c.ref!.row}`));
  // A grid row turned into a contact keeps pointing at that row; otherwise take the bank's next free slot.
  const ref = row ?? (toSheet && s.workbook ? allocateRow(bank, s.tables, taken) : undefined);
  const { first, last } = splitName(name);
  const contact: Contact = {
    id: uid("c"),
    name,
    firstName: first,
    lastName: last,
    bank,
    region: input.region,
    location: locationForRegion(normLocation(input.location), input.region, detectRegion),
    team: input.team.trim() ? normTeam(input.team) : undefined,
    position: input.position.trim(),
    email,
    emailSource: email ? "manual" : undefined,
    linkedin,
    comment: input.comment.trim(),
    status: "new",
    source: "manual",
    ref,
    followUps: 0,
    history: [{ at: new Date().toISOString(), type: "note", note: "Added by hand" }],
  };
  s.addContacts([contact]);
  return contact;
}

/** Split every combined "Location/Team" column into Location + Team (as unsaved edits you can review in the grid). */
/** Links between tabs that an older save stripped (OVERVIEW ↔ bank tabs), as pending cell edits to review and save. */
export function restorableTabLinks(snapshots: SheetSnapshot[], patches: Patches) {
  return tabLinkPatches(applyPatches(snapshots, patches), (n) => canonBank(cleanBankName(n)));
}

export function restoreTabLinks() {
  const s = useStore.getState();
  const { patches, count } = restorableTabLinks(s.snapshots, s.patches);
  if (count) s.applyCellEdits(patches);
  return count;
}

export function splitLocationTeamColumns() {
  const s = useStore.getState();
  const { patches, tables } = splitLocationTeamPatches(s.snapshots, s.tables);
  if (tables) s.applyCellEdits(patches);
  return tables;
}
