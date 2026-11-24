import type { Contact } from "./types";

/**
 * Links into Gmail's web app (owner, 2026-11-23: Follow-ups "can't check cold email threads directly, and there's no
 * links"). Opening these never changes anything in Gmail. u/0 = the first signed-in account, like every other Gmail link
 * the app makes.
 */
const GMAIL = "https://mail.google.com/mail/u/0/";
/** Gmail's search box takes about 2,000 characters; stay under it with room for after:/before:. */
const MAX_QUERY = 1800;

export const gmailSearchUrl = (q: string) => `${GMAIL}#search/${encodeURIComponent(q)}`;
export const gmailThreadUrl = (threadId: string) => `${GMAIL}#all/${threadId}`;
export const gmailDraftUrl = (messageId: string) => `${GMAIL}#drafts?compose=${messageId}`;

/** Every email with this person, either way, at any address on file, plus their name (other addresses, forwards). */
export function personQuery(c: Pick<Contact, "email" | "aliases" | "name">): string {
  const addrs = [...new Set([c.email, ...(c.aliases ?? [])].map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e))];
  const parts = addrs.flatMap((a) => [`from:${a}`, `to:${a}`]);
  if (c.name.trim()) parts.push(`"${c.name.trim().replace(/"/g, "")}"`);
  return `(${parts.join(" OR ")})`;
}

/**
 * Gmail links to one local day's emails with these people: `to:` for people you wrote, `from:` for people who wrote you.
 * The day is your own midnight to midnight, as epoch seconds (Gmail reads `after:2026/11/10` in its own zone). A long
 * list becomes several links so no query is cut off.
 */
export function dayLinks(day: Date, people: { to?: string[]; from?: string[] }): string[] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const range = ` after:${start.getTime() / 1000} before:${end.getTime() / 1000}`;
  const terms = [...new Set([...(people.to ?? []).map((a) => `to:${a.toLowerCase()}`), ...(people.from ?? []).map((a) => `from:${a.toLowerCase()}`)])];
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(gmailSearchUrl(`(${cur.join(" OR ")})${range}`));
    cur = [];
  };
  for (const t of terms) {
    if (cur.length && `(${[...cur, t].join(" OR ")})${range}`.length > MAX_QUERY) flush();
    cur.push(t);
  }
  flush();
  return out;
}
