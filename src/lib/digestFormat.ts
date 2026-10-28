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
  referral: "Referral to-do",
  moveOn: "Move on?",
  fillOffices: "Offices to fill (find people / start emailing)",
} as const;

/** Section order: tonight's thank-yous, then people who replied, then cold outreach (last chances first). */
const ORDER: string[] = [LABELS.thankToday, LABELS.infoSession, LABELS.thankOwed, LABELS.replyOwed, LABELS.referral, LABELS.checkIn, LABELS.moveOn, LABELS.fillOffices];
const sectionRank = (label: string) => {
  const i = ORDER.indexOf(label);
  return i >= 0 ? i : ORDER.length + Number(label.match(/#(\d+)/)?.[1] ?? 9);
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

export const TEXT_DAYS = [1, 2, 3, 4];
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
