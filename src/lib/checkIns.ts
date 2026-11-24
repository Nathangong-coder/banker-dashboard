"use client";

import { useStore } from "./store";
import { HOLIDAY_TEMPLATE, holidayFor } from "./defaults";
import { AI_SLOT, fillPlaceholders, hasAiSlots } from "./template";
import { withSignature } from "./emailFormat";
import { aiReady, googleClientId } from "./keys";
import { callApi } from "./api";
import { connectGmail, upsertDraft } from "./gmail";
import { listDrafts, type ListDraft } from "./handoffActions";
import { EMAIL_FONTS, type Contact, type Template } from "./types";

/**
 * Warm follow-ups → Overview → "Draft check-ins" (owner, 2026-11-23: who to email over Thanksgiving). Your "Holiday
 * check-in" template (added the first time, then yours to edit), one line from your last chat when the AI has notes,
 * written into their Gmail thread when there is one, then put on the "to schedule in Gmail" list at the next send slots.
 * Returns a summary line.
 */
function holidayTemplate(): Template {
  const st = useStore.getState();
  const t = st.templates.find((x) => x.id === HOLIDAY_TEMPLATE.id);
  if (t) return t;
  st.upsertTemplate(HOLIDAY_TEMPLATE);
  return HOLIDAY_TEMPLATE;
}

/** Facts the AI may use for its one line: your chat notes / summaries and their last email. Nothing else. */
function notesOf(c: Contact) {
  const chats = [...(c.chats ?? [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 2);
  return [
    ...chats.map((x) => [x.notes, x.grade?.summary].filter(Boolean).join(" ")),
    c.lastReply?.text ? `Their last email: ${c.lastReply.text.slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function draftCheckIns(people: Contact[]): Promise<string> {
  const st = useStore.getState();
  const clientId = googleClientId(st.settings);
  if (!clientId) throw new Error("Connect Gmail (Settings) to write check-ins into Gmail.");
  await connectGmail(clientId);
  const t = holidayTemplate();
  const holiday = holidayFor();
  const made: ListDraft[] = [];
  const failed: string[] = [];
  for (const c of people.filter((x) => x.email)) {
    try {
      // In their thread: Gmail threads a reply only when the subject matches ("Re: <their subject>").
      const last = c.mail?.messages?.at(-1);
      const threadId = last?.threadId ?? c.threadId;
      const subject = threadId && last?.subject ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : fillPlaceholders(t.subject, c, st.settings, { holiday });
      let body = fillPlaceholders(t.body, c, st.settings, { holiday });
      const notes = notesOf(c);
      if (hasAiSlots(body) && notes && aiReady(st.settings)) {
        const r = await callApi<{ subject: string; body: string }>(
          "/api/draft",
          {
            mode: "fill",
            contact: { id: c.id, name: c.name, bank: c.bank, position: c.position, location: [c.location, c.team].filter(Boolean).join(" · "), region: c.region, school: c.school, comment: notes },
            sender: { name: st.settings.profile.name, school: st.settings.profile.school },
            subject,
            body,
          },
          st.settings,
        );
        body = r.body;
      } else body = body.replace(new RegExp(AI_SLOT.source, "g"), "");
      body = withSignature(body, st.settings.profile);
      const d = await upsertDraft(clientId, undefined, {
        to: c.email,
        subject,
        body,
        threadId,
        inReplyTo: threadId ? c.lastMessageId : undefined,
        font: EMAIL_FONTS[c.trial?.font ?? st.settings.emailStyle.font]?.css,
      });
      useStore.getState().updateContact(c.id, {}, { at: new Date().toISOString(), type: "note", note: `${holiday} check-in drafted in Gmail` });
      made.push({ c, draftId: d.id, messageId: d.message.id, subject: threadId ? "" : subject, step: -1 });
    } catch (e) {
      failed.push(`${c.name}: ${(e as Error).message}`);
      if (/session expired|connect gmail/i.test((e as Error).message)) break;
    }
  }
  const listed = made.length ? await listDrafts(made, { checkIn: true }) : 0;
  const skipped = people.length - people.filter((x) => x.email).length;
  return [
    `${made.length} check-in${made.length === 1 ? "" : "s"} drafted in Gmail${listed ? `, ${listed} on your list to schedule (Cold outreach → Queue → Scheduled)` : ""}.`,
    skipped ? `${skipped} skipped (no email on file).` : "",
    failed.length ? `Not drafted: ${failed.slice(0, 2).join("; ")}${failed.length > 2 ? ` (+${failed.length - 2})` : ""}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
