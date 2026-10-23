import { canonBank } from "./banks";
import type { ChatLog, Contact } from "./types";

/**
 * Smart mentions (owner, 2026-10-23): when you've had a good chat at a bank (your rating 6/10 or better, or a grade
 * of 60+ when you didn't rate it), the next first email or follow-up to someone else there names that person and one
 * or two things they told you: "I recently spoke with Benjamin Hon, who told me about the mentorship-based culture,
 * and I'd love to learn more about tech at Mizuho from you."
 * Facts come only from your own record of the chat (notes, how it felt, the grade's summary / their advice /
 * thank-you points, and the live text of the chat's Google Doc when it's shared by link). The AI writes the clause
 * from those notes and is told never to add anything; with no AI the sentence names the person and nothing else.
 * Pure (no store): drafts / follow-ups call `mentionFor` with the contact list. `npm run check:mentions` covers it.
 */

export const MIN_RATING = 6;

export interface Mention {
  contactId: string;
  name: string;
  firstName: string;
  bank: string;
  team?: string;
  at: string;
  /** Out of 10: your own rating, else the grade / 10. */
  rating: number;
  /** Everything you wrote down about the chat, for the AI to pick from. */
  notes: string;
  docUrl?: string;
}

/** Your rating ("Your rating: 8/10", "8/10", "8.5 / 10"), else the AI grade on a 10-point scale, else undefined. */
export function chatRating(chat: ChatLog): number | undefined {
  const text = `${chat.notes ?? ""}\n${chat.feel ?? ""}`;
  // Only a rating that says so ("Your rating: 8/10", "rated 7.5/10") or a line that is just "8/10": the "9/10" in
  // "9/10 Coffee chat: …" is a date.
  const own =
    text.match(/\brat(?:ing|ed)\b[^\d\n]{0,12}(10|\d(?:\.\d)?)\s*\/\s*10\b/i) ?? text.match(/(?:^|\n)[ \t]*(10|\d(?:\.\d)?)[ \t]*\/[ \t]*10[ \t]*(?=\n|$)/);
  if (own) return Number(own[1]);
  if (chat.grade) return Math.round(chat.grade.score) / 10;
  return undefined;
}

/** The parts of a chat record worth quoting from (the transcript itself is too long and too raw). */
export function chatNotes(chat: ChatLog, limit = 1600) {
  const g = chat.grade;
  const parts = [
    chat.notes?.replace(/\b(?:your )?rat(?:ing|ed)\b[^\d\n]{0,12}\d+(?:\.\d)?\s*\/\s*10\b/gi, "").trim(),
    chat.feel && `How it felt: ${chat.feel}`,
    g?.summary && `Summary: ${g.summary}`,
    g?.theirAdvice?.length && `Their advice: ${g.theirAdvice.join("; ")}`,
    g?.thankYouPoints?.length && `Things they said: ${g.thankYouPoints.join("; ")}`,
  ].filter(Boolean) as string[];
  // The same text often sits in both the sheet's Notes cell and the chat log: keep each line once.
  const lines = [...new Set(parts.join("\n").split(/\n+/).map((l) => l.trim()).filter(Boolean))];
  return lines.join("\n").slice(0, limit);
}

/**
 * The best good chat at `target`'s bank with someone else: the latest one rated ≥ MIN_RATING (ties → higher rating).
 * Not someone who referred `target` (that email says so already), and not `target` themselves.
 */
export function mentionFor(target: Contact, contacts: Contact[], minRating = MIN_RATING): Mention | undefined {
  if (!target.bank) return undefined;
  const bank = canonBank(target.bank);
  let best: Mention | undefined;
  for (const c of contacts) {
    if (c.id === target.id || !c.bank || canonBank(c.bank) !== bank || c.id === target.referredBy?.contactId) continue;
    for (const chat of c.chats ?? []) {
      const rating = chatRating(chat);
      if (rating === undefined || rating < minRating) continue;
      const m: Mention = {
        contactId: c.id,
        name: c.name,
        firstName: c.firstName || c.name.split(" ")[0],
        bank: c.bank,
        team: c.team,
        at: chat.at,
        rating,
        notes: chatNotes(chat),
        docUrl: chat.docUrl,
      };
      if (!best || m.at > best.at || (m.at === best.at && m.rating > best.rating)) best = m;
    }
  }
  return best;
}

/** "Tech at Mizuho" when the target's team is known, else "Mizuho". */
const where = (target: Contact) => {
  const team = target.team && !/^(generalist|m&a|\?)$/i.test(target.team) ? target.team : "";
  return team ? `${team} at ${target.bank}` : target.bank;
};

/**
 * The sentence to put in the email. With AI: an [[AI: …]] slot that /api/draft fills from the notes. Without: a plain
 * sentence that only names the person (the one fact we know for sure is that the chat happened and went well).
 */
export function mentionSentence(m: Mention, target: Contact, opts: { ai: boolean; followUp?: boolean; docText?: string }) {
  const lead = opts.followUp ? "Since my last email, I had" : "I recently had";
  if (!opts.ai || !(m.notes || opts.docText))
    return `${lead} a great conversation with ${m.name} about ${m.firstName}'s experience at ${m.bank}, and I would love to hear your perspective on ${where(target)} as well.`;
  const notes = [m.notes, opts.docText && `From the chat's notes doc:\n${opts.docText}`].filter(Boolean).join("\n\n").replace(/\]\]/g, "] ]");
  return (
    `[[AI: Write ONE sentence in the sender's own voice${opts.followUp ? ', starting "Since my last email,"' : ""}: they recently spoke with ${m.name} ` +
    `at ${m.bank}, name one or two specific things ${m.firstName} told them, taken ONLY from the notes below (no other facts, ` +
    `nothing about deals, numbers or people that the notes don't say; nothing negative, nothing private or confidential), ` +
    `and say they'd love to learn more about ${where(target)} from the recipient. Plain, warm, under 45 words. ` +
    `If the notes have nothing specific and positive, write: "I recently had a great conversation with ${m.name}, and I would love to hear your perspective on ${where(target)} as well." ` +
    `Notes:\n"""\n${notes}\n"""]]`
  );
}

/**
 * Put the sentence into a body. A template's own {{chat_mention}} wins; otherwise a first email gets it at the start of
 * the paragraph after the intro (where the hook is), and a follow-up gets it as its own paragraph after the first one.
 * Paragraphs = blocks split by blank lines; [0] is the greeting.
 */
export function withMention(body: string, sentence: string, kind: "initial" | "follow_up") {
  if (/\{\{\s*chat_mention\s*\}\}/.test(body)) return body.replace(/\{\{\s*chat_mention\s*\}\}/g, sentence);
  const paras = body.split(/\n[ \t]*\n/);
  if (paras.length < 3) return body;
  if (kind === "initial") {
    const i = paras.length > 3 ? 2 : 1;
    paras[i] = `${sentence} ${paras[i]}`;
  } else paras.splice(2, 0, sentence);
  return paras.join("\n\n");
}

/** A template that has no {{chat_mention}} slot left empty (so it isn't shown as a missing placeholder). */
export const dropMentionSlot = (body: string) => body.replace(/[ \t]*\{\{\s*chat_mention\s*\}\}[ \t]*/g, " ").replace(/ +\n/g, "\n");

/** The part of a long notes doc about this person (docs often hold many chats): about 3,000 chars around their name. */
export function docSection(text: string, name: string, limit = 3000) {
  if (text.length <= limit) return text;
  const last = name.split(" ").slice(-1)[0];
  const i = [name, last].map((n) => text.toLowerCase().indexOf(n.toLowerCase())).find((x) => x >= 0) ?? -1;
  if (i < 0) return text.slice(0, limit);
  const start = Math.max(0, i - 500);
  return text.slice(start, start + limit);
}
