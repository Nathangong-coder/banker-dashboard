/**
 * Tracked jobs → the workbook's applications tab (owner, 2026-10-26: "store it into my excel"). Pure: no store, so
 * `npm run check:jobs` covers it.
 *
 * The tab is any sheet with an "Institution Name" + "Program (Type)" header row (the owner's `APP ('27)`: # | Program
 * Type | Institution Name | Institution Type | Application Link | Application Open Date | Application Submitted
 * Date | Application Status | Target Location). Each job on My list gets a row (`JobApplication.sheetRef`, assigned
 * once and kept): the existing row with the same firm + program, else the first numbered row with no firm, else a
 * new numbered row right under the list. Writes are derived patches, like contact write-backs: pending until Save,
 * and a cell already saying the same thing is never rewritten.
 */
import { canonBank } from "./banks";
import type { JobApplication, JobStatus } from "./apply";
import type { CellPatch, Patches } from "./workbook";
import type { SheetSnapshot } from "./types";

export interface AppsTable {
  sheet: string;
  header: number;
  cols: {
    num?: number;
    program: number;
    name: number;
    type?: number;
    link?: number;
    submitted?: number;
    status?: number;
    location?: number;
  };
  /** Data rows: from the row under the header to the last row with a number or a firm. */
  last: number;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The applications tab's header row and columns, or null when the workbook has none. */
export function findAppsTable(snapshots: SheetSnapshot[]): AppsTable | null {
  for (const snap of snapshots) {
    const rows = new Map<number, Map<number, string>>();
    for (const [k, cell] of Object.entries(snap.cells)) {
      const [r, c] = k.split(":").map(Number);
      if (r > 40) continue;
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r)!.set(c, norm(cell.v));
    }
    for (const r of [...rows.keys()].sort((a, b) => a - b)) {
      const row = [...rows.get(r)!.entries()];
      const col = (re: RegExp) => row.find(([, t]) => re.test(t))?.[0];
      const name = col(/^institution name$|^(firm|company)( name)?$/);
      const program = col(/^program( type)?$/);
      if (!name || !program) continue;
      const cols = {
        num: col(/^#$/),
        program,
        name,
        type: col(/^institution type$|^(firm|company) type$/),
        link: col(/application link|^link$/),
        submitted: col(/submitted/),
        status: col(/application\s*status|^status$/),
        location: col(/target location|^location$/),
      };
      let last = r;
      for (let rr = r + 1; rr <= snap.rows; rr++) {
        const has = (c?: number) => !!c && !!(snap.cells[`${rr}:${c}`]?.v ?? "").trim();
        if (has(cols.num) || has(cols.name)) last = rr;
        else if (rr - last > 3) break;
      }
      return { sheet: snap.name, header: r, cols, last };
    }
  }
  return null;
}

/** The owner's status words. Saved / in progress = nothing written (you haven't applied yet). */
const STATUS_TEXT: Record<JobStatus, string> = {
  saved: "",
  applying: "",
  submitted: "IN PROCESS",
  interview: "INTERVIEWING",
  offer: "OFFER",
  rejected: "REJECTED",
  withdrawn: "WITHDRAWN",
};
/** How far along a status cell is: a status is only ever moved forward, and words the dashboard doesn't know are left alone. */
function statusRank(text: string): number {
  const t = norm(text);
  if (!t) return 0;
  if (/^(in process|in progress|submitted|applied|pending)$/.test(t)) return 1;
  if (/^interview/.test(t)) return 2;
  if (/^(offer|rejected|withdrawn)$/.test(t)) return 3;
  return 99;
}

const usDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

/**
 * A row for each My list job without one: the same firm + program already on the tab, else a free numbered row, else
 * the next row under the list. Returns only the jobs that got a row (id → ref).
 */
export function assignJobRows(jobs: JobApplication[], snapshots: SheetSnapshot[]): Map<string, { sheet: string; row: number }> {
  const out = new Map<string, { sheet: string; row: number }>();
  const t = findAppsTable(snapshots);
  if (!t) return out;
  const snap = snapshots.find((s) => s.name === t.sheet)!;
  const get = (r: number, c?: number) => (c ? (snap.cells[`${r}:${c}`]?.v ?? "").trim() : "");
  const taken = new Set(jobs.filter((j) => j.sheetRef?.sheet === t.sheet).map((j) => j.sheetRef!.row));
  let next = t.last + 1;
  for (const j of jobs) {
    if (j.addedBy === "ai" || j.sheetRef) continue;
    let row: number | undefined;
    for (let r = t.header + 1; r <= t.last && !row; r++) {
      if (taken.has(r)) continue;
      const firm = get(r, t.cols.name);
      if (firm && canonBank(firm) === canonBank(j.company) && norm(get(r, t.cols.program)) === norm(j.role)) row = r;
    }
    for (let r = t.header + 1; r <= t.last && !row; r++) if (!taken.has(r) && !get(r, t.cols.name) && (!t.cols.num || /^\d+$/.test(get(r, t.cols.num)))) row = r;
    if (!row) {
      while (taken.has(next)) next++;
      row = next++;
    }
    taken.add(row);
    out.set(j.id, { sheet: t.sheet, row });
  }
  return out;
}

/** Cell writes for My list jobs that have a row. Empty cells are filled; status / submitted date only move forward. */
export function jobPatches(jobs: JobApplication[], snapshots: SheetSnapshot[], tierOf: (company: string) => string | undefined = () => undefined): Patches {
  const out: Patches = {};
  const t = findAppsTable(snapshots);
  if (!t) return out;
  const snap = snapshots.find((s) => s.name === t.sheet)!;
  const cell = (r: number, c?: number) => (c ? (snap.cells[`${r}:${c}`]?.v ?? "").trim() : "");
  const put = (r: number, c: number | undefined, p: CellPatch) => {
    if (!c || cell(r, c) === p.v) return;
    (out[t.sheet] ??= {})[`${r}:${c}`] = p;
  };
  /** Only into an empty cell: what you typed in Excel wins. */
  const fill = (r: number, c: number | undefined, p: CellPatch) => c && !cell(r, c) && p.v && put(r, c, p);
  // A new row under the list gets the next number.
  let maxNum = 0;
  if (t.cols.num) for (let r = t.header + 1; r <= t.last; r++) maxNum = Math.max(maxNum, Number(cell(r, t.cols.num)) || 0);
  for (const j of [...jobs].sort((a, b) => (a.sheetRef?.row ?? 0) - (b.sheetRef?.row ?? 0))) {
    const ref = j.sheetRef;
    if (j.addedBy === "ai" || !ref || ref.sheet !== t.sheet) continue;
    const r = ref.row;
    // The row now holds a different firm (edited in Excel): leave it alone.
    const firm = cell(r, t.cols.name);
    if (firm && canonBank(firm) !== canonBank(j.company)) continue;
    if (t.cols.num && !cell(r, t.cols.num) && r > t.last) put(r, t.cols.num, { v: String(++maxNum) });
    fill(r, t.cols.name, { v: j.company });
    fill(r, t.cols.program, { v: j.role });
    fill(r, t.cols.type, { v: tierOf(j.company) ?? "" });
    const link = (/^https:\/\//.test(j.applyUrl ?? "") ? j.applyUrl : /^https:\/\//.test(j.url) ? j.url : "") ?? "";
    if (link) fill(r, t.cols.link, { v: link, link });
    fill(r, t.cols.location, { v: j.location ?? "" });
    const want = STATUS_TEXT[j.status];
    const have = cell(r, t.cols.status);
    if (want && statusRank(have) < statusRank(want)) put(r, t.cols.status, { v: want });
    if (j.submittedAt && j.status !== "saved" && j.status !== "applying") fill(r, t.cols.submitted, { v: usDate(j.submittedAt) });
  }
  return out;
}

/** "Bulge Bracket" etc. for the Institution Type column, from your workbook's lists. */
export function tierLookup(targets: { name: string; tier?: string }[]): (company: string) => string | undefined {
  const m = new Map(targets.filter((t) => t.tier).map((t) => [canonBank(t.name), t.tier!]));
  return (company) => m.get(canonBank(company));
}
