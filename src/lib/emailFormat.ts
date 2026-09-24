/**
 * Email body formatting. Drafts go to Gmail as multipart/alternative: a tidy text/plain part plus an
 * HTML part built the way Gmail's own composer does it (one <div> per line, <div><br></div> for a blank
 * line). Plain text alone gets hard-wrapped by Gmail at ~78 chars (the "missing an inch on the right"
 * look), and <p> tags add paragraph margins, so neither is used for display.
 */

const SIGNOFF = /^(best|best regards|sincerely|regards|kind regards|warm regards|warmly|thanks|thank you|many thanks|cheers|all the best|respectfully|yours truly)[,!.]?$/i;

/** Normalize whitespace: one blank line between paragraphs, no indents, sign-off glued to the name. */
export function normalizeBody(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "").replace(/ {2,}/g, " "));

  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (!line && (prev === undefined || prev === "")) continue; // no leading or doubled blank lines
    // "Sincerely,\n\nNathan" → "Sincerely,\nNathan"
    if (line && prev === "" && out.length >= 2 && SIGNOFF.test(out[out.length - 2])) out.pop();
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join("\n");
}

export function normalizeSubject(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → Gmail-native HTML. URLs and emails become links. */
export function bodyToHtml(text: string): string {
  const linkify = (s: string) =>
    esc(s)
      .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}">${u}</a>`)
      .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, (e) => `<a href="mailto:${e}">${e}</a>`);
  return `<div dir="ltr">${normalizeBody(text)
    .split("\n")
    .map((l) => (l ? `<div>${linkify(l)}</div>` : "<div><br></div>"))
    .join("")}</div>`;
}
