"use client";

import { useStore } from "./store";
import { docSection, dropMentionSlot, mentionFor, mentionSentence, withMention, MIN_RATING, type Mention } from "./smartMention";
import { linkChatDocs, readChatDoc } from "./chatDocs";
import type { Contact } from "./types";

/**
 * Browser side of smart mentions (lib/smartMention.ts): picks the chat, finds its Google Doc if it isn't linked yet
 * (lib/chatDocs.ts, Drive search), reads the doc fresh (private docs through the server's or this session's Docs
 * access, else link-shared only), and puts the sentence into a draft body before the AI fill.
 */

export function smartMentionFor(c: Contact): Mention | undefined {
  const s = useStore.getState();
  const cfg = s.settings.emailStyle.smartMentions;
  if (cfg && !cfg.on) return undefined;
  return mentionFor(c, s.contacts, cfg?.minRating ?? MIN_RATING);
}

/**
 * Add the mention to a filled body (call before the AI fill step). Follow-ups only mention a chat that happened after
 * your last email to this person (otherwise there's nothing new to say). Returns the body and who was named.
 */
export async function addSmartMention(c: Contact, body: string, kind: "initial" | "follow_up", ai: boolean): Promise<{ body: string; mention?: Mention }> {
  let m = smartMentionFor(c);
  const last = c.lastEmailedAt ?? c.lastTouchAt ?? c.sentAt;
  if (!m || (kind === "follow_up" && last && m.at <= last)) return { body: dropMentionSlot(body) };
  if (ai && !m.docUrl) {
    // Not linked yet: one Drive search for that person (no popup; skipped if it ran in the last day).
    await linkChatDocs({ contactId: m.contactId }).catch(() => undefined);
    m = smartMentionFor(c) ?? m;
  }
  const doc = ai && m.docUrl ? docSection(await readChatDoc(m.docUrl), m.name) : "";
  const sentence = mentionSentence(m, c, { ai, followUp: kind === "follow_up", docText: doc || undefined });
  const out = withMention(body, sentence, kind);
  return out === body ? { body: dropMentionSlot(body) } : { body: out, mention: m };
}
