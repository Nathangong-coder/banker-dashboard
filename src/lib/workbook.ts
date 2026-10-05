"use client";

import type { Workbook, CellValue } from "exceljs";
import type { CellRef, CellStyle, Contact, ContactField, Region, SheetFormat, SheetSnapshot, Status } from "./types";
import { contactId, splitName } from "./util";
import { DEFAULT_TIERS, canonBank, cleanBankName, normalizeTier, type TargetBank } from "./banks";
import { DEFAULT_TEAMS, isPlace, joinLocationTeam, readLocationTeam, splitLocationTeam } from "./locationTeam";
import { isInternalLink, readInternalLinks, renameLinks, writeInternalLinks, type InternalLinks } from "./sheetLinks";
import { detectRegion } from "./region";
import { EMPTY_OPS, opsOf, type SheetOps } from "./sheetOps";
import { CONTACTED_HEADERS, formatContacted, parseContacted, sameContacted } from "./contacted";

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
    // A formula Excel never calculated (no cached result): blank, not "[object Object]".
    if ("formula" in v || "sharedFormula" in v) return "";
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
  contacted: CONTACTED_HEADERS,
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

export { detectRegion };

export function statusFromSheet(raw: string | undefined): Status {
  const s = norm(raw ?? "");
  if (!s) return "new";
  if (/moved on|ignore|dead|no response|bounced|removed|left (the )?firm/.test(s)) return "ignored";
  if (/call|coffee|meeting|chat/.test(s)) return "call_scheduled";
  // A bare "Scheduled" is an email queued with Gmail's Schedule send (confirmed against the owner's Gmail): not sent yet.
  if (/^scheduled\b/.test(s)) return "drafted";
  if (/repl|respond|responded/.test(s)) return "replied";
  if (/follow/.test(s)) return "followed_up";
  if (/sent|emailed|contacted|messaged/.test(s)) return "sent";
  if (/draft/.test(s)) return "drafted";
  if (/done|complete/.test(s)) return "done";
  return "new"; // "Pending", "*", etc. = queued, not yet sent
}

/** "Followed up (2x)" → 2. */
export function followUpsFromSheet(raw: string | undefined) {
  const s = norm(raw ?? "");
  if (!/follow/.test(s)) return 0;
  const n = s.match(/(\d+)\s*x|x\s*(\d+)|#\s*(\d+)/);
  return n ? Number(n[1] ?? n[2] ?? n[3]) : 1;
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
function regionFor(sheetIsNY: boolean, location: string, company?: string, officeKnown = !!location.trim()): Region {
  const r = detectRegion(location);
  if (r !== "Other") return r;
  if (sheetIsNY) return "NY";
  // A city we don't map (Houston, Boston…) is "Other", never silently SF. Only a blank location on a bank tracker
  // tab defaults to SF (the owner's home market); generic lists stay unassigned.
  if (officeKnown) return "Other";
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
  return parseLoaded(wb, await readInternalLinks(buffer));
}

/** 2: snapshots also carry in-workbook links (`#Tab!A1`), which older imports lost. */
export const FORMAT_VERSION = 2;

/** Theme colors from the workbook's theme XML, in Excel's theme-index order (lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink). */
function themePalette(wb: Workbook): string[] {
  const fallback = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
  const xml = (wb as unknown as { _themes?: Record<string, string> })._themes?.theme1 ?? "";
  const pick = (tag: string) => xml.match(new RegExp(`<a:${tag}>[\\s\\S]*?(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"`))?.[1];
  const order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return order.map((t, i) => pick(t) ?? fallback[i]);
}

/** Excel tint: -1..1, darkens toward black or lightens toward white. */
function tint(hex: string, t = 0) {
  if (!t) return hex;
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((v) => Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t));
  return out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

type XColor = { argb?: string; theme?: number; tint?: number; indexed?: number } | undefined;
function cssColor(c: XColor, palette: string[]): string | undefined {
  if (!c) return undefined;
  if (c.argb && /^[0-9A-Fa-f]{8}$/.test(c.argb)) return `#${c.argb.slice(2).toLowerCase()}`;
  if (typeof c.theme === "number" && palette[c.theme]) return `#${tint(palette[c.theme], c.tint).toLowerCase()}`;
  return undefined;
}

/** Read a tab's look (fills, fonts, alignment, borders, sizes, merges) within the area that has content. */
function readFormat(ws: import("exceljs").Worksheet, maxR: number, maxC: number, palette: string[]): SheetFormat {
  const styles: CellStyle[] = [];
  const index = new Map<string, number>();
  const cellStyle: Record<string, number> = {};
  const lastRow = Math.min(maxR + 5, MAX_ROWS);
  const lastCol = Math.min(Math.max(maxC, 1) + 1, MAX_COLS);
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.findRow(r);
    if (!row) continue;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      if (c > lastCol) return;
      const st = cell.style ?? {};
      const s: CellStyle = {};
      const fill = st.fill as { type?: string; pattern?: string; fgColor?: XColor } | undefined;
      if (fill?.type === "pattern" && fill.pattern && fill.pattern !== "none") s.bg = cssColor(fill.fgColor, palette);
      const f = st.font;
      if (f) {
        const fg = cssColor(f.color as XColor, palette);
        if (fg && fg !== "#000000") s.fg = fg;
        if (f.bold) s.b = 1;
        if (f.italic) s.i = 1;
        if (f.underline) s.u = 1;
        if (f.size && f.size !== 10 && f.size !== 11) s.sz = f.size;
      }
      const a = st.alignment;
      if (a?.horizontal === "center" || a?.horizontal === "right" || a?.horizontal === "left") s.al = a.horizontal;
      if (a?.vertical === "top" || a?.vertical === "middle" || a?.vertical === "bottom") s.va = a.vertical;
      if (a?.wrapText) s.wrap = 1;
      const b = st.border;
      if (b) {
        const sides = (["top", "right", "bottom", "left"] as const).filter((k) => b[k]?.style).map((k) => k[0]).join("");
        if (sides) {
          const any = b.top ?? b.right ?? b.bottom ?? b.left;
          s.bd = { sides, color: cssColor(any?.color as XColor, palette) ?? "#999999" };
        }
      }
      if (!Object.keys(s).length) return;
      const key = JSON.stringify(s);
      let i = index.get(key);
      if (i === undefined) {
        i = styles.push(s) - 1;
        index.set(key, i);
      }
      cellStyle[`${r}:${c}`] = i;
    });
  }
  const colWidths: Record<number, number> = {};
  const hiddenCols: number[] = [];
  for (let c = 1; c <= lastCol; c++) {
    const col = ws.getColumn(c);
    if (col.hidden) hiddenCols.push(c);
    else if (col.width) colWidths[c] = Math.round(col.width * 7 + 5);
  }
  const rowHeights: Record<number, number> = {};
  const hiddenRows: number[] = [];
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.findRow(r);
    if (!row) continue;
    if (row.hidden) hiddenRows.push(r);
    else if (row.height) rowHeights[r] = Math.round((row.height * 4) / 3);
  }
  const merges: SheetFormat["merges"] = [];
  for (const m of ((ws.model as { merges?: string[] }).merges ?? []).slice(0, 500)) {
    const [a, b] = m.split(":");
    const pa = parseAddr(a);
    const pb = parseAddr(b ?? a);
    if (pa && pb && pa.r <= lastRow) merges.push([pa.r, pa.c, pb.r, pb.c]);
  }
  return { version: FORMAT_VERSION, styles, cellStyle, colWidths, rowHeights, merges, hiddenCols, hiddenRows };
}

function parseAddr(a: string) {
  const m = a.match(/^\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  const c = m[1].toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { r: Number(m[2]), c };
}

/** Re-read just the formatting of an already-imported workbook (snapshots saved before formatting was captured). */
export async function readFormats(buffer: ArrayBuffer): Promise<Record<string, SheetFormat>> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const palette = themePalette(wb);
  const out: Record<string, SheetFormat> = {};
  wb.eachSheet((ws) => {
    let maxR = 0;
    let maxC = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      if (r > MAX_ROWS) return;
      maxR = r;
      maxC = Math.max(maxC, Math.min(row.cellCount, MAX_COLS));
    });
    out[ws.name] = readFormat(ws, maxR, maxC, palette);
  });
  return out;
}

/** Put in-workbook links on snapshot cells (an external link on the same cell wins). */
export function withInternalLinks(cells: SheetSnapshot["cells"], links: Record<string, string> | undefined): SheetSnapshot["cells"] {
  if (!links) return cells;
  const out = { ...cells };
  for (const [key, link] of Object.entries(links)) {
    const cur = out[key];
    if (cur?.link && !isInternalLink(cur.link)) continue;
    out[key] = { v: cur?.v ?? "", link };
  }
  return out;
}

function parseLoaded(wb: Workbook, links: InternalLinks): ParsedWorkbook {
  const snapshots: SheetSnapshot[] = [];
  const palette = themePalette(wb);
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
    const linked = withInternalLinks(cells, links[ws.name]);
    for (const key of Object.keys(linked)) {
      const [r, c] = key.split(":").map(Number);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
    snapshots.push({ name: ws.name, rows: maxR, cols: maxC, cells: linked, format: readFormat(ws, maxR, maxC, palette) });
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
      for (const k of ["name", "email", "linkedin", "position", "location", "team", "status", "comment", "company", "contacted"] as const) {
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
        const dates = parseContacted(get(r, cols.contacted)?.v);
        contacts.push({
          id: contactId(ws.name, r),
          name: name.trim(),
          firstName: first,
          lastName: last,
          bank: company || bank,
          region: regionFor(sheetIsNY, rawLocation, company, !!location),
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
          followUps: followUpsFromSheet(sheetStatus),
          ...dates,
          history: [],
        });
      }
      tables.push(table);
    });
  }

  // One entry per firm; the first tier seen wins, and every application to it is kept.
  const seen = new Map<string, TargetBank>();
  for (const t of targets) {
    const k = canonBank(t.name);
    const prev = seen.get(k);
    if (!prev) seen.set(k, { ...t, applied: t.applied && [...t.applied] });
    else {
      if (!prev.tier && t.tier) prev.tier = t.tier;
      if (t.applied) prev.applied = [...(prev.applied ?? []), ...t.applied];
    }
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
      sentAt: primary.sentAt ?? other.sentAt,
      lastTouchAt: primary.lastTouchAt ?? other.lastTouchAt,
      scheduledAt: primary.scheduledAt ?? other.scheduledAt,
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
    // Send dates (from Gmail sync or marked by hand) go to the Contacted column, added next to Status when missing.
    const dates = { sentAt: c.sentAt, lastTouchAt: c.lastTouchAt, scheduledAt: c.sentAt ? undefined : c.scheduledAt };
    if (dates.sentAt || dates.scheduledAt) {
      const col = cols.contacted ?? (cols.status ? contactedColumn(snap.get(sheet), (out[sheet] ??= {}), ref) : undefined);
      if (col && !sameContacted(parseContacted(cellAt(col)), dates)) put(sheet, row, col, { v: formatContacted(dates) });
    }
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

/**
 * Where a table without a Contacted column gets one: the empty header cell just left of Status (column H on the
 * owner's tabs), else the first empty one after the table's last column. Writes the header into `pending`.
 */
function contactedColumn(s: SheetSnapshot | undefined, pending: Record<string, CellPatch>, ref: CellRef): number | undefined {
  if (!s) return undefined;
  const known = Object.values(ref.cols).filter((c): c is number => !!c);
  if (!ref.cols.name || !known.length) return undefined;
  const text = (r: number, c: number) => pending[`${r}:${c}`]?.v ?? s.cells[`${r}:${c}`]?.v ?? "";
  // The header row: nearest row above whose Name column says "Name".
  let hr = 0;
  for (let r = ref.row - 1; r >= 1 && !hr; r--) if (/^(full |contact )?name$/i.test(text(r, ref.cols.name).trim())) hr = r;
  if (!hr) return undefined;
  for (let c = 1; c <= Math.max(...known) + 3; c++) if (CONTACTED_HEADERS.includes(text(hr, c).trim().toLowerCase())) return c;
  const status = ref.cols.status;
  let col: number | undefined;
  if (status && status > 1 && !text(hr, status - 1) && !known.includes(status - 1)) col = status - 1;
  for (let c = Math.max(...known) + 1; !col && c <= Math.max(...known) + 3; c++) if (!text(hr, c)) col = c;
  if (!col) return undefined;
  pending[`${hr}:${col}`] = { v: "Contacted" };
  return col;
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
      // Like Excel, retyping a cell keeps its jump-to-tab link; clearing it removes the link.
      const kept = snap.cells[addr]?.link;
      const link = p.link ?? (v && isInternalLink(kept) ? kept : undefined);
      if (v || link) snap.cells[addr] = link ? { v, link } : { v };
      else delete snap.cells[addr];
      snap.rows = Math.max(snap.rows, r);
      snap.cols = Math.max(snap.cols, c);
    }
  }
  return out;
}

/** The dashboard holds something for this person beyond what the sheet says (outreach, a draft, a found email). */
export function hasDashboardWork(c: Contact) {
  return c.status !== "new" || !!c.sentAt || !!c.draft || (!!c.email && c.emailSource !== "sheet");
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
  const occupied = new Map(contacts.filter((c) => c.ref && c.source !== "sheet").map((c) => [`${c.ref!.sheet}:${c.ref!.row}`, c]));
  const updates = new Map<string, Partial<Contact>>();
  const added: Contact[] = [];
  const nextIds = new Set<string>();

  for (const n of next.contacts) {
    nextIds.add(n.id);
    const p = prev.get(n.id);
    // Someone added from the dashboard (Add contact, Find people) owns their row, so edits to it update them too.
    const owner = n.ref ? occupied.get(`${n.ref.sheet}:${n.ref.row}`) : undefined;
    const cur = byId.get(n.id) ?? owner;
    if (!cur) {
      if (!p) added.push(n);
      continue;
    }
    if (cur === owner && !p) continue; // the row just got its first cells from the dashboard itself; nothing typed yet
    const patch: Partial<Contact> = {};
    for (const f of GRID_FIELDS) {
      if ((p?.[f] ?? "") !== (n[f] ?? "")) (patch as Record<string, unknown>)[f] = n[f];
    }
    if ("email" in patch) patch.emailSource = n.email ? "sheet" : undefined;
    if ("sheetStatus" in patch) patch.status = n.status;
    if (cur !== owner && JSON.stringify(cur.ref) !== JSON.stringify(n.ref)) patch.ref = n.ref;
    if (Object.keys(patch).length) updates.set(cur.id, { ...updates.get(cur.id), ...patch });
  }

  // A row whose name was cleared: drop the contact unless the dashboard holds work for it.
  const removed = new Set(
    [...prev.keys()].filter((id) => {
      const c = byId.get(id);
      return !nextIds.has(id) && c?.source === "sheet" && !hasDashboardWork(c);
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

/**
 * The body of a contact table: from under the header down to the last person or numbered slot. Stops at a
 * section banner ("Contact | Information") so row operations never move another table's header.
 */
export function tableBody(t: ContactTable, tables: ContactTable[], cell: (r: number, c: number) => string, maxRow: number) {
  const next = tables.filter((o) => o.sheet === t.sheet && o.headerRow > t.headerRow).map((o) => o.headerRow).sort((a, b) => a - b)[0];
  const limit = next ? next - 1 : maxRow;
  const tableCols = [...new Set([...Object.values(t.cols), t.firstNameCol, t.lastNameCol].filter((c): c is number => !!c))];
  let to = t.headerRow;
  let end = limit;
  for (let r = t.headerRow + 1; r <= limit; r++) {
    const name = t.cols.name ? cell(r, t.cols.name) : "";
    if (SECTION_LABEL.test(name.trim())) {
      end = r - 1;
      break;
    }
    if (/^\d+$/.test(cell(r, 1)) || tableCols.some((c) => cell(r, c))) to = r;
  }
  // `limit` is how far the table may grow: up to the banner/next header, or unbounded for the last table.
  return { from: t.headerRow + 1, to, limit: next ? end : Infinity, numberCol: cell(t.headerRow, 1).trim() === "#" ? 1 : undefined };
}

/**
 * Excel-style "delete rows (shift up)" / "insert rows (shift down)", limited to the contact table the row is in so
 * headers, banners and other tables stay put. The "#" numbering column doesn't move. Returns the tab's new manual
 * patches and where each old row ended up (null = deleted).
 */
export function shiftTableRows(args: {
  snapshot: SheetSnapshot;
  sheetPatches: Record<string, CellPatch>;
  tables: ContactTable[];
  row: number;
  count: number;
  mode: "delete" | "insert";
}): { patches: Record<string, CellPatch>; moveRow: (r: number) => number | null } | { error: string } {
  const { snapshot, sheetPatches, tables, row, count, mode } = args;
  const eff = (r: number, c: number): CellPatch | undefined => {
    const p = sheetPatches[`${r}:${c}`] ?? snapshot.cells[`${r}:${c}`];
    return p && (p.v || p.link) ? p : undefined;
  };
  let maxRow = snapshot.rows;
  let maxCol = snapshot.cols;
  for (const k of Object.keys(sheetPatches)) {
    const [r, c] = k.split(":").map(Number);
    maxRow = Math.max(maxRow, r);
    maxCol = Math.max(maxCol, c);
  }
  const t = tables.filter((x) => x.sheet === snapshot.name && x.headerRow < row).sort((a, b) => b.headerRow - a.headerRow)[0];
  if (!t) return { error: "Only rows inside a contact table can be deleted or inserted (other rows can be cleared)." };
  const body = tableBody(t, tables, (r, c) => eff(r, c)?.v ?? "", maxRow);
  if (row > body.limit) return { error: "That row is a section banner, not part of the table." };

  const shifted = new Map<number, number | null>();
  const writes = new Map<number, (c: number) => CellPatch | undefined>();
  let last = Math.max(body.to, row + (mode === "delete" ? count - 1 : 0));
  if (mode === "delete") {
    const n = Math.min(count, last - row + 1);
    for (let r = row; r <= last; r++) {
      shifted.set(r, r < row + n ? null : r - n);
      writes.set(r, (c) => (r + n <= last ? eff(r + n, c) : undefined));
    }
  } else {
    if (last + count > body.limit) return { error: "This table is full up to the next section. Delete a row first, or add people at the bottom of the last table." };
    last += count;
    for (let r = last; r >= row; r--) {
      if (r - count >= row) shifted.set(r - count, r);
      writes.set(r, (c) => (r - count >= row ? eff(r - count, c) : undefined));
    }
  }

  const patches = { ...sheetPatches };
  for (const [r, value] of writes) {
    for (let c = 1; c <= maxCol; c++) {
      if (c === body.numberCol) continue;
      const k = `${r}:${c}`;
      const v = value(c);
      const base = snapshot.cells[k];
      const same = (v?.v ?? "") === (base?.v ?? "") && (v?.link ?? "") === (base?.link ?? "");
      if (same) delete patches[k];
      else patches[k] = v ? { ...v } : { v: "" };
    }
  }
  return { patches, moveRow: (r) => (shifted.has(r) ? shifted.get(r)! : r) };
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

/** A new tab with `from`'s layout (column widths, row heights, cell styles, merges, view), no values, placed after `after`. */
function cloneLayout(wb: Workbook, from: string, name: string, after?: string) {
  const src = wb.getWorksheet(from);
  if (!src || wb.getWorksheet(name)) return;
  const ws = wb.addWorksheet(name, {
    properties: { ...src.properties },
    views: src.views.map((v) => ({ ...v })),
    pageSetup: { ...src.pageSetup },
  });
  src.columns?.forEach((col, i) => {
    const c = ws.getColumn(i + 1);
    if (col.width) c.width = col.width;
    if (col.hidden) c.hidden = true;
  });
  src.eachRow({ includeEmpty: true }, (row, r) => {
    const nr = ws.getRow(r);
    if (row.height) nr.height = row.height;
    if (row.hidden) nr.hidden = true;
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      nr.getCell(c).style = JSON.parse(JSON.stringify(cell.style ?? {}));
    });
  });
  for (const m of (src.model as { merges?: string[] }).merges ?? []) ws.mergeCells(m);
  // Tab order is `orderNo` (not in ExcelJS's types): shift everything after the anchor along by one.
  type Ordered = { orderNo: number };
  const anchor = (after ? wb.getWorksheet(after) : undefined) as unknown as Ordered | undefined;
  if (anchor) {
    for (const w of wb.worksheets as unknown as Ordered[]) if (w !== (ws as unknown as Ordered) && w.orderNo > anchor.orderNo) w.orderNo++;
    (ws as unknown as Ordered).orderNo = anchor.orderNo + 1;
  }
}

/** Give a row the look (cell styles, height) of another row on the same tab. */
function copyRowStyle(wb: Workbook, sheet: string, row: number, from: number) {
  const ws = wb.getWorksheet(sheet);
  if (!ws) return;
  const src = ws.getRow(from);
  const dst = ws.getRow(row);
  if (src.height) dst.height = src.height;
  src.eachCell({ includeEmpty: true }, (cell, c) => {
    dst.getCell(c).style = JSON.parse(JSON.stringify(cell.style ?? {}));
  });
}

export async function buildWorkbook(buffer: ArrayBuffer, patches: Patches, dropdowns: Dropdown[] = [], ops: SheetOps = EMPTY_OPS): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  // Tab renames, rebuilt tabs, new tabs and OVERVIEW rows first, so dropdowns and patches land on them.
  const o = opsOf(ops);
  for (const r of o.renames) {
    const ws = wb.getWorksheet(r.from);
    if (ws && !wb.getWorksheet(r.to)) ws.name = r.to;
  }
  type Ordered = { orderNo: number; id: number };
  for (const r of o.replaces) {
    const old = wb.getWorksheet(r.name) as unknown as (Ordered & { name: string }) | undefined;
    if (!old || r.from === r.name) continue;
    const order = old.orderNo;
    wb.removeWorksheet(old.id);
    cloneLayout(wb, r.from, r.name);
    const fresh = wb.getWorksheet(r.name) as unknown as Ordered | undefined;
    const anchor = (r.after ? wb.getWorksheet(r.after) : undefined) as unknown as Ordered | undefined;
    if (fresh && anchor) {
      for (const w of wb.worksheets as unknown as Ordered[]) if (w !== fresh && w.orderNo > anchor.orderNo) w.orderNo++;
      fresh.orderNo = anchor.orderNo + 1;
    } else if (fresh) fresh.orderNo = order;
  }
  for (const c of o.clones) cloneLayout(wb, c.from, c.name, c.after);
  for (const s of ops.rowStyles) copyRowStyle(wb, s.sheet, s.row, s.from);
  for (const d of dropdowns) {
    const ws = wb.getWorksheet(d.sheet);
    if (!ws) continue;
    const formulae = [listFormula(d.values)];
    for (let r = d.from; r <= d.to; r++) {
      ws.getCell(r, d.col).dataValidation = { type: "list", allowBlank: true, formulae, showErrorMessage: false };
    }
  }
  // ExcelJS can't read or write links between tabs, so they're carried over from the original file (plus any set by
  // patches) and written into the saved XML afterwards.
  const links = renameLinks(await readInternalLinks(buffer), o.renames);
  // A rebuilt tab's old links went with it.
  for (const r of o.replaces) delete links[r.name];
  for (const [sheet, cells] of Object.entries(patches)) {
    const ws = wb.getWorksheet(sheet) ?? wb.addWorksheet(sheet);
    for (const [addr, p] of Object.entries(cells)) {
      const [r, c] = addr.split(":").map(Number);
      const cell = ws.getCell(r, c);
      const internal = isInternalLink(p.link);
      cell.value = p.link && !internal ? { text: p.v, hyperlink: p.link } : p.v === "" ? null : p.v;
      if (internal) (links[sheet] ??= {})[addr] = p.link!;
      else if (p.link || p.v === "") delete links[sheet]?.[addr];
    }
  }
  const out = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return writeInternalLinks(out, links, (sheet, addr) => {
    const [r, c] = addr.split(":").map(Number);
    return cellText(wb.getWorksheet(sheet)?.getCell(r, c).value).trim();
  });
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
const SA_PROGRAM = /summer\s*(analyst|associate|intern(ship)?)|\bSA\b|\b20\d\d analyst\b/i;
const NOT_SUBMITTED = /^(oops|n\/?a|no|not yet|tbd|-+|planning|to ?do|not started|draft(ing)?)$/i;
const SUBMITTED_STATUS = /submitted|in process|pending|accepted|rejected|declined|interview|superday|hirevue|offer|wait ?list|review|applied|complete/i;

/** A summer analyst application that was submitted (a submitted date, or a status that implies it), else undefined. */
function applicationOf(program: string, submitted: string, status: string) {
  if (!SA_PROGRAM.test(program)) return undefined;
  const sent = (submitted && !NOT_SUBMITTED.test(submitted)) || SUBMITTED_STATUS.test(status);
  return sent ? { program, submitted, status } : undefined;
}

/** Tier for a firm on the applications list: its type if it says, else a bank (it runs a summer analyst program). */
function applicationTier(type: string) {
  if (/private equity|growth equity|venture|\bvc\b|\bpe\b|hedge|asset management/i.test(type)) return "Private Equity";
  const t = normalizeTier(type);
  return t && ["Bulge Bracket", "Elite Boutique", "Middle Market", "Investment Bank"].includes(t) ? t : "Investment Bank";
}

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
      // An applications list ("Program Type", "Application Submitted Date", "Application Status", "Target Location").
      const programCol = entries.find(([, t]) => /^program( type)?$/.test(norm(t)))?.[0];
      const submittedCol = entries.find(([, t]) => /submitted/.test(norm(t)))?.[0];
      const statusCol = entries.find(([, t]) => /application\s*status|^status$/.test(norm(t)))?.[0];
      const locCol = entries.find(([, t]) => /target location/.test(norm(t)))?.[0];
      let blanks = 0;
      for (let rr = r + 1; rr <= maxR && blanks < 3; rr++) {
        const raw = get(rr, nameCol);
        if (!raw) {
          blanks++;
          continue;
        }
        blanks = 0;
        const type = typeCol ? get(rr, typeCol) : "";
        const app = programCol && (submittedCol || statusCol) ? applicationOf(get(rr, programCol), submittedCol ? get(rr, submittedCol) : "", statusCol ? get(rr, statusCol) : "") : undefined;
        if (app) {
          // A submitted summer analyst application: the firm is tracked even if no other list has it.
          const name = cleanBankName(raw);
          if (name.length >= 2)
            out.push({ name, tier: applicationTier(type), source: sheet, applied: [{ ...app, location: locCol ? get(rr, locCol) : "", sheet, row: rr }] });
          continue;
        }
        const numbered = numCol ? /^\d+$/.test(get(rr, numCol)) : true;
        // Keep banks / buy-side firms; skip helper rows and unrelated types.
        const typed = !typeCol || (!!type && isNaN(Number(type)) && /bank|bracket|boutique|market|equity|credit|advis|capital|fund|^(bb|eb|mm)$/i.test(type.trim()));
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
