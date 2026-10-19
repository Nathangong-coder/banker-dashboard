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
  thankOwed: "Thank-you not sent yet",
  replyOwed: "They wrote back: reply",
  checkIn: "Check in (7+ days since your last email)",
  moveOn: "Move on?",
} as const;

/** Section order: tonight's thank-yous, then people who replied, then cold outreach (last chances first). */
const ORDER: string[] = [LABELS.thankToday, LABELS.thankOwed, LABELS.replyOwed, LABELS.checkIn, LABELS.moveOn];
const sectionRank = (label: string) => {
  const i = ORDER.indexOf(label);
  return i >= 0 ? i : ORDER.length + Number(label.match(/#(\d+)/)?.[1] ?? 9);
};

/** The closing reminder after a day with calls: names + notes from the notes doc into the tracker. */
export const TRACKER_NOTE = "📝 Update the tracker: add today's people + conversation notes from your notes doc to the Excel.";

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
