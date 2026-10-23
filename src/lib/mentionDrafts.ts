"use client";

import { useStore } from "./store";
import { docSection, dropMentionSlot, mentionFor, mentionSentence, withMention, MIN_RATING, type Mention } from "./smartMention";
import type { Contact } from "./types";

/**
 * Browser side of smart mentions (lib/smartMention.ts): picks the chat, reads its Google Doc fresh (shared-by-link docs
 * only; a private doc just falls back to your stored notes), and puts the sentence into a draft body before the AI fill.
 */
const docs = new Map<string, Promise<string>>();

/** The doc's current text (cached for this page session, so a batch of drafts reads each doc once). */
function docText(url: string) {
  if (!/^https:\/\/docs\.google\.com\/document\/d\//.test(url)) return Promise.resolve("");
  let p = docs.get(url);
  if (!p) {
    p = fetch("/api/templates/gdoc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, format: "txt" }) })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    docs.set(url, p);
  }
  return p;
}

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
  const m = smartMentionFor(c);
  const last = c.lastEmailedAt ?? c.lastTouchAt ?? c.sentAt;
  if (!m || (kind === "follow_up" && last && m.at <= last)) return { body: dropMentionSlot(body) };
  const doc = ai && m.docUrl ? docSection(await docText(m.docUrl), m.name) : "";
  const sentence = mentionSentence(m, c, { ai, followUp: kind === "follow_up", docText: doc || undefined });
  const out = withMention(body, sentence, kind);
  return out === body ? { body: dropMentionSlot(body) } : { body: out, mention: m };
}
