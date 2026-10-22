/**
 * Conversations (coffee chats, calls, info sessions, emails, in person) and the bank tabs' "Conversation" table
 * (owner, 2026-10-19). Pure helpers, no store: used by workbook.ts (read + write-back), the activity log and check scripts.
 *
 * Rules agreed with the owner:
 * - The Contact Information table is the only list of people. A Conversation-table row never creates a contact; it links
 *   to one (email, then exact name, then a unique last name + first initial at that bank). Rows that match nobody are
 *   "orphans" the log page asks about.
 * - One Conversation row per person. Later conversations update the same row.
 * - The row: Name / Email / Position / Location copied from the person, Date = latest conversation, Conversation = kinds
 *   and counts, Notes = one dated line per conversation (+ the Doc link), Comments = the AI grade + takeaways.
 * - Lines the app writes start with "• ". Anything else in Notes / Comments is the owner's own text and is kept as is.
 */
import type { ChatLog, Contact, ConversationKind } from "./types";

export const KIND_LABEL: Record<ConversationKind, string> = {
  coffee_chat: "Coffee chat",
  call: "Phone call",
  info_session: "Info session",
  email: "Email",
  in_person: "In person",
  other: "Other",
};
export const KINDS = Object.keys(KIND_LABEL) as ConversationKind[];

/** "8/10", "8.5 / 10": the owner's own rating of a chat, typed into the Conversation column (template "x/10"). */
export const RATING = /^\s*(\d{1,2}(?:\.\d)?)\s*\/\s*10\s*$/;

/**
 * "coffee chat w/ Sam" → coffee_chat. Used for rows typed into the sheet by hand. A row someone typed into a bank tab's
 * Conversation table is a coffee chat unless the text says otherwise (owner, 2026-10-21: Benjamin Hon at Mizuho, with
 * a rating out of 10 in the column, showed as "Other"). "Other" only when it literally says so.
 */
export function kindFromText(text: string | undefined): ConversationKind {
  const t = (text ?? "").toLowerCase();
  if (/coffee/.test(t)) return "coffee_chat";
  if (/info ?session|recruiting event|networking event/.test(t)) return "info_session";
  if (/\b(phone|call|zoom|teams|google meet)\b/.test(t)) return "call";
  if (/\be-?mail/.test(t)) return "email";
  if (/in person|in-person|lunch|dinner|office visit|\bvisit/.test(t)) return "in_person";
  if (/^\s*other\b/.test(t)) return "other";
  return "coffee_chat";
}

export const kindOf = (c: ChatLog): ConversationKind => c.kind ?? "coffee_chat";

/** A Conversation-table row as read from the sheet. */
export interface ConversationRow {
  sheet: string;
  row: number;
  bank: string;
  name: string;
  email: string;
  date?: string;
  conversation: string;
  notes: string;
  comments: string;
}

export const APP_LINE = "• ";
const isAppLine = (l: string) => l.startsWith(APP_LINE);
/** The owner's own text in a Notes / Comments cell (everything the app didn't write). */
export const ownerText = (cell: string | undefined) =>
  (cell ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !isAppLine(l))
    .join("\n");

/** The owner's lines first, then the app's: the app only ever replaces its own lines. */
export function mergeCell(cell: string | undefined, appLines: string[]) {
  const own = ownerText(cell);
  return [own, ...appLines].filter(Boolean).join("\n");
}

const md = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Conversations the app writes to the sheet: everything except rows that came from the sheet itself. */
export const appChats = (c: Pick<Contact, "chats">) => (c.chats ?? []).filter((x) => x.source !== "spreadsheet").sort((a, b) => a.at.localeCompare(b.at));

/** "• 10/19 Coffee chat: talked about TMT · https://docs.google.com/…" */
export function notesLine(c: ChatLog) {
  const text = c.notes?.trim() || c.grade?.summary || (c.transcript ? "transcript saved" : "");
  return `${APP_LINE}${md(c.at)} ${KIND_LABEL[kindOf(c)]}${text ? `: ${oneLine(text, 240)}` : ""}${c.docUrl ? ` · ${c.docUrl}` : ""}`;
}

/** "• 10/19 B+ (84): Strong questions, rushed intro. Promised: intro to Sam; review resume" */
export function gradeLine(c: ChatLog) {
  const g = c.grade;
  if (!g) return "";
  const first = g.summary.split(/(?<=[.!?])\s/)[0] ?? g.summary;
  const promised = g.commitments.length ? ` Promised: ${g.commitments.map((x) => oneLine(x, 60)).join("; ")}` : "";
  return `${APP_LINE}${md(c.at)} ${g.letter} (${g.score}): ${oneLine(first, 160)}${promised}`;
}

/** "Coffee chat ×2 · Info session" over every conversation (including ones typed into the sheet). */
export function kindsSummary(chats: ChatLog[] | undefined) {
  const n = new Map<ConversationKind, number>();
  for (const c of chats ?? []) n.set(kindOf(c), (n.get(kindOf(c)) ?? 0) + 1);
  return [...n].map(([k, count]) => `${KIND_LABEL[k]}${count > 1 ? ` ×${count}` : ""}`).join(" · ");
}

export const latestChat = (chats: ChatLog[] | undefined) => [...(chats ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.]+/g, " ").trim();

/**
 * The person a Conversation row is about, among contacts at that bank: same email, else the same name, else a unique
 * last name + first initial ("Sam Lee" ↔ "Samantha Lee"). Undefined = an orphan (the log page asks).
 */
export function matchRow(row: Pick<ConversationRow, "name" | "email" | "bank">, contacts: Contact[], sameBank: (a: string, b: string) => boolean) {
  const email = row.email.trim().toLowerCase();
  if (email) {
    const hit = contacts.find((c) => c.email && c.email.toLowerCase() === email);
    if (hit) return hit;
  }
  const at = contacts.filter((c) => sameBank(c.bank, row.bank));
  const name = norm(row.name);
  const exact = at.filter((c) => norm(c.name) === name);
  if (exact.length === 1) return exact[0];
  const parts = name.split(" ");
  if (parts.length < 2) return undefined;
  const [first, last] = [parts[0], parts[parts.length - 1]];
  const loose = at.filter((c) => {
    const p = norm(c.name).split(" ");
    return p[p.length - 1] === last && p[0]?.[0] === first[0];
  });
  return loose.length === 1 ? loose[0] : undefined;
}

/** The conversation a hand-filled row stands for (kept with a stable id, so a re-import replaces it instead of adding one). */
export function sheetChat(row: ConversationRow): ChatLog | undefined {
  const notes = ownerText(row.notes);
  const conversation = row.conversation.trim();
  // A row the app filled (only "• " lines and its own kinds summary) holds nothing new.
  if (!notes && !row.date && !conversation) return undefined;
  if (!notes && !ownerText(row.comments) && [...row.notes.split("\n"), ...row.comments.split("\n")].some(isAppLine)) return undefined;
  // A rating in the Conversation column ("8/10") is the owner's own score, kept with the notes.
  const rating = conversation.match(RATING)?.[1];
  return {
    id: `sheet:${row.sheet}:${row.row}`,
    at: row.date ?? new Date(0).toISOString(),
    kind: kindFromText(rating ? "" : conversation),
    notes: [rating ? `Your rating: ${rating}/10` : "", notes, ownerText(row.comments)].filter(Boolean).join("\n") || undefined,
    source: "spreadsheet",
  };
}

/** Swap in the sheet's version of a contact's hand-typed conversation (or drop it when the row was cleared). */
export function withSheetChat(chats: ChatLog[] | undefined, fresh: ChatLog | undefined) {
  // One Conversation row per person, so at most one conversation comes from the sheet.
  const out = [...(chats ?? []).filter((c) => c.source !== "spreadsheet"), ...(fresh ? [fresh] : [])];
  return out.length ? out : undefined;
}
