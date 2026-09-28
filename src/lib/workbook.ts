"use client";

import type { Workbook, CellValue } from "exceljs";
import type { CellRef, Contact, ContactField, Region, SheetSnapshot, Status } from "./types";
import { contactId, splitName } from "./util";
import { DEFAULT_TIERS, canonBank, cleanBankName, normalizeTier, type TargetBank } from "./banks";
import { DEFAULT_TEAMS, isPlace, joinLocationTeam, readLocationTeam, splitLocationTeam } from "./locationTeam";

const MAX_ROWS = 1500;
const MAX_COLS = 40;

export interface ContactTable {
  sheet: string;
  bank: string;
  headerRow: number;
  lastRow: number;
  cols: Partial<Record<ContactField, number>>;
  firstNameCol?: number;
  lastNameCol?: number;
  /** Rows inside the table that have no name yet (e.g. pre-numbered blank rows). */
  emptyRows: number[];
}

export interface ParsedWorkbook {
  snapshots: SheetSnapshot[];
  tables: ContactTable[];
  contacts: Contact[];
  /** Firms listed on overview/target-list tabs (used to spot banks with zero contacts). */
  targets: TargetBank[];
}

async function loadExcel() {
  const mod = await import("exceljs");
  return (mod.default ?? mod) as typeof import("exceljs");
}

export function cellText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("text" in v && v.text !== undefined) return cellText(v.text as CellValue);
    if ("result" in v) return cellText(v.result as CellValue);
    if ("error" in v) return "";
  }
  return String(v);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const HEADERS: Record<ContactField | "first" | "last", string[]> = {
  name: ["name", "full name", "contact name", "contact"],
  first: ["first name", "first"],
  last: ["last name", "last", "surname"],
  email: ["email", "email address", "e-mail", "work email"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile", "profile url"],
  position: ["position", "title", "role", "job title"],
  location: ["location/team", "location / team", "location", "city", "office"],
  team: ["team", "group", "coverage group", "industry group", "coverage"],
  status: ["status"],
  comment: ["connection / comment", "connection/comment", "comments", "comment", "notes", "note"],
  company: ["company", "firm", "bank", "institution", "organization", "institution name"],
};

function matchHeaders(row: Map<number, string>) {
  const found: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (const key of Object.keys(HEADERS) as (keyof typeof HEADERS)[]) {
    // Priority order: first synonym that appears wins.
    for (const syn of HEADERS[key]) {
      for (const [col, text] of row) {
        if (norm(text) === syn && !Object.values(found).includes(col)) {
          found[key] = col;
          break;
        }
      }
      if (found[key]) break;
    }
  }
  const hasName = found.name !== undefined || (found.first !== undefined && found.last !== undefined);
  const ok = hasName && (found.email !== undefined || found.linkedin !== undefined);
  return ok ? found : null;
}

export function detectRegion(...hints: (string | undefined)[]): Region {
  const text = hints.filter(Boolean).join(" ");
  if (/\b(NY|NYC|New York|Manhattan|Brooklyn)\b/i.test(text)) return "NY";
  if (/\b(SF|San Francisco|Menlo|Palo Alto|Bay Area|California|Los Angeles|LA|Silicon Valley|CA)\b/i.test(text))
    return "SF";
  return "Other";
}

export function statusFromSheet(raw: string | undefined): Status {
  const s = norm(raw ?? "");
  if (!s) return "new";
  if (/moved on|ignore|dead|no response/.test(s)) return "ignored";
  if (/call|scheduled|coffee|meeting/.test(s)) return "call_scheduled";
  if (/repl|respond|responded/.test(s)) return "replied";
  if (/follow/.test(s)) return "followed_up";
  if (/sent|emailed|contacted|messaged/.test(s)) return "sent";
  if (/draft/.test(s)) return "drafted";
  if (/done|complete/.test(s)) return "done";
  return "new"; // "Pending", "*", etc. = queued, not yet sent
}

export const STATUS_TO_SHEET: Record<Status, (c: Contact) => string> = {
  new: (c) => c.sheetStatus ?? "",
  drafted: () => "Drafted",
  sent: () => "Sent",
  followed_up: (c) => `Followed up (${c.followUps}x)`,
  replied: () => "Replied",
  call_scheduled: () => "Call scheduled",
  done: () => "Done",
  ignored: () => "Moved on",
};

/**
 * SF and NY people share one bank tab; the Location/Team column is the source of truth.
 * Legacy "(NY)" tabs still work as a fallback.
 */
function regionFor(sheetIsNY: boolean, location: string, company?: string): Region {
  const r = detectRegion(location);
  if (r !== "Other") return r;
  if (sheetIsNY) return "NY";
  // Bank tracker tabs default to the West Coast; generic lists stay unassigned.
  return company ? "Other" : "SF";
}

function sheetBankName(sheetName: string, title: string): string {
  const m = title.match(/^(.*?)\s+Application Tracker/i);
  const base = (m ? m[1] : sheetName).replace(/\(NY\)/i, "").trim();
  return base || sheetName;
}

/** Section labels inside bank tabs ("Contact | Information") that sit in the Name column but aren't people. */
const SECTION_LABEL = /^(contact|contacts|name|information|#)$/i;

export async function parseWorkbook(buffer: ArrayBuffer): Promise<ParsedWorkbook> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return parseLoaded(wb);
}

function parseLoaded(wb: Workbook): ParsedWorkbook {
  const snapshots: SheetSnapshot[] = [];
  wb.eachSheet((ws) => {
    const cells: SheetSnapshot["cells"] = {};
    let maxR = 0;
    let maxC = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > MAX_ROWS) return;
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (c > MAX_COLS) return;
        const v = cellText(cell.value).trim();
        const hl =
          cell.hyperlink ||
          (typeof cell.value === "object" && cell.value && "hyperlink" in cell.value
            ? (cell.value as { hyperlink: string }).hyperlink
            : undefined);
        if (!v && !hl) return;
        cells[`${r}:${c}`] = hl ? { v, link: hl } : { v };
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      });
    });
    snapshots.push({ name: ws.name, rows: maxR, cols: maxC, cells });
  });
  return { snapshots, ...parseSnapshots(snapshots) };
}

/** Find contact tables, contacts and target lists in already-read sheets (also used live on grid edits). */
export function parseSnapshots(snapshots: SheetSnapshot[]): Omit<ParsedWorkbook, "snapshots"> {
  const tables: ContactTable[] = [];
  const targets: TargetBank[] = [];
  const contacts: Contact[] = [];

  for (const ws of snapshots) {
    const cells = ws.cells;
    const rowText = new Map<number, Map<number, string>>();
    let maxR = 0;
    // Row-major order, like reading the sheet (header matching takes the leftmost synonym).
    const entries = Object.entries(cells).map(([addr, cell]) => [...addr.split(":").map(Number), cell.v] as [number, number, string]);
    entries.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [r, c, v] of entries) {
      if (!rowText.has(r)) rowText.set(r, new Map());
      rowText.get(r)!.set(c, v);
      maxR = Math.max(maxR, r);
    }
    targets.push(...extractTargets(ws.name, cells, rowText, maxR));

    const title = cells["1:1"]?.v ?? "";
    const bank = sheetBankName(ws.name, title);
    const sheetIsNY = /\(NY\)/i.test(ws.name) || /\(NY\)/i.test(title);

    // Find header rows.
    const headerRows: { r: number; h: NonNullable<ReturnType<typeof matchHeaders>> }[] = [];
    for (const [r, row] of [...rowText.entries()].sort((a, b) => a[0] - b[0])) {
      const h = matchHeaders(row);
      if (h) headerRows.push({ r, h });
    }

    headerRows.forEach(({ r: hr, h }, i) => {
      const end = i + 1 < headerRows.length ? headerRows[i + 1].r - 1 : maxR + 1;
      const cols: ContactTable["cols"] = {};
      for (const k of ["name", "email", "linkedin", "position", "location", "team", "status", "comment", "company"] as const) {
        if (h[k] !== undefined) cols[k] = h[k];
      }
      const table: ContactTable = {
        sheet: ws.name,
        bank,
        headerRow: hr,
        lastRow: hr,
        cols,
        firstNameCol: h.first,
        lastNameCol: h.last,
        emptyRows: [],
      };
      const get = (r: number, c?: number) => (c ? cells[`${r}:${c}`] : undefined);

      for (let r = hr + 1; r <= end; r++) {
        let name = get(r, cols.name)?.v ?? "";
        if (!name && h.first && h.last) name = `${get(r, h.first)?.v ?? ""} ${get(r, h.last)?.v ?? ""}`.trim();
        if (!name) {
          // Blank-but-numbered rows (the "#" column is pre-filled) are slots we can fill later.
          if (/^\d+$/.test(get(r, 1)?.v ?? "")) table.emptyRows.push(r);
          continue;
        }
        table.lastRow = r;
        // Template placeholders like "(First Last)" and section labels like "Contact | Information".
        if (name.startsWith("(") || SECTION_LABEL.test(name.trim())) continue;

        const email = (get(r, cols.email)?.v ?? "").replace(/^mailto:/i, "");
        const validEmail = /\S+@\S+\.\S+/.test(email) ? email : "";
        const linkCell = get(r, cols.linkedin);
        const linkedin = (linkCell?.link || linkCell?.v || "").trim();
        const rawLocation = get(r, cols.location)?.v ?? "";
        const { location, team } = readLocationTeam(rawLocation, cols.team ? (get(r, cols.team)?.v ?? "") : undefined);
        const sheetStatus = get(r, cols.status)?.v;
        const company = get(r, cols.company)?.v;
        const ref: CellRef = { sheet: ws.name, row: r, cols };
        const { first, last } = splitName(name);
        const status = statusFromSheet(sheetStatus);
        contacts.push({
          id: contactId(ws.name, r),
          name: name.trim(),
          firstName: first,
          lastName: last,
          bank: company || bank,
          region: regionFor(sheetIsNY, rawLocation, company),
          location,
          team,
          position: get(r, cols.position)?.v ?? "",
          email: validEmail,
          emailSource: validEmail ? "sheet" : undefined,
          linkedin: /linkedin\.com/i.test(linkedin) ? linkedin : "",
          comment: get(r, cols.comment)?.v ?? "",
          sheetStatus,
          status,
          source: "sheet",
          ref,
          followUps: 0,
          sentAt: undefined,
          history: [],
        });
      }
      tables.push(table);
    });
  }

  // One entry per firm; the first tier seen wins.
  const seen = new Map<string, TargetBank>();
  for (const t of targets) {
    const k = canonBank(t.name);
    const prev = seen.get(k);
    if (!prev) seen.set(k, t);
    else if (!prev.tier && t.tier) prev.tier = t.tier;
  }
  return { tables, contacts: dedupe(contacts), targets: [...seen.values()] };
}

/** Same person may appear in both the "Conversation" and "Contact Information" tables. */
function dedupe(list: Contact[]): Contact[] {
  const byKey = new Map<string, Contact>();
  for (const c of list) {
    const key = `${norm(c.name)}|${norm(c.bank)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, c);
      continue;
    }
    // Prefer the row that has a LinkedIn column (the richer table) as the write-back target.
    const primary = prev.ref?.cols.linkedin ? prev : c.ref?.cols.linkedin ? c : prev;
    const other = primary === prev ? c : prev;
    byKey.set(key, {
      ...primary,
      email: primary.email || other.email,
      emailSource: primary.email ? primary.emailSource : other.emailSource,
      linkedin: primary.linkedin || other.linkedin,
      position: primary.position || other.position,
      location: primary.location || other.location,
      team: primary.team || other.team,
      comment: [primary.comment, other.comment].filter(Boolean).join(" · "),
    });
  }
  return [...byKey.values()];
}

export type CellPatch = { v: string; link?: string };
export type Patches = Record<string, Record<string, CellPatch>>; // sheet -> "r:c" -> value

export const PROSPECT_SHEET = "Prospects";
export const PROSPECT_HEADERS: [ContactField, string][] = [
  ["name", "Name"],
  ["company", "Bank"],
  ["location", "Location"],
  ["team", "Team"],
  ["email", "Email"],
  ["position", "Position"],
  ["linkedin", "LinkedIn"],
  ["status", "Status"],
  ["comment", "Connection / Comment"],
];

/** Cell writes implied by contact state (enriched emails, status changes, newly added people). */
export function contactPatches(contacts: Contact[], snapshots: SheetSnapshot[]): Patches {
  const out: Patches = {};
  const snap = new Map(snapshots.map((s) => [s.name, s]));
  const put = (sheet: string, r: number, c: number | undefined, p: CellPatch) => {
    if (!c) return;
    const existing = snap.get(sheet)?.cells[`${r}:${c}`];
    if (existing && existing.v === p.v) return;
    (out[sheet] ??= {})[`${r}:${c}`] = p;
  };
  const usesProspectSheet = contacts.some((c) => c.ref?.sheet === PROSPECT_SHEET);
  if (usesProspectSheet && !snap.has(PROSPECT_SHEET)) {
    PROSPECT_HEADERS.forEach(([, label], i) => put(PROSPECT_SHEET, 1, i + 1, { v: label }));
  }
  for (const c of contacts) {
    const ref = c.ref;
    if (!ref) continue;
    const { cols, row, sheet } = ref;
    if (c.email) put(sheet, row, cols.email, { v: c.email, link: `mailto:${c.email}` });
    const statusText = STATUS_TO_SHEET[c.status](c);
    if (statusText && c.status !== statusFromSheet(c.sheetStatus)) put(sheet, row, cols.status, { v: statusText });
    // Location/team and position edits made in the dashboard write back for everyone. Compared by meaning
    // ("SF/Tech" already says SF + Tech), so untouched cells aren't rewritten in the new format.
    const cellAt = (col?: number) => (col ? (snap.get(sheet)?.cells[`${row}:${col}`]?.v ?? "") : "");
    const onSheet = readLocationTeam(cellAt(cols.location), cols.team ? cellAt(cols.team) : undefined);
    if (cols.team) {
      if (c.location && c.location !== onSheet.location) put(sheet, row, cols.location, { v: c.location });
      if (c.team && c.team !== onSheet.team) put(sheet, row, cols.team, { v: c.team });
    } else if ((c.location || c.team) && (c.location !== onSheet.location || (c.team ?? "") !== onSheet.team)) {
      put(sheet, row, cols.location, { v: joinLocationTeam(c.location, c.team) });
    }
    if (c.position) put(sheet, row, cols.position, { v: c.position });
    const linkCell = cols.linkedin ? snap.get(sheet)?.cells[`${row}:${cols.linkedin}`] : undefined;
    if (c.linkedin && !linkCell) put(sheet, row, cols.linkedin, { v: c.linkedin, link: c.linkedin });
    if (c.source !== "sheet") {
      put(sheet, row, cols.name, { v: c.name });
      if (sheet === PROSPECT_SHEET) put(sheet, row, cols.company, { v: c.bank });
      if (c.comment) put(sheet, row, cols.comment, { v: c.comment });
      if (!c.email && cols.status && c.status === "new") put(sheet, row, cols.status, { v: "Pending" });
    }
  }
  return out;
}

/** Sheets as they look with pending cell edits applied (what the grid shows). */
export function applyPatches(snapshots: SheetSnapshot[], patches: Patches): SheetSnapshot[] {
  const out = snapshots.map((s) => {
    const p = patches[s.name];
    return p ? { ...s, cells: { ...s.cells } } : s;
  });
  for (const [name, cells] of Object.entries(patches)) {
    let snap = out.find((s) => s.name === name);
    if (!snap) out.push((snap = { name, rows: 0, cols: 0, cells: {} }));
    for (const [addr, p] of Object.entries(cells)) {
      const [r, c] = addr.split(":").map(Number);
      const v = p.v.trim();
      if (v || p.link) snap.cells[addr] = p.link ? { v, link: p.link } : { v };
      else delete snap.cells[addr];
      snap.rows = Math.max(snap.rows, r);
      snap.cols = Math.max(snap.cols, c);
    }
  }
  return out;
}

const GRID_FIELDS = ["name", "firstName", "lastName", "bank", "region", "location", "team", "position", "email", "linkedin", "comment", "sheetStatus"] as const;

/**
 * Carry manual grid edits into contacts: a person typed into a contact table becomes a contact right
 * away, and edits to an existing row update that person. Only what the edit changed is applied (the
 * sheet is parsed before and after it), so unsaved dashboard changes like enriched emails survive.
 */
export function syncGridEdits(contacts: Contact[], snapshots: SheetSnapshot[], before: Patches, after: Patches) {
  const prev = new Map(parseSnapshots(applyPatches(snapshots, before)).contacts.map((c) => [c.id, c]));
  const next = parseSnapshots(applyPatches(snapshots, after));
  const byId = new Map(contacts.map((c) => [c.id, c]));
  // Rows already holding someone added from the dashboard (not yet saved into the file).
  const occupied = new Set(contacts.filter((c) => c.ref && c.source !== "sheet").map((c) => `${c.ref!.sheet}:${c.ref!.row}`));
  const updates = new Map<string, Partial<Contact>>();
  const added: Contact[] = [];
  const nextIds = new Set<string>();

  for (const n of next.contacts) {
    nextIds.add(n.id);
    const p = prev.get(n.id);
    const cur = byId.get(n.id);
    if (!cur) {
      if (!p && !(n.ref && occupied.has(`${n.ref.sheet}:${n.ref.row}`))) added.push(n);
      continue;
    }
    const patch: Partial<Contact> = {};
    for (const f of GRID_FIELDS) {
      if ((p?.[f] ?? "") !== (n[f] ?? "")) (patch as Record<string, unknown>)[f] = n[f];
    }
    if ("email" in patch) patch.emailSource = n.email ? "sheet" : undefined;
    if ("sheetStatus" in patch) patch.status = n.status;
    if (JSON.stringify(cur.ref) !== JSON.stringify(n.ref)) patch.ref = n.ref;
    if (Object.keys(patch).length) updates.set(n.id, patch);
  }

  // A row whose name was cleared: drop the contact unless the dashboard holds work for it.
  const removed = new Set(
    [...prev.keys()].filter((id) => {
      const c = byId.get(id);
      return !nextIds.has(id) && c?.source === "sheet" && c.status === "new" && !c.sentAt && !c.draft && (!c.email || c.emailSource === "sheet");
    }),
  );

  if (!added.length && !updates.size && !removed.size) return { contacts, tables: next.tables, added };
  return {
    contacts: [
      ...contacts.filter((c) => !removed.has(c.id)).map((c) => (updates.has(c.id) ? { ...c, ...updates.get(c.id) } : c)),
      ...added,
    ],
    tables: next.tables,
    added,
  };
}

export function mergePatches(...all: Patches[]): Patches {
  const out: Patches = {};
  for (const p of all) for (const [s, cells] of Object.entries(p)) out[s] = { ...(out[s] ?? {}), ...cells };
  return out;
}

/**
 * Pick a row for a newly added person: the bank's main tab (SF and NY share it — region lives in
 * the Location/Team column), else a "Prospects" sheet.
 */
export function allocateRow(bank: string, tables: ContactTable[], taken: Set<string>): CellRef {
  const b = norm(bank);
  const candidates = tables.filter((t) => {
    const tb = norm(t.bank);
    return t.cols.linkedin && t.cols.name && (tb === b || tb.includes(b) || b.includes(tb)) && t.sheet !== PROSPECT_SHEET;
  });
  // Prefer the main tab over legacy "(NY)" tabs.
  const ranked = candidates.sort((x, y) => Number(/\(NY\)/i.test(x.sheet)) - Number(/\(NY\)/i.test(y.sheet)));
  const t = ranked[0];
  if (t) {
    const slot = t.emptyRows.find((r) => r > t.headerRow && !taken.has(`${t.sheet}:${r}`));
    let row = slot;
    if (!row) {
      row = t.lastRow + 1;
      while (taken.has(`${t.sheet}:${row}`)) row++;
    }
    return { sheet: t.sheet, row, cols: t.cols };
  }
  const cols = Object.fromEntries(PROSPECT_HEADERS.map(([k], i) => [k, i + 1])) as CellRef["cols"];
  let row = 2;
  while (taken.has(`${PROSPECT_SHEET}:${row}`)) row++;
  return { sheet: PROSPECT_SHEET, row, cols };
}

/**
 * Cell edits that split combined "Location/Team" columns in two: the header becomes "Location", the first
 * empty column of the table (header and every row blank) becomes "Team", and each row's value is split.
 * Returned as manual patches, so the grid shows them before anything is saved.
 */
export function splitLocationTeamPatches(snapshots: SheetSnapshot[], tables: ContactTable[]): { patches: Patches; tables: number } {
  const patches: Patches = {};
  let count = 0;
  for (const t of tables) {
    const loc = t.cols.location;
    const snap = snapshots.find((s) => s.name === t.sheet);
    if (!loc || t.cols.team || !t.cols.name || !snap) continue;
    const v = (r: number, c: number) => snap.cells[`${r}:${c}`]?.v ?? "";
    if (!/team/i.test(v(t.headerRow, loc))) continue;
    const used = new Set([...Object.values(t.cols), t.firstNameCol, t.lastNameCol]);
    const rows = Array.from({ length: Math.max(t.lastRow - t.headerRow, 0) }, (_, i) => t.headerRow + 1 + i);
    const free = (c: number) => !used.has(c) && !v(t.headerRow, c) && rows.every((r) => !v(r, c));
    let teamCol = 0;
    for (let c = loc + 1; c <= snap.cols + 1 && !teamCol; c++) if (free(c)) teamCol = c;
    if (!teamCol) continue;
    const out = (patches[t.sheet] ??= {});
    out[`${t.headerRow}:${loc}`] = { v: "Location" };
    out[`${t.headerRow}:${teamCol}`] = { v: "Team" };
    for (const r of rows) {
      const raw = v(r, loc);
      if (!raw) continue;
      const { location, team } = splitLocationTeam(raw);
      if (!location && !team) continue;
      if (location !== raw) out[`${r}:${loc}`] = { v: location };
      if (team) out[`${r}:${teamCol}`] = { v: team };
    }
    count++;
  }
  return { patches, tables: count };
}

/** An in-cell dropdown that still accepts typed values (Excel's error alert is off). */
export interface Dropdown {
  sheet: string;
  col: number;
  from: number;
  to: number;
  values: string[];
}

/** Location and Team dropdowns for every table that has both columns, down to 30 rows past the last person. */
export function locationTeamDropdowns(tables: ContactTable[], options: { locations: string[]; teams: string[] }): Dropdown[] {
  const out: Dropdown[] = [];
  for (const t of tables) {
    if (!t.cols.location || !t.cols.team) continue;
    const nextHeader = tables.filter((o) => o.sheet === t.sheet && o.headerRow > t.headerRow).map((o) => o.headerRow).sort((a, b) => a - b)[0];
    const to = Math.min(Math.max(t.lastRow, ...t.emptyRows) + 30, (nextHeader ?? Infinity) - 1);
    out.push({ sheet: t.sheet, col: t.cols.location, from: t.headerRow + 1, to, values: options.locations });
    out.push({ sheet: t.sheet, col: t.cols.team, from: t.headerRow + 1, to, values: options.teams });
  }
  return out;
}

/** Excel caps an inline list at 255 characters, and commas separate items. */
function listFormula(values: string[]) {
  const items: string[] = [];
  let len = 2;
  for (const v of values.map((x) => x.replace(/[",]/g, " ").trim()).filter(Boolean)) {
    if (len + v.length + 1 > 255) break;
    items.push(v);
    len += v.length + 1;
  }
  return `"${items.join(",")}"`;
}

/** A contact pre-filled from one grid row, for rows the parser didn't turn into a contact on its own. */
export interface RowDraft {
  name: string;
  bank: string;
  email: string;
  linkedin: string;
  position: string;
  location: string;
  team: string;
  comment: string;
  /** Where this person lives in the sheet: the table's columns, or the columns the values were found in. */
  ref: CellRef;
}

const NAME_LIKE = /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3}$/;
const POSITION_LIKE = /\b(analyst|associate|vice president|vp|director|managing director|md|intern|partner|principal|banker)\b/i;
const NOT_A_NAME = new Set(["contact information", "location team", "full name", "first name", "last name", ...DEFAULT_TEAMS.map((t) => t.toLowerCase())]);

/** "https://www.linkedin.com/in/jane-doe-4b2a19/" -> "Jane Doe". */
export function nameFromLinkedIn(url: string): string {
  const slug = url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1] ?? "";
  const parts = decodeURIComponent(slug).split(/[-_]/).filter((p) => /^[a-z'’]+$/i.test(p) && p.length > 1);
  return parts.length >= 2 ? parts.slice(0, 3).map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(" ") : "";
}

/**
 * Read a row as a person: use the contact table's columns when the row sits under one, else guess from the
 * cells (an email, a LinkedIn link, something shaped like a name or a title). Returns undefined if nothing
 * in the row looks like a person.
 */
export function draftFromRow(sheet: string, row: number, maxCol: number, cell: (c: number) => { v: string; link?: string } | undefined, tables: ContactTable[]): RowDraft | undefined {
  const t = tables.filter((x) => x.sheet === sheet && x.headerRow < row).sort((a, b) => b.headerRow - a.headerRow)[0];
  if (tables.some((x) => x.sheet === sheet && x.headerRow === row)) return undefined;
  const tc = t?.cols ?? {};
  const cells = Array.from({ length: maxCol }, (_, i) => ({ c: i + 1, v: (cell(i + 1)?.v ?? "").trim(), link: cell(i + 1)?.link }));
  const at = (c?: number) => (c ? cells[c - 1] : undefined);
  const find = (test: (x: (typeof cells)[number]) => boolean) => cells.find((x) => x.v && test(x));

  const emailCell = at(tc.email)?.v.includes("@") ? at(tc.email) : find((x) => /\S+@\S+\.\S+/.test(x.v));
  const email = (emailCell?.v ?? "").replace(/^mailto:/i, "");
  const isLi = (x: { v: string; link?: string }) => /linkedin\.com\/in\//i.test(x.link || x.v);
  const liCell = at(tc.linkedin) && isLi(at(tc.linkedin)!) ? at(tc.linkedin) : find(isLi);
  const linkedin = liCell ? (liCell.link || liCell.v).trim() : "";

  let nameCell = at(tc.name)?.v ? at(tc.name) : undefined;
  let name = nameCell?.v ?? "";
  if (!name && t?.firstNameCol && t.lastNameCol) name = `${at(t.firstNameCol)?.v ?? ""} ${at(t.lastNameCol)?.v ?? ""}`.trim();
  if (!name) {
    nameCell = find((x) => NAME_LIKE.test(x.v) && /[a-z]/.test(x.v) && !isPlace(x.v) && !POSITION_LIKE.test(x.v) && !NOT_A_NAME.has(x.v.toLowerCase()) && x !== emailCell && x !== liCell);
    name = nameCell?.v ?? nameFromLinkedIn(linkedin);
  }
  // Outside a contact table, labels ("Bulge Bracket", "Conversion Rate") look like names; insist on a LinkedIn or an email.
  if (!t && !linkedin && !email) return undefined;
  if (!name || name.startsWith("(") || SECTION_LABEL.test(name)) return undefined;

  const posCell = at(tc.position)?.v ? at(tc.position) : find((x) => POSITION_LIKE.test(x.v) && x.v.length < 60 && x !== nameCell);
  const locRaw = tc.location ? (at(tc.location)?.v ?? "") : (find((x) => isPlace(x.v))?.v ?? "");
  const { location, team } = readLocationTeam(locRaw, tc.team ? (at(tc.team)?.v ?? "") : undefined);
  const bank = at(tc.company)?.v || t?.bank || tables.find((x) => x.sheet === sheet)?.bank || "";
  const cols: CellRef["cols"] = t
    ? t.cols
    : { name: nameCell?.c, email: emailCell?.c, linkedin: liCell?.c, position: posCell?.c };
  return {
    name,
    bank,
    email: /\S+@\S+\.\S+/.test(email) ? email : "",
    linkedin,
    position: posCell?.v ?? "",
    location,
    team,
    comment: at(tc.comment)?.v ?? "",
    ref: { sheet, row, cols },
  };
}

export async function buildWorkbook(buffer: ArrayBuffer, patches: Patches, dropdowns: Dropdown[] = []): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  for (const d of dropdowns) {
    const ws = wb.getWorksheet(d.sheet);
    if (!ws) continue;
    const formulae = [listFormula(d.values)];
    for (let r = d.from; r <= d.to; r++) {
      ws.getCell(r, d.col).dataValidation = { type: "list", allowBlank: true, formulae, showErrorMessage: false };
    }
  }
  for (const [sheet, cells] of Object.entries(patches)) {
    const ws = wb.getWorksheet(sheet) ?? wb.addWorksheet(sheet);
    for (const [addr, p] of Object.entries(cells)) {
      const [r, c] = addr.split(":").map(Number);
      const cell = ws.getCell(r, c);
      cell.value = p.link ? { text: p.v, hyperlink: p.link } : p.v;
    }
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const TARGET_NAME_HEADERS = new Set(["institution name", "institution", "bank", "bank name", "firm", "firm name", "company", "company name", "target"]);
const TARGET_TYPE_HEADERS = new Set(["institution type", "type", "tier", "category", "bank type", "firm type"]);
const CATEGORY_HEADER = /bank|bracket|boutique|middle market|equity|fund|firms|trading|asset management/i;

/**
 * Target lists come in two shapes:
 *  - rows: a header with "Institution Name" (+ optional "Institution Type" / "#") and one firm per row;
 *  - columns: a header row of categories ("Investment Banks (Bulge Bracket)", "Private Equity Firms", …) with firms listed below.
 * Only IB / PE categories are kept from column lists so VC/hedge-fund lists don't flood the "cold" bucket.
 */
function extractTargets(sheet: string, cells: SheetSnapshot["cells"], rowText: Map<number, Map<number, string>>, maxR: number): TargetBank[] {
  const out: TargetBank[] = [];
  const get = (r: number, c: number) => (cells[`${r}:${c}`]?.v ?? "").trim();
  const rows = [...rowText.keys()].sort((a, b) => a - b);

  for (const r of rows) {
    const row = rowText.get(r)!;
    if (matchHeaders(row)) continue; // contact tables are handled elsewhere
    const entries = [...row.entries()];
    const nameCol = entries.find(([, t]) => TARGET_NAME_HEADERS.has(norm(t)))?.[0];

    if (nameCol) {
      const typeCol = entries.find(([, t]) => TARGET_TYPE_HEADERS.has(norm(t)))?.[0];
      const numCol = entries.find(([, t]) => norm(t) === "#")?.[0];
      let blanks = 0;
      for (let rr = r + 1; rr <= maxR && blanks < 3; rr++) {
        const raw = get(rr, nameCol);
        if (!raw) {
          blanks++;
          continue;
        }
        blanks = 0;
        const type = typeCol ? get(rr, typeCol) : "";
        const numbered = numCol ? /^\d+$/.test(get(rr, numCol)) : true;
        // Keep banks / buy-side firms; skip helper rows and unrelated types.
        const typed = !typeCol || (!!type && isNaN(Number(type)) && /bank|bracket|boutique|market|equity|credit|advis|capital|fund/i.test(type));
        if (!numbered || !typed) continue;
        const name = cleanBankName(raw);
        if (name.length >= 2) out.push({ name, tier: normalizeTier(type), source: sheet });
      }
      continue;
    }

    const cats = entries.filter(([, t]) => CATEGORY_HEADER.test(t));
    if (cats.length >= 3) {
      for (const [c, header] of cats) {
        const tier = normalizeTier(header);
        if (!tier || !DEFAULT_TIERS.includes(tier)) continue;
        for (let rr = r + 1; rr <= maxR; rr++) {
          const raw = get(rr, c);
          if (!raw) break;
          const name = cleanBankName(raw);
          if (name.length >= 2) out.push({ name, tier, source: sheet });
        }
      }
    }
  }
  return out;
}
