import { BLOCK_PRESETS, pickBanks, type Block, type TextLayout, type WarmLine } from "./textLayout";
/**
 * The WhatsApp text, shared by the browser (reminders.ts) and the server (api/server/tick), so both send the same
 * thing: sections by action ("*Thank-you (call today)* (2)", "*Follow-up #2* (5)"), one "• Name: email" line per
 * person, split into messages under `maxLen` characters (CallMeBot sends one text per call). It goes out at 9 PM,
 * Monday–Thursday, and lists what's due before the next text, so tomorrow's emails can be scheduled tonight.
 */

export interface DigestItem {
  contactId: string;
  name: string;
  email?: string;
  /** One of LABELS, or "Follow-up #n" */
  label: string;
}

export const LABELS = {
  thankToday: "Thank-you (call today)",
  infoSession: "Info session thank-you",
  thankOwed: "Thank-you not sent yet",
  replyOwed: "They wrote back: reply",
  checkIn: "Check in (7+ days since your last email)",
  /** They replied, you answered, no chat yet, 4+ days of nothing (lib/thinkAbout.ts: re-follow up sooner). */
  quiet: "Went quiet: nudge them (4+ days, no chat yet)",
  /** Dated reminders: "reach out in January" from a reply / chat notes, or added on Things to think about. */
  reminder: "Reminders",
  /** A chat only one source shows (calendar with no thank-you, or a thank-you with no meeting): not counted until you say (lib/chatEvidence.ts). */
  confirmChat: "Chats to confirm (calendar and email disagree)",
  referral: "Referral to-do",
  moveOn: "Move on?",
  fillOffices: "Offices to fill (find people / start emailing)",
  /** Calls on your calendar tomorrow (the server reads them): a prep link each. */
  prepTomorrow: "Calls tomorrow: prep",
} as const;

/** Section order: tonight's thank-yous, then people who replied, then cold outreach (last chances first). */
const ORDER: string[] = [LABELS.thankToday, LABELS.infoSession, LABELS.thankOwed, LABELS.replyOwed, LABELS.reminder, LABELS.confirmChat, LABELS.referral, LABELS.quiet, LABELS.checkIn, LABELS.prepTomorrow, LABELS.moveOn, LABELS.fillOffices];
/** Follow-ups (people already in flight) go before "move on?" and new offices to fill. */
const sectionRank = (label: string) => {
  const n = label.match(/^Follow-up #(\d+)/)?.[1];
  if (n) return ORDER.indexOf(LABELS.moveOn) - 1 + Number(n) / 100;
  const i = ORDER.indexOf(label);
  return i >= 0 ? i : ORDER.length;
};

/** The closing reminder after a day with calls: names + notes from the notes doc into the tracker. */
export const TRACKER_NOTE = "📝 Update the tracker: add today's people + conversation notes from your notes doc to the Excel.";

export interface CallPerson {
  contactId: string;
  name: string;
  bank?: string;
  linkedin?: string;
}

/** Their LinkedIn profile, else a LinkedIn people search for name + bank. */
export const linkedinLink = (p: Pick<CallPerson, "name" | "bank" | "linkedin">) =>
  p.linkedin && /linkedin\.com\/in\//i.test(p.linkedin) ? p.linkedin : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${p.name} ${p.bank ?? ""}`.trim())}`;

/**
 * After a day with calls, one block per person you talked to: log how it went (the Activity log, pre-filled, which
 * also fills their Conversation row in the tracker) and connect on LinkedIn. Without people known by the dashboard
 * (calls matched by title only), the plain tracker reminder.
 */
export function afterCallLines(people: CallPerson[], app: string, day: string): string[] {
  if (!people.length) return [TRACKER_NOTE];
  return [
    "*After today's calls* 📝🤝",
    ...people.slice(0, 8).map(
      (p) => `• ${p.name}
  Log how it went: ${app}/log?log=${encodeURIComponent(p.contactId)}&kind=coffee_chat&date=${day}
  Connect on LinkedIn: ${linkedinLink(p)}`,
    ),
  ];
}

/**
 * `extra` = plain lines appended after the sections ("Going out tomorrow (scheduled): 4", the tracker reminder).
 * A number is the old `queuedToday` count.
 */
export function digestMessages(items: DigestItem[], extra: number | string[] = [], maxLen = 900): string[] {
  const sections = new Map<string, string[]>();
  for (const it of items) sections.set(it.label, [...(sections.get(it.label) ?? []), it.email ? `• ${it.name}: ${it.email}` : `• ${it.name}`]);
  const blocks = [...sections.entries()].sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]));
  const tail = typeof extra === "number" ? (extra ? [`Going out today (scheduled): ${extra}`] : []) : extra;
  for (const line of tail) blocks.push([line, []]);

  const messages: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) messages.push(cur.trim());
    cur = "";
  };
  for (const [header, lines] of blocks) {
    const head = lines.length ? `*${header}* (${lines.length})` : header;
    if (cur && cur.length + head.length + (lines[0]?.length ?? 0) + 4 > maxLen) flush();
    cur += `${cur ? "\n\n" : ""}${head}`;
    for (const line of lines) {
      if (cur.length + line.length + 1 > maxLen) {
        flush();
        cur = `*${header}* (cont.)`;
      }
      cur += `\n${line}`;
    }
  }
  flush();
  return messages;
}

export const digestTitle = (i: number, n: number) => (n > 1 ? `Tonight's networking list (${i + 1}/${n})` : "Tonight's networking list");

/** Text nights: Monday–Thursday (sends go out Tue–Thu mornings, so Thursday night covers Friday through Monday). */
/**
 * The "press Search" reminder (owner, 2026-10-26): a line in the text night's message when your last job search was
 * `everyDays` or more days ago (or never). `lastAt` is ISO; `day` is tonight in your zone (YYYY-MM-DD).
 */
export function jobRunLine(jobRun: { lastAt?: string; everyDays: number } | undefined, day: string, app: string): string | null {
  if (!jobRun) return null;
  const last = jobRun.lastAt?.slice(0, 10);
  const days = last ? Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${last}T12:00:00Z`)) / 86_400_000) : Infinity;
  if (days < Math.max(1, jobRun.everyDays)) return null;
  const when = days === Infinity ? "you haven't searched yet" : days === 1 ? "last run yesterday" : `last run ${days} days ago`;
  return `🔎 Find jobs: press Search (${when}): ${app}/applications?find=1`;
}

/** Every night (owner, 2026-11-21: "it's not sending daily"; it was Mon–Thu, Fri–Sun only after calls). */
export const TEXT_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const TEXT_HOUR = 21;

/** Weekday (0 = Sunday) of a YYYY-MM-DD day. */
export const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const plusDays = (day: string, n: number) => new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const isTextDay = (day: string) => TEXT_DAYS.includes(weekdayOf(day));

/** The next text night after `day` (YYYY-MM-DD). Tonight's list covers everything due through the end of that day. */
export function nextTextDay(day: string) {
  for (let i = 1; i <= 7; i++) {
    const d = plusDays(day, i);
    if (isTextDay(d)) return d;
  }
  return plusDays(day, 1);
}

/* ---------------- the "Big banks" message (lib/nightProgress.ts builds it in the browser) ---------------- */

export interface ProgressBank {
  bank: string;
  /** bankHealth score (null = nothing yet). */
  score: number | null;
  /** Process tracker column ("Networking", "First round"…), when set. */
  column?: string;
  chats: number;
  emailed: number;
  live: number;
  /** Application: "applied" (in, not closed), "open" (a posting is tracked), "closed", or none known. */
  app?: "applied" | "open" | "closed";
  next?: string;
  /** For the text builder's filters (lib/textLayout.ts): tier (0 = bulge bracket), urgency 0–100, starred, last activity. */
  tier?: number;
  urgency?: number;
  starred?: boolean;
  lastAt?: string;
}

export interface NightProgress {
  /** When the dashboard computed it (the server says "as of …" when it's old). */
  at: string;
  banks: ProgressBank[];
  /** Up to three "do better" lines. */
  tips: string[];
  week: { emails: number; replies: number; chats: number };
  /** Every bank (not just the big ones), for a custom text's Banks blocks. */
  all?: ProgressBank[];
  /** Everyone you're in touch with, for a custom text's Warm block. */
  warm?: WarmLine[];
}

/** One emoji for a text message: ⚪ nothing, 🔴 bad, 🟡 emailed / early, 🟢 chats or a referral. */
export function healthEmoji(score: number | null) {
  if (score === null) return "⚪";
  if (score < 30) return "🔴";
  if (score < 44) return "🟡";
  return "🟢";
}

/** One line per bank: "🟢 Goldman Sachs (First round): 2 chats · applied → Reply to Jane". */
export function progressLines(p: NightProgress, max = 10): string[] {
  return p.banks.slice(0, max).map((b) => {
    const facts = [
      b.chats ? `${b.chats} chat${b.chats > 1 ? "s" : ""}` : b.emailed ? `${b.emailed} emailed${b.live ? `, ${b.live} waiting` : ""}` : "nobody emailed",
      b.app === "applied" ? "applied" : b.app === "open" ? "app open" : b.app === "closed" ? "app closed" : "",
    ].filter(Boolean);
    return `${healthEmoji(b.score)} ${b.bank}${b.column ? ` (${b.column})` : ""}: ${facts.join(" · ")}${b.next ? ` → ${b.next}` : ""}`.slice(0, 200);
  });
}

/* ---------------- the three messages (owner, 2026-11-21: "too long… 2-3 messages") ---------------- */

/** Message 2: people waiting on you. Message 3: new outreach (follow-ups, offices to fill). */
const TODO = new Set<string>([LABELS.thankToday, LABELS.infoSession, LABELS.thankOwed, LABELS.replyOwed, LABELS.reminder, LABELS.confirmChat, LABELS.referral, LABELS.quiet, LABELS.checkIn, LABELS.prepTomorrow]);
export const isTodoLabel = (label: string) => TODO.has(label);

/**
 * Up to three WhatsApp messages: 📊 how the big banks are going (+ what to do better), ✅ to-do (thank-yous, replies,
 * check-ins, referrals, tomorrow's calls), 📬 outreach (follow-ups due, offices to fill). Each section lists at most
 * `perSection` people, then "+N more" with a link, so a message stays readable on a phone. A message is skipped when
 * it has nothing to say; one that still runs past `maxLen` is split.
 */
export function nightMessages(o: {
  items: DigestItem[];
  progress?: NightProgress;
  /** "(as of Mon 11/17: open Coverage to refresh)" when the browser hasn't pushed a fresh plan. */
  progressNote?: string;
  /** Lines after the to-do sections ("After today's calls", the tracker reminder). */
  todoExtra?: string[];
  /** Lines after the outreach sections ("Already scheduled…", the job search reminder). */
  outreachExtra?: string[];
  app: string;
  perSection?: number;
  maxLen?: number;
  /** Your own text (lib/textLayout.ts). Undefined = the Standard text below, unchanged. */
  layout?: TextLayout | null;
}): string[] {
  if (o.layout) return layoutMessages(o, o.layout);
  const per = o.perSection ?? 8;
  const maxLen = o.maxLen ?? 1500;
  const out: string[] = [];

  if (o.progress && (o.progress.banks.length || o.progress.tips.length)) {
    const p = o.progress;
    const lines = ["📊 *Big banks*" + (o.progressNote ? ` ${o.progressNote}` : ""), ...progressLines(p, 10)];
    if (p.week.emails || p.week.replies || p.week.chats) lines.push("", `This week: ${p.week.emails} emailed · ${p.week.replies} replied · ${p.week.chats} chat${p.week.chats === 1 ? "" : "s"}`);
    if (p.tips.length) lines.push("", "*Do better*", ...p.tips.map((t) => `• ${t}`));
    lines.push("", `Process tracker: ${o.app}/process`);
    out.push(...split(lines.join("\n"), maxLen));
  }

  const section = (label: string, list: DigestItem[], link: string) => {
    const shown = list.slice(0, per).map((it) => (it.email ? `• ${it.name}: ${it.email}` : `• ${it.name}`));
    if (list.length > per) shown.push(`  +${list.length - per} more: ${link}`);
    return [`*${label}* (${list.length})`, ...shown].join("\n");
  };
  const group = (title: string, keep: (label: string) => boolean, link: (label: string) => string, extra: string[] = []) => {
    const by = new Map<string, DigestItem[]>();
    for (const it of o.items) if (keep(it.label)) by.set(it.label, [...(by.get(it.label) ?? []), it]);
    const blocks = [...by.entries()].sort((a, b) => sectionRank(a[0]) - sectionRank(b[0])).map(([label, list]) => section(label, list, link(label)));
    if (!blocks.length && !extra.length) return;
    out.push(...split([title, ...blocks, ...extra].join("\n\n"), maxLen));
  };
  group("✅ *To-do*", isTodoLabel, () => `${o.app}/followups`, o.todoExtra);
  group("📬 *Outreach*", (l) => !isTodoLabel(l), (l) => (l === LABELS.fillOffices ? `${o.app}/coverage` : `${o.app}/followups`), o.outreachExtra);
  return out;
}

/* ---------------- your own text (owner, 2026-11-24; lib/textLayout.ts) ---------------- */

/** Must-do = what can't wait: thank-yous, replies owed, tomorrow's calls. */
const MUST_DO = new Set<string>([LABELS.thankToday, LABELS.infoSession, LABELS.thankOwed, LABELS.replyOwed, LABELS.prepTomorrow]);

function layoutMessages(o: Parameters<typeof nightMessages>[0], layout: TextLayout): string[] {
  const maxLen = o.maxLen ?? 1500;
  const p = o.progress;
  const sections = (list: DigestItem[], per: number, emails: boolean, link: (label: string) => string) => {
    const by = new Map<string, DigestItem[]>();
    for (const it of list) by.set(it.label, [...(by.get(it.label) ?? []), it]);
    return [...by.entries()]
      .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]))
      .map(([label, l]) => {
        const shown = l.slice(0, per).map((it) => (emails && it.email ? `• ${it.name}: ${it.email}` : `• ${it.name}`));
        if (l.length > per) shown.push(`  +${l.length - per} more: ${link(label)}`);
        return [`*${label}* (${l.length})`, ...shown].join("\n");
      });
  };
  const block = (b: Block): string => {
    if (b.type === "banks") {
      if (!p) return "";
      const list = pickBanks(p.all ?? p.banks, b);
      if (!list.length) return "";
      const fields = new Set(b.fields?.length ? b.fields : ["step", "chats", "app", "next"]);
      const title = BLOCK_PRESETS.banks.find((x) => x.id === b.preset)?.label ?? "Banks";
      const lines = list.map((x) => {
        const facts = [
          fields.has("chats") ? (x.chats ? `${x.chats} chat${x.chats > 1 ? "s" : ""}` : x.emailed ? `${x.emailed} emailed${x.live ? `, ${x.live} waiting` : ""}` : "nobody emailed") : "",
          fields.has("app") ? (x.app === "applied" ? "applied" : x.app === "open" ? "app open" : x.app === "closed" ? "app closed" : "") : "",
        ].filter(Boolean);
        return `${healthEmoji(x.score)} ${x.bank}${fields.has("step") && x.column ? ` (${x.column})` : ""}${facts.length ? `: ${facts.join(" · ")}` : ""}${fields.has("next") && x.next ? ` → ${x.next}` : ""}`.slice(0, 200);
      });
      return [`📊 *${title}*${o.progressNote ? ` ${o.progressNote}` : ""}`, ...lines].join("\n");
    }
    if (b.type === "week") return p && (p.week.emails || p.week.replies || p.week.chats) ? `This week: ${p.week.emails} emailed · ${p.week.replies} replied · ${p.week.chats} chat${p.week.chats === 1 ? "" : "s"}` : "";
    if (b.type === "tips") return p?.tips.length ? ["*Do better*", ...p.tips.slice(0, b.max ?? 3).map((t) => `• ${t}`)].join("\n") : "";
    if (b.type === "todo") {
      const list = o.items.filter((it) => isTodoLabel(it.label) && (b.preset !== "must_do" || MUST_DO.has(it.label)));
      const extra = o.todoExtra ?? [];
      if (!list.length && !extra.length) return "";
      return ["✅ *To-do*", ...sections(list, b.perKind ?? 8, b.preset !== "names_only", () => `${o.app}/todo`), ...extra].join("\n\n");
    }
    if (b.type === "cold") {
      const list = o.items.filter((it) => !isTodoLabel(it.label) && (b.preset === "followups_offices" || it.label !== LABELS.fillOffices));
      const extra = b.scheduledLine === false ? [] : (o.outreachExtra ?? []);
      if (!list.length && !extra.length) return "";
      return ["📬 *Outreach*", ...sections(list, b.perKind ?? 8, true, (l) => (l === LABELS.fillOffices ? `${o.app}/coverage` : `${o.app}/followups`)), ...extra].join("\n\n");
    }
    if (b.type === "warm") {
      const now = Date.now();
      const days = (b.days ?? 21) * 86_400_000;
      const people = (p?.warm ?? []).filter((w) =>
        b.preset === "check_in" ? w.owed === "check_in" || w.owed === "quiet" : b.preset === "not_heard" ? !w.lastAt || now - Date.parse(w.lastAt) >= days : true,
      );
      if (!people.length) return "";
      const max = b.max ?? 25;
      const byBank = new Map<string, string[]>();
      for (const w of people.slice(0, max)) byBank.set(w.bank, [...(byBank.get(w.bank) ?? []), w.name]);
      const title = b.preset === "check_in" ? "Check in" : b.preset === "not_heard" ? `Not heard from in ${b.days ?? 21}+ days` : "Everyone you're in touch with";
      return [`🤝 *${title}* (${people.length})`, ...[...byBank.entries()].map(([bank, names]) => `• *${bank}*: ${names.join(", ")}`), people.length > max ? `  +${people.length - max} more: ${o.app}/think` : ""].filter(Boolean).join("\n");
    }
    if (b.type === "links") return `Process tracker: ${o.app}/process\nTo-do: ${o.app}/todo`;
    return "";
  };
  const out: string[] = [];
  for (const m of layout.messages) {
    const parts = m.blocks.map(block).filter(Boolean);
    if (parts.length) out.push(...split(parts.join("\n\n"), maxLen));
  }
  return out;
}

/** A message over `maxLen` is cut at line breaks into several (the first line stays the header of the first). */
function split(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > maxLen) {
      out.push(cur.trimEnd());
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}
