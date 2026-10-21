/**
 * Logging conversations (the activity log, transcripts on /prep, later Google Docs) and keeping each person's
 * Conversation-table row (lib/conversations.ts). Everything goes through `logConversation` / `ensureConvRef`, so the
 * sheet, the 9 PM text and the person's record all see the same thing.
 */
import { useStore } from "./store";
import { callApi } from "./api";
import { hookFor } from "./hooks";
import { DEFAULT_GENERAL_QUESTIONS, DEFAULT_GRADING_RULES } from "./defaults";
import { allocateConversationRow } from "./workbook";
import { cleanRubric } from "./gradeRubric";
import { latestIso, uid } from "./util";
import type { ChatGrade, ChatLog, Contact, ConversationKind, Settings, Status } from "./types";
import type { ConversationRow } from "./conversations";

const takenRows = (contacts: Contact[]) => new Set(contacts.flatMap((c) => (c.convRef ? [`${c.convRef.sheet}:${c.convRef.row}`] : [])));

/**
 * Give someone a row in their bank tab's Conversation table if they don't have one (first blank numbered row).
 * Returns false when the table is full or there's no workbook: the conversation is still kept in the dashboard.
 */
export function ensureConvRef(contactId: string): boolean {
  const s = useStore.getState();
  const c = s.contacts.find((x) => x.id === contactId);
  if (!c) return false;
  if (c.convRef) return true;
  if (!s.workbook) return false;
  const convRef = allocateConversationRow(c, s.tables, takenRows(s.contacts));
  if (!convRef) return false;
  s.updateContact(c.id, { convRef });
  return true;
}

/** Status after a conversation actually happened (never moves a person backwards). */
const TALKED: Status[] = ["new", "drafted", "sent", "followed_up", "replied"];

export interface LogInput {
  kind: ConversationKind;
  at: string;
  notes?: string;
  docUrl?: string;
  /** How it felt (tone the notes don't carry). */
  feel?: string;
  transcript?: string;
  grade?: ChatGrade;
  source?: string;
}

/**
 * Record a conversation on a person and update what it implies: an email counts as an email sent (first email or the
 * latest one); a call / coffee chat / in-person chat means they engaged (status at least "Call scheduled", so the
 * 9 PM text asks for the thank-you). Returns whether it got a spreadsheet row.
 */
export function logConversation(contactId: string, input: LogInput): { chat: ChatLog; row: boolean } {
  const s = useStore.getState();
  const c = s.contacts.find((x) => x.id === contactId);
  if (!c) throw new Error("That person isn't in your contacts anymore.");
  const chat: ChatLog = {
    id: uid("chat"),
    at: input.at,
    kind: input.kind,
    notes: input.notes?.trim() || undefined,
    docUrl: input.docUrl?.trim() || undefined,
    feel: input.feel?.trim() || undefined,
    transcript: input.transcript?.trim() || undefined,
    grade: input.grade,
    source: input.source ?? "log",
  };
  const patch: Partial<Contact> = { chats: [chat, ...(c.chats ?? [])].sort((a, b) => b.at.localeCompare(a.at)) };
  if (input.kind === "email") {
    if (!c.sentAt) {
      patch.sentAt = input.at;
      patch.lastTouchAt = input.at;
      if (c.status === "new" || c.status === "drafted") patch.status = "sent";
    } else patch.lastEmailedAt = latestIso(c.lastEmailedAt, input.at);
  } else if (input.kind !== "info_session" && input.kind !== "other") {
    if (TALKED.includes(c.status)) patch.status = "call_scheduled";
    if (!c.repliedAt && c.sentAt) patch.repliedAt = input.at;
  }
  s.updateContact(c.id, patch, { at: new Date().toISOString(), type: "note", note: `Logged: ${input.kind.replace("_", " ")}` });
  return { chat, row: ensureConvRef(c.id) };
}

export function updateConversation(contactId: string, chatId: string, patch: Partial<ChatLog>) {
  const s = useStore.getState();
  const c = s.contacts.find((x) => x.id === contactId);
  if (!c) return;
  s.updateContact(c.id, { chats: (c.chats ?? []).map((x) => (x.id === chatId ? { ...x, ...patch } : x)) });
}

export function removeConversation(contactId: string, chatId: string) {
  const s = useStore.getState();
  const c = s.contacts.find((x) => x.id === contactId);
  if (!c) return;
  const chats = (c.chats ?? []).filter((x) => x.id !== chatId);
  s.updateContact(c.id, { chats: chats.length ? chats : undefined });
}

/** A Conversation-table row that matched nobody: link it to this person (their details get copied into the row). */
export function linkOrphan(row: ConversationRow, contactId: string) {
  const s = useStore.getState();
  const c = s.contacts.find((x) => x.id === contactId);
  if (!c) throw new Error("That person isn't in your contacts anymore.");
  if (c.convRef && (c.convRef.sheet !== row.sheet || c.convRef.row !== row.row))
    throw new Error(`${c.name} already has a conversation row (${c.convRef.sheet} row ${c.convRef.row}). One row per person: copy the notes there instead.`);
  s.updateContact(c.id, { convRef: { sheet: row.sheet, row: row.row } });
}

const MAX = 120_000;

/**
 * The AI grade of a conversation (api/prep/grade). Works from a transcript or from your notes / postmortem (it needs
 * about 200 characters to say anything useful).
 */
/** Your grading rules (Settings, grown by "Disagree" on a grade), else the defaults. */
export const gradingRules = (settings: Settings) => settings.prep?.gradingRules ?? DEFAULT_GRADING_RULES;

/** `feel` = how the call felt in your words (tone a transcript loses). */
export async function requestGrade(c: Contact, text: string, notes?: string, feel?: string): Promise<ChatGrade> {
  const settings = useStore.getState().settings;
  const p = settings.profile;
  const prep = c.prep;
  const general = settings.prep?.generalQuestions?.length ? settings.prep.generalQuestions : DEFAULT_GENERAL_QUESTIONS;
  const r = await callApi<Omit<ChatGrade, "gradedAt">>(
    "/api/prep/grade",
    {
      transcript: text.slice(0, MAX),
      contact: { name: c.name, bank: c.bank, position: c.position, team: c.team ?? "", school: c.school ?? "" },
      me: { name: p.name, school: p.school, major: p.major, pitch: hookFor(c, settings).text.slice(0, 1000) },
      prep: prep
        ? { brief: prep.brief.slice(0, 2000), intro: prep.intro.slice(0, 2000), questions: [...prep.tailored.map((t) => t.question), ...general].slice(0, 20).map((q) => q.slice(0, 400)) }
        : undefined,
      notes: (notes ?? prep?.notes)?.slice(0, 4000) || undefined,
      feel: feel?.trim().slice(0, 1000) || undefined,
      rules: gradingRules(settings).slice(0, 40).map((r) => r.slice(0, 500)),
      rubric: cleanRubric(settings.prep?.rubric),
    },
    settings,
  );
  return { ...r, gradedAt: new Date().toISOString() };
}

/** Notes aren't a transcript: say so, so the grader judges what's described rather than quoting. */
export const notesForGrading = (notes: string) => `[Your notes / postmortem of the conversation, not a verbatim transcript]\n${notes}`;
