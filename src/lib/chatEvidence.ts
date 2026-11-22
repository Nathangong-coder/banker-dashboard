import type { Contact } from "./types";
import { DAY } from "./util";

/**
 * How many chats you've had with someone, and how sure we are (owner, 2026-11-22: "UBS with Joe Romagnoli is only 1 —
 * idk how you found 3… make sure [calendar and email] reconcile — if they don't and you're uncertain, escalate").
 * Pure; `check:night` covers it.
 *
 * Every piece of evidence is grouped into one chat when it's about the same meeting:
 *  - anchors (a time you met): a past calendar event with them as a guest, a past `call`, a chat you logged on /log
 *    or typed in the sheet (only coffee chat / call / in person: an "email" or "info session" entry isn't a chat);
 *  - a thank-you email you sent (`thanks`), or a Resolve note saying you thanked them.
 * Anchors within 2 days of each other are one meeting (a rescheduled event, a transcript graded the next day); a sheet
 * row (its Date cell is whatever was typed last) and a thank-you join the meeting up to 7 days before them.
 *
 * Each chat then gets a state:
 *  - confirmed: you logged it / said yes, or the calendar AND a thank-you email agree;
 *  - likely: on the calendar in the last 3 days, thank-you not sent yet (it's on your to-do list) — counted;
 *  - check: only one source and it's old enough that a thank-you should exist (calendar but no thank-you or notes;
 *    a thank-you with no meeting) — NOT counted, listed for you to confirm (Things to think about → Chats to confirm);
 *  - rejected: you said it didn't happen — never counted or asked again.
 */
export type ChatSource = "logged" | "sheet" | "calendar" | "call" | "thanks" | "note";
export type ChatState = "confirmed" | "likely" | "check" | "rejected";
export interface ChatRecord {
  /** YYYY-MM-DD of the meeting (the anchor), else of the thank-you. The key for your yes / no (`chatVerdicts`). */
  day: string;
  at: string;
  sources: { source: ChatSource; at: string; ref?: string; label: string }[];
  state: ChatState;
  /** Plain words: why it's counted or why we're asking. */
  why: string;
}

type ChatInput = Pick<Contact, "chats" | "call" | "chatEvidence"> & Partial<Pick<Contact, "chatVerdicts" | "resolved">>;

/** The local calendar day of an instant (YYYY-MM-DD): the key for your yes / no on a chat. */
export function chatDayKey(at: string | number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Logged kinds that are a 1:1 conversation. */
const CHAT_KINDS = new Set([undefined, "coffee_chat", "call", "in_person"]);
const ANCHOR_GAP = 2 * DAY;
const AFTER_GAP = 7 * DAY;
const THANKS_DUE = 3 * DAY;

const LABEL: Record<ChatSource, string> = {
  logged: "Logged by you",
  sheet: "Conversation row in your sheet",
  calendar: "On your Google Calendar",
  call: "Call on your calendar",
  thanks: "Thank-you email you sent",
  note: "Your note",
};

export function chatRecords(c: ChatInput, now = Date.now()): ChatRecord[] {
  type Ev = { source: ChatSource; t: number; ref?: string };
  const anchors: Ev[] = [];
  const late: Ev[] = [];
  for (const x of c.chats ?? []) {
    const t = Date.parse(x.at);
    if (!(t <= now) || !CHAT_KINDS.has(x.kind)) continue;
    if (x.source === "spreadsheet") late.push({ source: "sheet", t, ref: x.id });
    else anchors.push({ source: "logged", t, ref: x.id });
  }
  for (const e of c.chatEvidence ?? []) {
    const t = Date.parse(e.at);
    if (!(t <= now)) continue;
    if (e.source === "calendar") anchors.push({ source: "calendar", t, ref: e.ref });
    else late.push({ source: "thanks", t, ref: e.ref });
  }
  if (c.call && Date.parse(c.call.at) <= now && !(c.chatEvidence ?? []).some((e) => e.ref === c.call!.eventId)) anchors.push({ source: "call", t: Date.parse(c.call.at), ref: c.call.eventId });
  if (c.resolved && /thank/i.test(c.resolved.note) && Date.parse(c.resolved.at) <= now) late.push({ source: "note", t: Date.parse(c.resolved.at), ref: c.resolved.note });

  // Anchors close together are one meeting.
  anchors.sort((a, b) => a.t - b.t);
  const groups: { t: number; ev: Ev[] }[] = [];
  for (const a of anchors) {
    const g = groups[groups.length - 1];
    if (g && a.t - g.ev[g.ev.length - 1].t <= ANCHOR_GAP) g.ev.push(a);
    else groups.push({ t: a.t, ev: [a] });
  }
  // A sheet row / thank-you joins the latest meeting up to 7 days before it (a day of slack for time zones).
  late.sort((a, b) => a.t - b.t);
  for (const l of late) {
    const g = [...groups].reverse().find((x) => l.t >= x.t - DAY && l.t - x.ev[x.ev.length - 1].t <= AFTER_GAP);
    if (g) g.ev.push(l);
    else {
      // A second thank-you with no meeting of its own, within a week of another one: the same chat (a resend, a reply).
      const prev = [...groups].reverse().find((x) => x.ev.every((e) => e.source === "thanks" || e.source === "note" || e.source === "sheet") && l.t - x.ev[x.ev.length - 1].t <= AFTER_GAP);
      if (prev) prev.ev.push(l);
      else groups.push({ t: l.t, ev: [l] });
    }
  }

  const verdicts = c.chatVerdicts ?? {};
  return groups
    .map((g) => {
      const has = (s: ChatSource) => g.ev.some((e) => e.source === s);
      const day = chatDayKey(g.t);
      const meeting = has("calendar") || has("call");
      const thanked = has("thanks") || has("note");
      const verdict = verdicts[day];
      let state: ChatState;
      let why: string;
      if (verdict === "no") [state, why] = ["rejected", "You said this chat didn't happen."];
      else if (verdict === "yes") [state, why] = ["confirmed", "You confirmed this chat."];
      else if (has("logged")) [state, why] = ["confirmed", "You logged this chat."];
      else if (meeting && (thanked || has("sheet"))) [state, why] = ["confirmed", thanked ? "Your calendar and a thank-you email agree." : "Your calendar and your sheet agree."];
      else if (meeting && now - g.t <= THANKS_DUE) [state, why] = ["likely", "On your calendar; no thank-you yet (it's on your to-do list)."];
      else if (meeting) [state, why] = ["check", "On your calendar, but there's no thank-you email or notes. Did this chat happen?"];
      else if (has("sheet") && thanked) [state, why] = ["confirmed", "Your sheet and a thank-you email agree."];
      else if (has("sheet")) [state, why] = ["confirmed", "Typed into your sheet's Conversation table."];
      else [state, why] = ["check", "A thank-you email with no calendar event or notes. Was this a chat?"];
      return {
        day,
        at: new Date(g.t).toISOString(),
        sources: g.ev.sort((a, b) => a.t - b.t).map((e) => ({ source: e.source, at: new Date(e.t).toISOString(), ref: e.ref, label: LABEL[e.source] })),
        state,
        why,
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Days of chats that count (confirmed + likely). */
export const chatDays = (c: ChatInput, now = Date.now()) => chatRecords(c, now).filter((r) => r.state === "confirmed" || r.state === "likely").map((r) => r.day);
export const chatCount = (c: ChatInput, now = Date.now()) => chatDays(c, now).length;
/** Chats we're not sure about: you're asked (yes / no) instead of them being counted. */
export const chatsToCheck = (c: ChatInput, now = Date.now()) => chatRecords(c, now).filter((r) => r.state === "check");

/**
 * Is this sent email a thank-you for a chat? Its own text only (quoted history cut by the caller): Gmail's search
 * matched quoted text and asks ("would you have time to chat?", "looking forward to our call"), which counted
 * scheduling emails and every later reply in a thread as more chats. The cold-email close "Thank you for your time"
 * alone never counts.
 */
export function isThankYouText(text: string) {
  const t = text.replace(/\s+/g, " ").slice(0, 1500);
  const THANK =
    /\b(thanks|thank you)( (so|very) much)?( again)? for (taking (the )?time|the time|your time|making (the )?time|carving out (some )?time)( out)?( (out of your (busy )?(day|schedule)|today|yesterday|earlier))? to (chat|speak|talk|meet|connect|hop on)/i;
  const THANK_FOR = /\b(thanks|thank you)( (so|very) much)?( again)? for (the|our|today's|yesterday's|this (morning|afternoon)'s|such a (great|helpful|insightful)) (great |helpful |insightful |wonderful )?(chat|call|conversation|meeting|coffee)/i;
  const THANK_ING = /\b(thanks|thank you)( (so|very) much)?( again)? for (chatting|speaking|talking|meeting) with me/i;
  const ENJOY = /\b(it was (great|nice|a pleasure)|(really )?enjoyed|great) (chatting|speaking|talking|meeting|getting to know)|\b(enjoyed|appreciated) our (chat|call|conversation)/i;
  return THANK.test(t) || THANK_FOR.test(t) || THANK_ING.test(t) || ENJOY.test(t);
}

/** Add evidence without duplicates (by source + ref). Returns undefined when nothing new. */
export function withEvidence(c: Pick<Contact, "chatEvidence">, add: NonNullable<Contact["chatEvidence"]>): Contact["chatEvidence"] | undefined {
  const have = new Set((c.chatEvidence ?? []).map((e) => `${e.source}|${e.ref}`));
  const fresh = add.filter((e) => !have.has(`${e.source}|${e.ref}`));
  if (!fresh.length) return undefined;
  return [...(c.chatEvidence ?? []), ...fresh].sort((a, b) => a.at.localeCompare(b.at)).slice(-60);
}

/**
 * Gmail search for thank-you emails after a chat. Chat wording only: the cold-email close ("Thank you for your time")
 * and the signature ("Thanks,") never match. The caller still requires that they'd replied (or a calendar chat) before.
 */
export const THANKS_QUERY =
  '("time to chat" OR "time to speak" OR "time to talk" OR "time to meet" OR "for chatting" OR "for speaking with me" OR "great chatting" OR "great speaking" OR "great talking" OR "enjoyed speaking" OR "enjoyed chatting" OR "enjoyed our" OR "our conversation" OR "our call" OR "our chat")';

/**
 * Thank-you emails (sent mail matching THANKS_QUERY) → evidence per contact: the recipient is them (address or alias),
 * and they had written back or met you on the calendar before the email went out.
 */
export function thanksEvidence(
  sent: { id: string; email: string; at: number; threadId?: string }[],
  contacts: Contact[],
): { id: string; add: NonNullable<Contact["chatEvidence"]> }[] {
  const byAddr = new Map<string, Contact>();
  for (const c of contacts) for (const e of [c.email, ...(c.aliases ?? [])]) if (e) byAddr.set(e.trim().toLowerCase(), c);
  const out = new Map<string, NonNullable<Contact["chatEvidence"]>>();
  for (const s of sent) {
    const c = byAddr.get(s.email.toLowerCase());
    if (!c) continue;
    const heard = [c.repliedAt, c.lastHeardAt].filter((x): x is string => !!x).map(Date.parse);
    const met = [c.call?.at, ...(c.chats ?? []).map((x) => x.at), ...(c.chatEvidence ?? []).filter((e) => e.source === "calendar").map((e) => e.at)].filter((x): x is string => !!x).map(Date.parse);
    // A chat needs them to have answered first (or a meeting on the calendar): a cold email never counts.
    if (![...heard, ...met].some((t) => t <= s.at)) continue;
    const list = out.get(c.id) ?? [];
    // One thank-you per thread: later emails in the same chain ("Thanks again!") are the same thank-you.
    const ref = s.threadId ? `t:${s.threadId}` : s.id;
    const i = list.findIndex((e) => e.ref === ref);
    if (i < 0) list.push({ at: new Date(s.at).toISOString(), source: "thanks", ref });
    else if (Date.parse(list[i].at) > s.at) list[i] = { ...list[i], at: new Date(s.at).toISOString() };
    out.set(c.id, list);
  }
  return [...out].map(([id, add]) => ({ id, add }));
}
