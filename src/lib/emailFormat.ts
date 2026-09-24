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
    // Only when the next line looks like a name, so "Thanks!\n\nSincerely," keeps its paragraph break.
    const looksLikeName = !SIGNOFF.test(line) && line.split(" ").length <= 4 && !/[.!?:]$/.test(line);
    if (line && prev === "" && out.length >= 2 && SIGNOFF.test(out[out.length - 2]) && looksLikeName) out.pop();
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join("\n");
}

export function normalizeSubject(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `[label](https://…)`: a named link. Used by the auto signature ("[LinkedIn](url)"); editable in drafts. */
const MD_LINK = /\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/g;

/** Plain text → Gmail-native HTML. Named links, bare URLs and emails become (blue) links. */
export function bodyToHtml(text: string): string {
  const linkify = (line: string) => {
    const named: string[] = [];
    // Protect [label](url) first so the bare-URL pass doesn't touch it.
    const held = line.replace(MD_LINK, (_m, label: string, url: string) => {
      named.push(`<a href="${esc(url)}">${esc(label)}</a>`);
      return `\u0000${named.length - 1}\u0000`;
    });
    return esc(held)
      .replace(/\bhttps?:\/\/[^\s<\u0000]+[^\s<.,;:!?)\u0000]/g, (u) => `<a href="${u}">${u}</a>`)
      .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, (e) => `<a href="mailto:${e}">${e}</a>`)
      .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => named[Number(i)]);
  };
  return `<div dir="ltr">${normalizeBody(text)
    .split("\n")
    .map((l) => (l ? `<div>${linkify(l)}</div>` : "<div><br></div>"))
    .join("")}</div>`;
}

/** Plain-text part: "[LinkedIn](url)" → "LinkedIn: url". */
export function bodyToPlain(text: string): string {
  return normalizeBody(text).replace(MD_LINK, (_m, label: string, url: string) => `${label}: ${url}`);
}

/**
 * Line added under the sign-off name: "you@school.edu | LinkedIn" with LinkedIn hyperlinked.
 * A custom signature from Settings replaces it.
 */
export function signatureLine(p: { email?: string; linkedin?: string; signature?: string }): string {
  if (p.signature?.trim()) return p.signature.trim();
  const url = p.linkedin?.trim() ? (/^https?:\/\//.test(p.linkedin.trim()) ? p.linkedin.trim() : `https://${p.linkedin.trim().replace(/^\/+/, "")}`) : "";
  return [p.email?.trim(), url && `[LinkedIn](${url})`].filter(Boolean).join(" | ");
}

/** Append the signature line unless the body already has it (or already mentions the LinkedIn/email). */
export function withSignature(body: string, p: { email?: string; linkedin?: string; signature?: string }): string {
  const sig = signatureLine(p);
  if (!sig) return body;
  const b = body.trimEnd();
  if (b.includes(sig) || (p.linkedin && b.includes(p.linkedin.trim())) || (p.email && b.includes(p.email.trim()))) return b;
  return `${b}\n${sig}`;
}
