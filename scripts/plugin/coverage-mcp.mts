/**
 * The Coverage plugin's local MCP server (stdio): Claude Code / Cowork read and update the owner's tracker .xlsx with the
 * app's own parser and writer (lib/workbook.ts), so the sheet rules hold here too: only the cells a change needs are
 * written, the rest of the file is checked to be untouched before saving, a backup is kept, and Excel's lock is respected.
 * Built into plugin/coverage/server/coverage-mcp.mjs by `npm run build:plugin` (one self-contained file, Node 20+).
 *
 * Writes look like the owner typing into the sheet (no "• " app lines), so the dashboard's live Excel pickup
 * (actions.ts#pickUpExcelEdits) reads them back as a hand-typed conversation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  allocateConversationRow,
  buildWorkbook,
  contactPatches,
  parseWorkbook,
  referralColumns,
  type CellPatch,
  type ContactTable,
  type ParsedWorkbook,
  type Patches,
} from "../../src/lib/workbook";
import { EMPTY_OPS } from "../../src/lib/sheetOps";
import { DEFAULT_SETTINGS, DEFAULT_GRADING_RULES } from "../../src/lib/defaults";
import { DEFAULT_RUBRIC, letterOf, overallScore } from "../../src/lib/gradeRubric";
import { formatDay, parseLastContacted, sameDayIso } from "../../src/lib/contacted";
import { nextAction } from "../../src/lib/followups";
import { isVpPlus } from "../../src/lib/seniority";
import { canonBank } from "../../src/lib/banks";
import { RATING } from "../../src/lib/conversations";
import type { Contact, ConversationKind, Status } from "../../src/lib/types";

const VERSION = "0.1.0";
const CONFIG = path.join(os.homedir(), ".coverage-plugin.json");
const KINDS: Record<ConversationKind, string> = {
  coffee_chat: "Coffee chat",
  call: "Call",
  info_session: "Info session",
  email: "Email",
  in_person: "In person",
  other: "Other",
};
const STATUSES: Status[] = ["new", "drafted", "sent", "followed_up", "replied", "call_scheduled", "done", "ignored"];

// ---------- workbook file ----------
function workbookPath(): string {
  if (process.env.COVERAGE_WORKBOOK) return process.env.COVERAGE_WORKBOOK;
  try {
    const p = JSON.parse(fs.readFileSync(CONFIG, "utf8")).workbook;
    if (p) return p;
  } catch {
    /* no config yet */
  }
  throw new Error("No tracker workbook set yet. Call find_workbooks, then set_workbook with the right path.");
}

async function load(): Promise<{ file: string; ab: ArrayBuffer; p: ParsedWorkbook }> {
  const file = workbookPath();
  if (!fs.existsSync(file)) throw new Error(`The workbook isn't at ${file} any more. Call find_workbooks / set_workbook.`);
  const b = fs.readFileSync(file);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return { file, ab, p: await parseWorkbook(ab) };
}

const cellsOf = (p: ParsedWorkbook) => new Map(p.snapshots.map((s) => [s.name, s.cells]));

/** Save `patches` (sheet → "r:c" → value): build, prove nothing else changed, back up, write. */
async function save(file: string, ab: ArrayBuffer, p: ParsedWorkbook, patches: Patches) {
  const out = await buildWorkbook(ab, patches, [], EMPTY_OPS, referralColumns(p.tables, p.snapshots));
  const after = await parseWorkbook(out);
  const before = cellsOf(p);
  const now = cellsOf(after);
  const unexpected: string[] = [];
  for (const [sheet, cells] of before) {
    const next = now.get(sheet);
    if (!next) {
      unexpected.push(`${sheet} (tab missing)`);
      continue;
    }
    for (const [k, cell] of Object.entries(cells)) {
      if (patches[sheet]?.[k]) continue;
      // Referral? checkboxes are saved as TRUE/FALSE booleans; "yes"/"x" typed there may come back as TRUE.
      const same = (next[k]?.v ?? "") === cell.v || (/^(true|false|yes|no|y|n|x|✓|✔)?$/i.test(cell.v) && /^(true|false)?$/i.test(next[k]?.v ?? ""));
      if (!same) unexpected.push(`${sheet}!${k}: "${cell.v}" → "${next[k]?.v ?? ""}"`);
    }
  }
  if (after.contacts.length < p.contacts.length) unexpected.push(`contacts ${p.contacts.length} → ${after.contacts.length}`);
  if (unexpected.length) throw new Error(`Not saved: other cells would have changed (${unexpected.slice(0, 5).join("; ")}).`);
  try {
    fs.closeSync(fs.openSync(file, "r+"));
  } catch (e) {
    throw new Error(`Can't write the workbook (${(e as Error).message}). Close it in Excel and try again.`);
  }
  const dir = path.join(path.dirname(file), ".coverage-backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const backup = path.join(dir, `${path.basename(file, ".xlsx")} ${stamp}.xlsx`);
  fs.copyFileSync(file, backup);
  // Keep the 15 newest backups.
  const old = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".xlsx"))
    .sort()
    .reverse()
    .slice(15);
  for (const n of old) fs.rmSync(path.join(dir, n), { force: true });
  fs.writeFileSync(file, Buffer.from(out));
  return backup;
}

const describe = (patches: Patches) =>
  Object.entries(patches).flatMap(([sheet, cells]) => Object.entries(cells).map(([k, v]) => `${sheet}!${addr(k)} = "${v.v}"`));
function addr(k: string) {
  const [r, c] = k.split(":").map(Number);
  let s = "";
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return `${s}${r}`;
}

// ---------- people ----------
function findContact(p: ParsedWorkbook, name: string, bank?: string): Contact {
  const n = name.trim().toLowerCase();
  let list = p.contacts.filter((c) => c.name.toLowerCase() === n);
  if (!list.length) list = p.contacts.filter((c) => c.name.toLowerCase().includes(n) || (c.email && c.email.toLowerCase() === n));
  if (bank) list = list.filter((c) => canonBank(c.bank) === canonBank(bank));
  if (list.length === 1) return list[0];
  if (!list.length) throw new Error(`Nobody called "${name}"${bank ? ` at ${bank}` : ""} in the tracker.`);
  throw new Error(`"${name}" matches ${list.length} people: ${list.map((c) => `${c.name} (${c.bank})`).join(", ")}. Pass bank too.`);
}

function brief(c: Contact) {
  return {
    name: c.name,
    bank: c.bank,
    location: c.location || undefined,
    team: c.team || undefined,
    position: c.position || undefined,
    email: c.email || undefined,
    status: c.status,
    vpPlus: isVpPlus(c.position) || undefined,
    referral: c.referral ? true : undefined,
    firstEmailed: c.sentAt?.slice(0, 10),
    lastContacted: (c.lastEmailedAt ?? c.lastTouchAt)?.slice(0, 10),
    followUps: c.followUps || undefined,
    chats: c.chats?.length || undefined,
    row: c.ref ? `${c.ref.sheet}!${c.ref.row}` : undefined,
  };
}

/** The person's Conversation row: its table and cell text (template placeholders count as empty). */
function conversationRow(p: ParsedWorkbook, c: Contact) {
  if (!c.convRef) return undefined;
  const t = p.tables.find((x) => x.kind === "conversation" && x.sheet === c.convRef!.sheet && c.convRef!.row > x.headerRow);
  const cells = p.snapshots.find((s) => s.name === c.convRef!.sheet)?.cells ?? {};
  const raw = (col?: number) => (col ? (cells[`${c.convRef!.row}:${col}`]?.v ?? "") : "");
  const text = (col?: number) => (/^\(.*\)$|^x\/10$/i.test(raw(col).trim()) ? "" : raw(col));
  return t ? { t, raw, text, row: c.convRef.row } : undefined;
}

function chatInfo(p: ParsedWorkbook, c: Contact) {
  const row = conversationRow(p, c);
  const cc = row?.t.convCols ?? {};
  const all = [row?.text(cc.conversation), row?.text(cc.notes), row?.text(cc.comments), ...(c.chats ?? []).map((x) => x.notes ?? "")].join("\n");
  const rating = (row && row.text(cc.conversation).match(RATING)?.[1]) ?? all.match(/rating:\s*(\d{1,2}(?:\.\d)?)\s*\/\s*10/i)?.[1];
  const grades = [...all.matchAll(/\b([A-D][+-]?|F)\s*\((\d{2,3})\)/g)].map((m) => Number(m[2]));
  const last = (c.chats ?? []).map((x) => x.at).sort().pop();
  return {
    rating: rating ? Number(rating) : undefined,
    grade: grades.length ? grades[grades.length - 1] : undefined,
    lastChat: last && !last.startsWith("1970") ? last.slice(0, 10) : row ? parseLastContacted(row.text(cc.date))?.slice(0, 10) : undefined,
    conversation: row ? { cell: `${row.t.sheet}!${row.row}`, conversation: row.text(cc.conversation), notes: row.text(cc.notes), comments: row.text(cc.comments) } : undefined,
  };
}

/** Good / OK / Bad from what the sheet knows. Ghosting needs Gmail, so the skill checks that and can only move people down. */
function tierOf(c: Contact, info: ReturnType<typeof chatInfo>) {
  const why: string[] = [];
  if (c.referral) why.push("they referred you");
  if (info.rating !== undefined) why.push(`your rating ${info.rating}/10`);
  if (info.grade !== undefined) why.push(`grade ${info.grade}`);
  const bad = (info.rating !== undefined && info.rating < 4) || (info.grade !== undefined && info.grade < 60);
  const good = !!c.referral || (info.rating !== undefined && info.rating >= 8) || (info.grade !== undefined && info.grade >= 84);
  return { tier: bad && !c.referral ? "Bad/Ghost" : good ? "Follow-up/Good" : "OK", why: why.join(", ") || "no rating or grade yet" };
}

// ---------- writes ----------
/** Only the cells `edited` changes compared with `original` (plus any column header the change needs). */
function diffPatches(p: ParsedWorkbook, original: Contact, edited: Contact): Patches {
  const before = contactPatches([original], p.snapshots);
  const after = contactPatches([edited], p.snapshots);
  const out: Patches = {};
  for (const [sheet, cells] of Object.entries(after))
    for (const [k, v] of Object.entries(cells)) if (before[sheet]?.[k]?.v !== v.v) (out[sheet] ??= {})[k] = v;
  // A header the dashboard would add for a column the change writes into (e.g. "Referral?" on a tab without one).
  for (const [sheet, cells] of Object.entries(after))
    for (const [k, v] of Object.entries(cells)) {
      const [r, col] = k.split(":").map(Number);
      const usesCol = Object.keys(out[sheet] ?? {}).some((x) => x !== k && Number(x.split(":")[1]) === col && Number(x.split(":")[0]) > r);
      if (usesCol && r < (edited.ref?.row ?? 0) && !out[sheet]?.[k]) (out[sheet] ??= {})[k] = v;
    }
  return out;
}

const merge = (a: Patches, b: Patches): Patches => {
  const out: Patches = structuredClone(a);
  for (const [s, cells] of Object.entries(b)) Object.assign((out[s] ??= {}), cells);
  return out;
};

const appendLine = (cell: string, line: string) => (cell.split("\n").some((l) => l.trim() === line.trim()) ? cell : cell ? `${cell}\n${line}` : line);
const isoDay = (d: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d).toISOString();

// ---------- tools ----------
type Tool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  destructive?: boolean;
  schema: Record<string, unknown>;
  run: (a: Record<string, unknown>) => Promise<unknown>;
};
const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const TOOLS: Tool[] = [
  {
    name: "find_workbooks",
    title: "Find tracker workbooks",
    description: "List .xlsx files in Downloads, Documents, Desktop and OneDrive (newest first), and which one is set. Backups are skipped.",
    readOnly: true,
    schema: obj({}),
    run: async () => {
      const home = os.homedir();
      const roots = ["Downloads", "Documents", "Desktop", "OneDrive", "OneDrive/Documents", "OneDrive/Desktop"].map((d) => path.join(home, d));
      const found: { path: string; modified: string; mb: number }[] = [];
      const walk = (dir: string, depth: number) => {
        let names: string[] = [];
        try {
          names = fs.readdirSync(dir);
        } catch {
          return;
        }
        for (const n of names) {
          const full = path.join(dir, n);
          if (n.startsWith(".") || n.startsWith("~$") || n === "node_modules") continue;
          let st: fs.Stats;
          try {
            st = fs.statSync(full);
          } catch {
            continue;
          }
          if (st.isDirectory() && depth > 0) walk(full, depth - 1);
          else if (n.toLowerCase().endsWith(".xlsx") && !/\(backup/i.test(n)) found.push({ path: full, modified: st.mtime.toISOString().slice(0, 16), mb: +(st.size / 1e6).toFixed(1) });
        }
      };
      for (const r of roots) walk(r, 2);
      const uniq = [...new Map(found.map((f) => [f.path, f])).values()].sort((a, b) => b.modified.localeCompare(a.modified));
      let current: string | undefined;
      try {
        current = workbookPath();
      } catch {
        current = undefined;
      }
      return { current, workbooks: uniq.slice(0, 25) };
    },
  },
  {
    name: "set_workbook",
    title: "Set the tracker workbook",
    description: "Remember which .xlsx is the recruiting tracker (saved in ~/.coverage-plugin.json). Checks that it parses and has contacts.",
    readOnly: false,
    schema: obj({ path: str("Full path to the .xlsx") }, ["path"]),
    run: async (a) => {
      const file = path.resolve(String(a.path));
      const b = fs.readFileSync(file);
      const p = await parseWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      if (!p.contacts.length) throw new Error("That workbook has no contact tables (Name + Email or LinkedIn headers).");
      fs.writeFileSync(CONFIG, JSON.stringify({ workbook: file }, null, 2));
      return { workbook: file, contacts: p.contacts.length, banks: new Set(p.contacts.map((c) => canonBank(c.bank))).size };
    },
  },
  {
    name: "list_contacts",
    title: "List contacts",
    description: "People in the tracker's Contact Information tables. Filter by text (name / bank / team / email), bank, or status.",
    readOnly: true,
    schema: obj({ query: str("Text to match"), bank: str("Bank name"), status: { type: "string", enum: STATUSES }, limit: { type: "number" } }),
    run: async (a) => {
      const { p } = await load();
      const q = String(a.query ?? "").toLowerCase();
      const list = p.contacts.filter(
        (c) =>
          (!q || [c.name, c.bank, c.team, c.email, c.location, c.position].join(" ").toLowerCase().includes(q)) &&
          (!a.bank || canonBank(c.bank) === canonBank(String(a.bank))) &&
          (!a.status || c.status === a.status),
      );
      return { total: list.length, contacts: list.slice(0, Number(a.limit) || 60).map(brief) };
    },
  },
  {
    name: "get_contact",
    title: "Get one contact",
    description: "Everything the tracker has on one person, including their Conversation row (date, rating, notes, comments).",
    readOnly: true,
    schema: obj({ name: str("Name or email"), bank: str("Bank, if the name is ambiguous") }, ["name"]),
    run: async (a) => {
      const { p } = await load();
      const c = findContact(p, String(a.name), a.bank as string | undefined);
      return { ...brief(c), comment: c.comment || undefined, linkedin: c.linkedin || undefined, sheetStatus: c.sheetStatus, ...chatInfo(p, c) };
    },
  },
  {
    name: "update_contact",
    title: "Update a contact in the tracker",
    description:
      "Change someone's Status, Referral? box, team, location, position or email in the workbook. Only those cells are written (checked), with a backup in .coverage-backups next to the file. dry_run shows the cells without saving.",
    readOnly: false,
    destructive: true,
    schema: obj(
      {
        name: str("Name or email"),
        bank: str("Bank, if the name is ambiguous"),
        status: { type: "string", enum: STATUSES, description: "new = not contacted (sheet 'Pending'), sent, followed_up, replied, call_scheduled, done, ignored (moved on)" },
        referral: { type: "boolean", description: "They referred you (ticks Referral?)" },
        team: str("Team, e.g. Tech"),
        location: str("Office, e.g. SF"),
        position: str("Current title"),
        email: str("Email address"),
        dry_run: { type: "boolean" },
      },
      ["name"],
    ),
    run: async (a) => {
      const { file, ab, p } = await load();
      const c = findContact(p, String(a.name), a.bank as string | undefined);
      if (!c.ref) throw new Error(`${c.name} has no row in Contact Information.`);
      const edited: Contact = structuredClone(c);
      if (a.status) edited.status = a.status as Status;
      if (a.referral !== undefined) edited.referral = a.referral ? (c.referral ?? { at: new Date().toISOString() }) : undefined;
      for (const k of ["team", "location", "position", "email"] as const) if (typeof a[k] === "string") edited[k] = String(a[k]);
      const patches = diffPatches(p, c, edited);
      const cells = describe(patches);
      if (!cells.length) return { changed: false, note: "Nothing to change: the sheet already says that." };
      if (a.dry_run) return { dryRun: true, cells };
      const backup = await save(file, ab, p, patches);
      return { saved: true, cells, backup };
    },
  },
  {
    name: "grading_rubric",
    title: "Get the chat grading rubric",
    description: "The owner's weighted rubric (areas, weights, 5/3/1 anchors) and their grading rules, for grading a coffee chat before log_chat.",
    readOnly: true,
    schema: obj({}),
    run: async () => ({
      rubric: DEFAULT_RUBRIC,
      rules: DEFAULT_GRADING_RULES,
      how: "Score every area 1-5 from the transcript/notes (3 when there's no signal; never penalize missing tone cues: transcripts drop laughter). The overall score is computed from the weights by log_chat (all 3s = 71, all 4s = 84). Keep advice the banker gave apart from your own improvements. The owner's rules beat the rubric.",
    }),
  },
  {
    name: "log_chat",
    title: "Record a chat in the tracker",
    description:
      "Write a coffee chat / call into the person's Conversation row on their bank tab (a free numbered row is used if they have none): Date, your rating (N/10) in Conversation, a dated notes line, and an optional grade line in Comments. Also moves Status up to 'Call scheduled' and can tick Referral?. Written like typed text, so the dashboard picks it up. dry_run shows the cells.",
    readOnly: false,
    destructive: true,
    schema: obj(
      {
        name: str("Name or email"),
        bank: str("Bank, if ambiguous"),
        date: str("YYYY-MM-DD of the chat"),
        kind: { type: "string", enum: Object.keys(KINDS), description: "Default coffee_chat" },
        rating: { type: "number", description: "The owner's own rating out of 10, only if they gave one" },
        notes: str("Short summary of what was discussed (1-3 sentences)"),
        feel: str("How it felt, in the owner's words"),
        referral: { type: "boolean", description: "They referred / will refer the owner" },
        grade: obj(
          {
            areas: { type: "array", items: obj({ area: str("Rubric area name"), score: { type: "number" } }, ["area", "score"]) },
            summary: str("One sentence"),
            commitments: { type: "array", items: { type: "string" }, description: "What they promised to do" },
          },
          ["areas", "summary"],
        ),
        dry_run: { type: "boolean" },
      },
      ["name", "date", "notes"],
    ),
    run: async (a) => {
      const { file, ab, p } = await load();
      const c = findContact(p, String(a.name), a.bank as string | undefined);
      const at = isoDay(String(a.date));
      const kind = (a.kind as ConversationKind) ?? "coffee_chat";
      const patches: Patches = {};
      const put = (sheet: string, r: number, col: number | undefined, v: string) => col && ((patches[sheet] ??= {})[`${r}:${col}`] = { v } as CellPatch);

      let row = conversationRow(p, c);
      if (!row) {
        const taken = new Set(p.contacts.filter((x) => x.convRef).map((x) => `${x.convRef!.sheet}:${x.convRef!.row}`));
        const slot = allocateConversationRow(c, p.tables as ContactTable[], taken);
        if (!slot) throw new Error(`${c.bank}'s tab has no free Conversation row (or no Conversation table). Rows are never inserted, so add one in Excel first.`);
        c.convRef = slot;
        row = conversationRow(p, c)!;
        const tc = row.t.cols;
        put(slot.sheet, slot.row, tc.name, c.name);
        if (c.email) put(slot.sheet, slot.row, tc.email, c.email);
        if (c.position) put(slot.sheet, slot.row, tc.position, c.position);
        if (c.location) put(slot.sheet, slot.row, tc.location, c.location);
      }
      const { t, text } = row;
      const cc = t.convCols ?? {};
      const sheet = t.sheet;
      const r = row.row;
      const md = formatDay(at).replace(/\/\d{4}$/, "");
      const prev = parseLastContacted(text(cc.date));
      if (!prev || (prev < at && !sameDayIso(prev, at))) put(sheet, r, cc.date, formatDay(at));
      const conv = text(cc.conversation);
      let ratingInNotes = false;
      if (typeof a.rating === "number") {
        // The column holds a rating or a plain kind word ("Coffee chat"): the rating replaces it. Other text stays.
        if (!conv || RATING.test(conv) || Object.values(KINDS).some((k) => conv.toLowerCase().startsWith(k.toLowerCase()))) put(sheet, r, cc.conversation, `${a.rating}/10`);
        else ratingInNotes = true;
      } else if (!conv) put(sheet, r, cc.conversation, KINDS[kind]);
      const note = `${md} ${KINDS[kind]}: ${String(a.notes).trim()}${a.feel ? ` | Felt: ${String(a.feel).trim()}` : ""}${ratingInNotes ? ` | Your rating: ${a.rating}/10` : ""}`;
      // "• " lines belong to the dashboard; this is written like the owner's own text.
      put(sheet, r, cc.notes, appendLine(text(cc.notes), note.replace(/^•\s*/, "")));
      let graded: { score: number; letter: string } | undefined;
      const g = a.grade as { areas: { area: string; score: number }[]; summary: string; commitments?: string[] } | undefined;
      if (g) {
        const scores = DEFAULT_RUBRIC.map((ar) => Math.max(1, Math.min(5, Number(g.areas.find((x) => x.area.toLowerCase() === ar.area.toLowerCase())?.score ?? 3))));
        const score = overallScore(DEFAULT_RUBRIC, scores);
        graded = { score, letter: letterOf(score) };
        const promised = g.commitments?.length ? ` Promised: ${g.commitments.join("; ")}.` : "";
        put(sheet, r, cc.comments, appendLine(text(cc.comments), `${md} Claude grade ${graded.letter} (${score}): ${g.summary.trim()}${promised}`));
      }
      // Status / referral on their Contact Information row.
      const edited: Contact = structuredClone(c);
      const rank = (s: Status) => STATUSES.indexOf(s);
      if (kind !== "email" && rank(c.status) < rank("call_scheduled") && c.status !== "ignored") edited.status = "call_scheduled";
      if (a.referral) edited.referral = c.referral ?? { at };
      const all = merge(diffPatches(p, c, edited), patches);
      const cells = describe(all);
      if (a.dry_run) return { dryRun: true, cells, grade: graded };
      const backup = await save(file, ab, p, all);
      return { saved: true, cells, grade: graded, backup };
    },
  },
  {
    name: "chatted_people",
    title: "List people you've chatted with",
    description:
      "Everyone with a conversation in the tracker (Conversation row or a chat-stage Status), with email, last chat date, your rating, grade, referral, and a suggested tier: Follow-up/Good, OK or Bad/Ghost. Ghosting isn't known here: check replies in Gmail.",
    readOnly: true,
    schema: obj({}),
    run: async () => {
      const { p } = await load();
      const people = p.contacts
        .filter((c) => c.chats?.length || c.convRef || c.status === "call_scheduled" || c.status === "done")
        .map((c) => {
          const info = chatInfo(p, c);
          return { ...brief(c), ...info, ...tierOf(c, info), conversation: undefined, notes: info.conversation?.notes ? info.conversation.notes.slice(0, 200) : undefined };
        });
      return { count: people.length, people };
    },
  },
  {
    name: "due_followups",
    title: "List follow-ups that are due",
    description:
      "Who needs a follow-up or a 'move on?' decision now, by the owner's rules (follow-up #1 7 days after the first email, #2 7 days later, max 2; sent Tue-Thu 9-11 AM their time, 6-8 days after the last email). Dates come from the sheet's Contacted / Last emailed columns. VP+ are flagged.",
    readOnly: true,
    schema: obj({ include_upcoming_days: { type: "number", description: "Also list ones due within N days" } }),
    run: async (a) => {
      const { p } = await load();
      const ahead = Number(a.include_upcoming_days) || 0;
      const soon = Date.now() + ahead * 86_400_000;
      const rows = p.contacts
        .map((c) => ({ c, n: nextAction(c, DEFAULT_SETTINGS.followUp) }))
        .filter(({ n }) => (n.kind === "follow_up" || n.kind === "move_on") && (n.isDue || (n.due && n.due.getTime() <= soon)))
        .sort((x, y) => (x.n.due?.getTime() ?? 0) - (y.n.due?.getTime() ?? 0))
        .map(({ c, n }) => ({ ...brief(c), action: n.label, due: n.due?.toISOString().slice(0, 10), isDue: n.isDue }));
      return { count: rows.length, followUps: rows };
    },
  },
];

// ---------- MCP over stdio (newline-delimited JSON-RPC 2.0) ----------
const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
const log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");

async function handle(m: { id?: number | string; method: string; params?: Record<string, unknown> }) {
  if (m.method === "initialize") {
    const asked = String(m.params?.protocolVersion ?? "2025-06-18");
    return {
      protocolVersion: asked,
      capabilities: { tools: {} },
      serverInfo: { name: "coverage-sheet", title: "Coverage tracker", version: VERSION },
      instructions:
        "Reads and updates the owner's IB recruiting tracker (.xlsx). Set the workbook once with find_workbooks + set_workbook. Never guess a person: use list_contacts/get_contact. Writes need the file closed in Excel; show the owner the cells (dry_run) before bulk changes.",
    };
  }
  if (m.method === "ping") return {};
  if (m.method === "tools/list")
    return {
      tools: TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.schema,
        annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
      })),
    };
  if (m.method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === m.params?.name);
    if (!tool) throw Object.assign(new Error(`Unknown tool ${String(m.params?.name)}`), { code: -32602 });
    try {
      const out = await tool.run((m.params?.arguments as Record<string, unknown>) ?? {});
      return { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] };
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
  }
  throw Object.assign(new Error(`Method not found: ${m.method}`), { code: -32601 });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m: { id?: number | string; method: string; params?: Record<string, unknown> };
    try {
      m = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    if (m.id === undefined) continue; // notifications (initialized, cancelled)
    handle(m).then(
      (result) => send({ jsonrpc: "2.0", id: m.id, result }),
      (e) => send({ jsonrpc: "2.0", id: m.id, error: { code: (e as { code?: number }).code ?? -32603, message: (e as Error).message } }),
    );
  }
});
process.stdin.on("end", () => process.exit(0));
log(`coverage-sheet ${VERSION} ready`);
