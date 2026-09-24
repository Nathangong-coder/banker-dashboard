export interface IcsEvent {
  uid: string;
  start: Date;
  title: string;
  description: string;
  url?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

/** All-day events with a 9am alarm, so phone calendars push a notification. */
export function buildIcs(events: IcsEvent[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Banker Dashboard//Follow-ups//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    const end = new Date(e.start.getTime() + 86_400_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@banker-dashboard`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART;VALUE=DATE:${day(e.start)}`,
      `DTEND;VALUE=DATE:${day(end)}`,
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.description)}`,
      ...(e.url ? [`URL:${e.url}`] : []),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(e.title)}`,
      "TRIGGER;RELATED=START:PT9H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
