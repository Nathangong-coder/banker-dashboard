"use client";

import { blobs, useStore } from "./store";
import { allocateRow, buildWorkbook, contactPatches, mergePatches, parseWorkbook, withRegionTag } from "./workbook";
import { callApi } from "./api";
import { canWriteInPlace, ensureWritePermission, pickWorkbook, readFile, readHandle, writeToHandle } from "./files";
import { chunk, download, guessDomain, splitName, uid } from "./util";
import type { EnrichResult } from "@/app/api/enrich/route";
import type { Contact, Prospect } from "./types";

export async function importFile(file: File, handle?: FileSystemFileHandle, opts: { keepManualEdits?: boolean; buffer?: ArrayBuffer } = {}) {
  const buf = opts.buffer ?? (await readFile(file));
  const parsed = await parseWorkbook(buf);
  await blobs.setWorkbook(buf);
  await blobs.setFileHandle(handle);
  const manual = useStore.getState().patches;
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
  if (opts.keepManualEdits) useStore.setState({ patches: manual });
  return r;
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
  const out = await buildWorkbook(buf, currentPatches());
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
      location: withRegionTag(p.team ?? "", region),
      position: p.position || p.title,
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
