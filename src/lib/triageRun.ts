"use client";

import { useStore } from "./store";
import { callApi } from "./api";
import { aiReady } from "./keys";
import { todoRows, type TodoRow, type Triage } from "./thinkAbout";
import type { Contact } from "./types";

/**
 * Asks the AI which Things-to-think-about items are noise (api/think/triage). Each verdict is stored on the contact for
 * the item's key (`contact.triage`), so it's asked once per new email; the hide decision and its safeguards are in
 * lib/thinkAbout.ts#withHidden. Your resolves and "keep it"s go along as examples. Single-flight.
 */

type Result = { results: { id: string; needed: boolean; reason: string; why: string; confidence: number; asks: boolean }[] };

const md = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
let running: Promise<number> | null = null;
let restUntil = 0;

function facts(c: Contact): string[] {
  const out: string[] = [];
  const chats = [...(c.chats ?? []).map((x) => x.at), ...(c.chatEvidence ?? []).map((x) => x.at)].sort();
  if (chats.length) out.push(`Talked with them on ${[...new Set(chats.map(md))].join(", ")}.`);
  if (c.call) out.push(`Call on the calendar ${md(c.call.at)}.`);
  if (c.referral) out.push(`They referred the student${c.referral.to?.length ? ` to ${c.referral.to.map((t) => t.name).join(", ")}` : ""}.`);
  if (c.referredBy) out.push(`${c.referredBy.name} referred the student to them.`);
  if (c.handledAt) out.push(`The student marked it done by hand (text / LinkedIn) on ${md(c.handledAt)}.`);
  if (c.comment) out.push(`Student's note: ${c.comment.slice(0, 300)}`);
  const lastChat = [...(c.chats ?? [])].sort((a, b) => a.at.localeCompare(b.at)).pop();
  if (lastChat?.notes) out.push(`Chat notes: ${lastChat.notes.slice(0, 300)}`);
  out.push(`Title: ${c.position || "unknown"}. Status: ${c.status}.`);
  return out.slice(0, 12);
}

function messages(c: Contact) {
  const L = c.mail;
  if (!L) return c.lastReply ? [{ dir: "in" as const, at: c.lastReply.at, subject: "", text: c.lastReply.text.slice(0, 1500) }] : [];
  return L.messages.slice(-6).map((m) => ({
    dir: m.dir,
    at: m.at,
    subject: m.subject.slice(0, 200),
    text: (m.id === L.lastIn?.id ? L.lastIn.text : m.id === L.lastOut?.id ? L.lastOut.text : m.snippet).slice(0, 1500),
  }));
}

function examples(contacts: Contact[]) {
  const out: string[] = [];
  for (const c of contacts) if (c.resolved) out.push(`Resolved as "${c.resolved.note}": ${c.name} (${c.bank})${c.chats?.length || c.chatEvidence?.length ? ", after a chat" : ""}${c.referral ? ", they had referred the student" : ""}.`);
  for (const c of contacts) if (c.triage?.kept) out.push(`Kept on the list although the AI said "${c.triage.reason}": ${c.name} (${c.bank}). Treat similar cases as needed.`);
  return out.slice(-20);
}

/** Items the AI hasn't read for their current email (thank-yous are never filtered: always signal). */
export const needsTriage = (rows: TodoRow[]) => rows.filter((r) => r.kind !== "thank" && !r.hidden && r.c.triage?.key !== r.key);

export function runTriage(opts: { force?: boolean } = {}): Promise<number> {
  if (running) return running;
  running = (async () => {
    const st = useStore.getState();
    if (!aiReady(st.settings) || (!opts.force && Date.now() < restUntil)) return 0;
    const rows = needsTriage(todoRows(st.contacts)).slice(0, 40);
    if (!rows.length) return 0;
    const ex = examples(st.contacts);
    let n = 0;
    for (let i = 0; i < rows.length; i += 8) {
      const batch = rows.slice(i, i + 8);
      try {
        const r = await callApi<Result>(
          "/api/think/triage",
          {
            items: batch.map((row) => ({
              id: row.c.id,
              kind: row.kind,
              name: row.c.name.slice(0, 120),
              bank: row.c.bank.slice(0, 120),
              title: (row.c.position ?? "").slice(0, 160),
              facts: facts(row.c),
              messages: messages(row.c),
            })),
            examples: ex,
          },
          useStore.getState().settings,
        );
        const at = new Date().toISOString();
        for (const row of batch) {
          const v = r.results.find((x) => x.id === row.c.id);
          if (!v) continue;
          const triage: Triage = { key: row.key, at, needed: v.needed, reason: v.reason, why: v.why.slice(0, 240), confidence: Math.max(0, Math.min(1, v.confidence)), asks: v.asks };
          useStore.getState().updateContact(row.c.id, { triage });
          n++;
        }
      } catch {
        // Quota / a bad answer: try again in half an hour, not on every page visit.
        restUntil = Date.now() + 30 * 60_000;
        break;
      }
    }
    return n;
  })().finally(() => {
    running = null;
  });
  return running;
}
