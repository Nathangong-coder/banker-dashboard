"use client";

import type { Workbook, CellValue } from "exceljs";
import type { CellRef, Contact, ContactField, Region, SheetSnapshot, Status } from "./types";
import { contactId, splitName } from "./util";

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
  location: ["location/team", "location / team", "location", "team", "city", "office", "group"],
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

/** Make sure the Location/Team text carries the region so it round-trips through the sheet. */
export function withRegionTag(location: string, region: Region): string {
  const loc = location.trim();
  if (region === "Other" || detectRegion(loc) === region) return loc;
  const stripped = loc.replace(/^(SF|NY)\s*[·/|,-]\s*/i, "").trim();
  return stripped ? `${region} · ${stripped}` : region;
}

function sheetBankName(sheetName: string, title: string): string {
  const m = title.match(/^(.*?)\s+Application Tracker/i);
  const base = (m ? m[1] : sheetName).replace(/\(NY\)/i, "").trim();
  return base || sheetName;
}

export async function parseWorkbook(buffer: ArrayBuffer): Promise<ParsedWorkbook> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return parseLoaded(wb);
}

function parseLoaded(wb: Workbook): ParsedWorkbook {
  const snapshots: SheetSnapshot[] = [];
  const tables: ContactTable[] = [];
  const contacts: Contact[] = [];

  wb.eachSheet((ws) => {
    const cells: SheetSnapshot["cells"] = {};
    const rowText = new Map<number, Map<number, string>>();
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
        if (!rowText.has(r)) rowText.set(r, new Map());
        rowText.get(r)!.set(c, v);
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      });
    });
    snapshots.push({ name: ws.name, rows: maxR, cols: maxC, cells });

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
      for (const k of ["name", "email", "linkedin", "position", "location", "status", "comment", "company"] as const) {
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
        if (name.startsWith("(") || /^(contact|contacts|name|information|#)$/i.test(name.trim())) continue;

        const email = (get(r, cols.email)?.v ?? "").replace(/^mailto:/i, "");
        const validEmail = /\S+@\S+\.\S+/.test(email) ? email : "";
        const linkCell = get(r, cols.linkedin);
        const linkedin = (linkCell?.link || linkCell?.v || "").trim();
        const location = get(r, cols.location)?.v ?? "";
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
          region: regionFor(sheetIsNY, location, company),
          location,
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
  });

  return { snapshots, tables, contacts: dedupe(contacts) };
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
  ["location", "Location/Team"],
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
    // Location (region tag) and position edits made in the dashboard write back for everyone.
    if (c.location) put(sheet, row, cols.location, { v: c.location });
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

export async function buildWorkbook(buffer: ArrayBuffer, patches: Patches): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
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
