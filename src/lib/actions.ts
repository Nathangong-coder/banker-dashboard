"use client";

import { blobs, useStore } from "./store";
import { allocateRow, buildWorkbook, contactPatches, mergePatches, parseWorkbook, withRegionTag } from "./workbook";
import { callApi } from "./api";
import { canWriteInPlace, pickWorkbook, writeToHandle } from "./files";
import { chunk, download, guessDomain, splitName, uid } from "./util";
import type { EnrichResult } from "@/app/api/enrich/route";
import type { Contact, Prospect } from "./types";

export async function importFile(file: File, handle?: FileSystemFileHandle) {
  const buf = await file.arrayBuffer();
  const parsed = await parseWorkbook(buf);
  await blobs.setWorkbook(buf);
  await blobs.setFileHandle(handle);
  return useStore.getState().importWorkbook({
    meta: {
      fileName: file.name,
      loadedAt: new Date().toISOString(),
      sheetNames: parsed.snapshots.map((s) => s.name),
      hasHandle: !!handle,
    },
    contacts: parsed.contacts,
    tables: parsed.tables,
    snapshots: parsed.snapshots,
  });
}

/** Returns true if a file was chosen via the native picker; false means fall back to <input type=file>. */
export async function pickAndImport(): Promise<{ added: number; updated: number } | "fallback" | null> {
  if (!canWriteInPlace()) return "fallback";
  const picked = await pickWorkbook();
  if (!picked) return null;
  return importFile(picked.file, picked.handle);
}

export function currentPatches() {
  const s = useStore.getState();
  return mergePatches(contactPatches(s.contacts, s.snapshots), s.patches);
}

export async function saveWorkbook(mode: "in-place" | "download") {
  const s = useStore.getState();
  const buf = await blobs.workbook();
  if (!buf || !s.workbook) throw new Error("Upload a spreadsheet first.");
  const out = await buildWorkbook(buf, currentPatches());
  let name: string;
  if (mode === "in-place") {
    const handle = await blobs.fileHandle();
    if (!handle) throw new Error("This browser can't save in place — use Download instead.");
    await writeToHandle(handle, out);
    name = s.workbook.fileName;
  } else {
    name = s.workbook.fileName.replace(/\.xlsx$/i, "") + " (updated).xlsx";
    download(out, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  // The saved file is the new baseline: pending-change highlights clear.
  const parsed = await parseWorkbook(out);
  await blobs.setWorkbook(out);
  await blobs.setSnapshots(parsed.snapshots);
  useStore.setState({
    snapshots: parsed.snapshots,
    tables: parsed.tables,
    patches: {},
    workbook: { ...s.workbook, sheetNames: parsed.snapshots.map((x) => x.name) },
  });
  return name;
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
