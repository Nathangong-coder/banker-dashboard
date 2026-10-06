/**
 * The WhatsApp digest text, shared by the browser (reminders.ts) and the server (api/server/tick), so both send the
 * same thing: sections by action ("*Move on?* (3)", "*Follow-up #2* (5)"), one "• Name: email" line per person, split
 * into messages under `maxLen` characters (CallMeBot sends one text per call).
 */

export interface DigestItem {
  contactId: string;
  name: string;
  email?: string;
  /** "Follow-up #1", "Move on?" */
  label: string;
}

/** Section order: last chances first. */
const sectionRank = (label: string) => (/move on/i.test(label) ? 0 : Number(label.match(/#(\d+)/)?.[1] ?? 9));

export function digestMessages(items: DigestItem[], queuedToday = 0, maxLen = 900): string[] {
  const sections = new Map<string, string[]>();
  for (const it of items) sections.set(it.label, [...(sections.get(it.label) ?? []), it.email ? `• ${it.name}: ${it.email}` : `• ${it.name}`]);
  const blocks = [...sections.entries()].sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]));
  if (queuedToday) blocks.push([`Going out today (scheduled): ${queuedToday}`, []]);

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

export const digestTitle = (i: number, n: number) => (n > 1 ? `Follow-ups due (${i + 1}/${n})` : "Follow-ups due");
