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
import { computeTabChanges, describeTabChanges, type TabChanges } from "./tabChanges";
import { planBankTabs } from "./bankTabs";
import { EMPTY_OPS, opsOf } from "./sheetOps";
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

export type { TabChanges };
export { describeTabChanges };

type TabUndo = { state: Pick<ReturnType<typeof useStore.getState>, "patches" | "snapshots" | "sheetOps" | "contacts" | "tables">; skip: string[] };
// The state before the last automatic tab change (this session), so Undo can put everything back.
let tabUndo: TabUndo | null = null;

/** The banks on the coverage list (hidden ones flagged), for tab planning. */
function listedBanks() {
  const s = useStore.getState();
  return buildCoverage({
    contacts: s.contacts,
    tables: s.tables,
    targets: s.targets,
    coverage: { ...s.coverage, plan: undefined, includeStarter: false },
    banks: s.banks,
    followUp: s.settings.followUp,
  }).map((r) => ({ name: r.name, tier: r.tier, hidden: r.bucket === "hidden", applied: r.applied }));
}

/** Banks on the coverage list with no tab that won't get one automatically, and why (for the Spreadsheet page). */
export function bankTabsSkipped() {
  const s = useStore.getState();
  if (!s.workbook || !s.snapshots.length) return [];
  return planBankTabs({ snaps: applyPatches(s.snapshots, s.patches), tables: s.tables, banks: listedBanks(), skip: s.coverage.skipTabs }).skipped;
}

/**
 * Keep the workbook's bank tabs complete, as pending edits (runs on every import, so banks added in Excel get tabs):
 * ticker names for tabs this app made, malformed bank tabs rebuilt, a tab for every bank on the coverage list, and
 * every bank tab on OVERVIEW (lib/tabChanges.ts). `all` also includes banks whose new tab was undone before.
 */
export function ensureBankTabs(opts: { all?: boolean } = {}): TabChanges {
  const s = useStore.getState();
  if (!s.workbook || !s.snapshots.length) return { added: [], renamed: [], repaired: [], listed: [], coverageRows: [], skipped: [] };
  const before: TabUndo["state"] = { patches: s.patches, snapshots: s.snapshots, sheetOps: s.sheetOps, contacts: s.contacts, tables: s.tables };
  const r = computeTabChanges(
    { snapshots: s.snapshots, patches: s.patches, contacts: s.contacts, tables: s.tables, ops: opsOf(s.sheetOps) },
    listedBanks(),
    opts.all ? [] : s.coverage.skipTabs,
  );
  if (!r.changed) return r.changes;
  const { snapshots, patches, contacts, tables, ops } = r.state;
  useStore.setState({ snapshots, patches, contacts, tables, sheetOps: ops });
  void blobs.setSnapshots(snapshots);
  if (Object.keys(r.planPatches).length) useStore.getState().applyCellEdits(r.planPatches);
  const c = r.changes;
  if (c.added.length || c.renamed.length || c.repaired.length || c.listed.length || c.coverageRows.length) tabUndo = { state: before, skip: r.undoSkip };
  return c;
}

/**
 * After edits on an applications tab: re-read the firm lists (a newly submitted summer analyst application adds its
 * firm), then keep tabs / OVERVIEW / COVERAGE up to date. Returns what changed (nothing if the lists didn't).
 */
export function syncApplications(): TabChanges | undefined {
  const s = useStore.getState();
  if (!s.workbook || !s.snapshots.length) return undefined;
  const { targets } = parseSnapshots(applyPatches(s.snapshots, s.patches));
  const sig = (list: typeof targets) =>
    JSON.stringify(list.map((t) => [canonBank(t.name), t.tier, (t.applied ?? []).map((a) => [a.program, a.submitted, a.status, a.location])]).sort());
  if (sig(targets) === sig(s.targets)) return undefined;
  useStore.setState({ targets });
  return ensureBankTabs();
}

/**
 * Undo the last automatic tab change (new tabs, renames, rebuilt tabs, OVERVIEW rows): everything goes back to how
 * it was, and those banks don't get new tabs automatically again. After a page reload only new tabs can be removed;
 * re-import the file to discard the rest.
 */
export function undoBankTabs() {
  const s = useStore.getState();
  if (tabUndo) {
    const { state, skip } = tabUndo;
    tabUndo = null;
    useStore.setState({ ...state, coverage: { ...s.coverage, skipTabs: [...new Set([...(s.coverage.skipTabs ?? []), ...skip])] }, gridUndo: [] });
    void blobs.setSnapshots(state.snapshots);
    return true;
  }
  const ops = opsOf(s.sheetOps);
  if (!ops.clones.length) return false;
  const gone = new Set(ops.clones.map((c) => c.name));
  const rows = new Map<string, Set<number>>();
  for (const x of ops.rowStyles) (rows.get(x.sheet) ?? rows.set(x.sheet, new Set()).get(x.sheet)!).add(x.row);
  const patches: Patches = {};
  for (const [sheet, cells] of Object.entries(s.patches)) {
    if (gone.has(sheet)) continue;
    const keep = Object.entries(cells).filter(([k, p]) => !rows.get(sheet)?.has(Number(k.split(":")[0])) && !(p.link && [...gone].some((t) => p.link === tabLink(t))));
    if (keep.length) patches[sheet] = Object.fromEntries(keep);
  }
  const skipTabs = [...new Set([...(s.coverage.skipTabs ?? []), ...ops.clones.map((c) => canonBank(c.bank))])];
  const snapshots = s.snapshots.filter((x) => !gone.has(x.name));
  useStore.setState({
    snapshots,
    patches,
    tables: parseSnapshots(applyPatches(snapshots, patches)).tables,
    sheetOps: { ...ops, clones: [], rowStyles: [] },
    coverage: { ...s.coverage, skipTabs },
    gridUndo: [],
  });
  void blobs.setSnapshots(snapshots);
  return true;
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
