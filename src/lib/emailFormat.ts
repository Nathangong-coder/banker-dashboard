/**
 * Email body formatting. Drafts go to Gmail as multipart/alternative: a tidy text/plain part plus an
 * HTML part built the way Gmail's own composer does it (one <div> per line, <div><br></div> for a blank
 * line). Plain text alone gets hard-wrapped by Gmail at ~78 chars (the "missing an inch on the right"
 * look), and <p> tags add paragraph margins, so neither is used for display.
 */

const SIGNOFF = /^(best|best regards|sincerely|regards|kind regards|warm regards|warmly|thanks|thank you|many thanks|cheers|all the best|best wishes|respectfully|yours truly)[,!.]?$/i;

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

/** `*text*`: italic (the major line of the signature). Asterisks must hug the text, so "5 * 3" is left alone. */
const ITALIC = /(^|[\s(>])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?=$|[\s).,;:!?|<])/gm;

/**
 * Phone numbers stay plain text: mail apps (Gmail, Apple Mail) auto-link anything phone-shaped, so a
 * zero-width non-joiner goes between digit groups. It's invisible and defeats the data detectors.
 */
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const unlinkPhones = (html: string) => html.replace(PHONE, (m) => m.replace(/(\d)(?=[\s.)-])/g, "$1&zwnj;"));

/** Plain text → Gmail-native HTML. Named links, bare URLs and emails become (blue) links; phones don't. */
export function bodyToHtml(text: string, fontCss?: string): string {
  const linkify = (line: string) => {
    const named: string[] = [];
    // Protect [label](url) first so the bare-URL pass doesn't touch it.
    const held = line.replace(MD_LINK, (_m, label: string, url: string) => {
      named.push(`<a href="${esc(url)}">${esc(label)}</a>`);
      return `\u0000${named.length - 1}\u0000`;
    });
    return unlinkPhones(esc(held))
      .replace(/\bhttps?:\/\/[^\s<\u0000]+[^\s<.,;:!?)\u0000]/g, (u) => `<a href="${u}">${u}</a>`)
      .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, (e) => `<a href="mailto:${e}">${e}</a>`)
      .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => named[Number(i)])
      .replace(ITALIC, (_m, pre: string, t: string) => `${pre}<i>${t}</i>`);
  };
  const style = fontCss ? ` style="font-family:${fontCss.replace(/"/g, "&quot;")}"` : "";
  return `<div dir="ltr"${style}>${normalizeBody(unwrapRedirects(text))
    .split("\n")
    .map((l) => (l ? `<div>${linkify(l)}</div>` : "<div><br></div>"))
    .join("")}</div>`;
}

/** Plain-text part: "[LinkedIn](url)" → "LinkedIn: url", "*italic*" → "italic". */
export function bodyToPlain(text: string): string {
  return normalizeBody(unwrapRedirects(text))
    .replace(MD_LINK, (_m, label: string, url: string) => `${label}: ${url}`)
    .replace(ITALIC, (_m, pre: string, t: string) => pre + t);
}

/**
 * Gmail's web UI rewrites links in drafts it opens into `https://www.google.com/url?q=<target>&…` redirects (with a
 * `data-saferedirecturl` attribute). Anything copied back out of Gmail goes through this so a signature or body never
 * links through Google: the redirect becomes its target and the attribute is dropped.
 */
export function unwrapRedirects(text: string): string {
  return text
    .replace(/\s*data-saferedirecturl="[^"]*"/g, "")
    .replace(/https?:\/\/(?:www\.)?google\.[a-z.]+\/url\?(?:[^\s"')\]<>]*?&(?:amp;)?)?q=([^&\s"')\]<>]+)[^\s"')\]<>]*/g, (m, q: string) => {
      try {
        const target = decodeURIComponent(q);
        return /^https?:\/\//.test(target) ? target : m;
      } catch {
        return m;
      }
    });
}

type SignatureProfile = { name?: string; email?: string; linkedin?: string; signature?: string; school?: string; year?: string; major?: string; phone?: string };

const firstNameOf = (name?: string) => name?.trim().split(/\s+/)[0] ?? "";
const plainLine = (l: string) => l.replace(MD_LINK, "$1").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Lines under the full name in the signature block:
 *   UCLA Class of 2029
 *   *Economics & Applied Mathematics*        (italic)
 *   425-… | LinkedIn | you@school.edu        (LinkedIn links straight to the profile URL, never a redirect)
 * Lines without a value are left out. A custom signature from Settings replaces it.
 */
export function signatureLine(p: SignatureProfile): string {
  const raw = unwrapRedirects(p.linkedin?.trim() ?? "");
  const url = raw ? (/^https?:\/\//.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`) : "";
  if (p.signature?.trim()) {
    // In a custom signature, a plain "LinkedIn" becomes a link to the profile URL (unless already a [LinkedIn](…) link).
    const sig = unwrapRedirects(p.signature.trim());
    return url ? sig.replace(/(?<!\[)\bLinkedIn\b(?!\]\()/g, `[LinkedIn](${url})`) : sig;
  }
  const year = p.year?.trim();
  const classOf = p.school?.trim() && year ? `${p.school.trim()} ${/class/i.test(year) ? year : `Class of ${year}`}` : "";
  const major = p.major?.trim() ? `*${p.major.trim()}*` : "";
  const contact = [p.phone?.trim(), url && `[LinkedIn](${url})`, p.email?.trim()].filter(Boolean).join(" | ");
  return [classOf, major, contact].filter(Boolean).join("\n");
}

/** The whole signature block: the full name, then `signatureLine`. A custom signature that already starts with the name keeps it once. */
export function signatureBlock(p: SignatureProfile): string {
  const sig = signatureLine(p);
  const name = p.name?.trim() ?? "";
  if (!name) return sig;
  const first = sig.split("\n")[0] ?? "";
  if (plainLine(first) === name.toLowerCase()) return sig;
  // "Nathan Gong | 425-…" on one line: split the name onto its own line.
  const parts = first.split(/\s*\|\s*/);
  if (parts.length > 1 && plainLine(parts[0]) === name.toLowerCase()) return [name, parts.slice(1).join(" | "), ...sig.split("\n").slice(1)].join("\n");
  return sig ? `${name}\n${sig}` : name;
}

/** The last sign-off line ("Sincerely,", "Regards," …), or -1. */
function signOffIndex(lines: string[]) {
  for (let i = lines.length - 1; i >= 0; i--) if (SIGNOFF.test(lines[i].trim())) return i;
  return -1;
}

/**
 * Close every email the same way:
 *   Sincerely,
 *   Nathan
 *                       ← one blank line
 *   Nathan Gong
 *   UCLA Class of 2029
 *   *Economics & Applied Mathematics*
 *   425-… | LinkedIn | you@school.edu
 * Whatever follows the sign-off is replaced only when it's the sign-off name or (an older version of) the signature, so
 * an older draft ("Sincerely,\nNathan Gong\nUCLA Class of 2029…") is rebuilt; anything else (a P.S.) is left alone.
 */
export function withSignature(body: string, p: SignatureProfile): string {
  const block = signatureBlock(p);
  const b = unwrapRedirects(body.trimEnd());
  const lines = b.split("\n");
  const i = signOffIndex(lines);
  if (i < 0) return block ? `${b}\n\n${block}` : b;
  const tail = lines.slice(i + 1).filter((l) => l.trim());
  const first = firstNameOf(p.name);
  const name = p.name?.trim().toLowerCase() ?? "";
  const known = new Set(block.split("\n").map(plainLine).filter(Boolean));
  const sigLike = (l: string) =>
    known.has(plainLine(l)) ||
    plainLine(l) === name ||
    plainLine(l) === first.toLowerCase() ||
    /\bclass of\b|linkedin|@|\d{3}\D{0,2}\d{3}\D?\d{4}/i.test(l) ||
    (!!p.major?.trim() && plainLine(l) === plainLine(p.major));
  if (!tail.every(sigLike)) return b;
  // No name in Settings: keep the name the template put under the sign-off.
  const signer = first || (tail[0] ? tail[0].trim().split(/\s+/)[0] : "");
  return [...lines.slice(0, i + 1), ...(signer ? [signer] : []), ...(block ? ["", block] : [])].join("\n");
}

/**
 * What's wrong with a draft's or template's sign-off, as messages to show (empty = fine). The sign-off must be followed
 * by the first-name line, then (when a signature follows) exactly one blank line. Templates may stop after the first
 * name ({{my_first_name}}); the signature block is added when the draft is written.
 */
export function signOffIssues(body: string, p: Pick<SignatureProfile, "name"> = {}): string[] {
  const lines = normalizeBody(body).split("\n");
  const issues: string[] = [];
  if (/google\.[a-z.]+\/url\?/.test(body)) issues.push("A link goes through a google.com/url redirect instead of straight to the page.");
  const i = signOffIndex(lines);
  if (i < 0) return [...issues, "No sign-off (Sincerely, / Regards, / Kind regards,)."];
  const first = firstNameOf(p.name);
  const nameLine = lines[i + 1]?.trim() ?? "";
  const isFirstName = /^\{\{\s*my_first_name\s*\}\}$/.test(nameLine) || (first ? nameLine.toLowerCase() === first.toLowerCase() : /^\S+$/.test(nameLine) && !/\{\{/.test(nameLine));
  if (!nameLine) issues.push(`Missing the first-name line right after "${lines[i].trim()}".`);
  else if (!isFirstName) issues.push(`The line after "${lines[i].trim()}" should be just your first name${first ? ` (${first})` : ""}, not "${nameLine}".`);
  else if (lines[i + 2] !== undefined && lines[i + 2].trim() !== "") issues.push("Missing the blank line between your first name and the signature block.");
  return issues;
}

/** The sign-off each kind of email uses: first emails "Sincerely,", follow-up #1 "Regards,", #2 "Kind regards,". */
export const SIGN_OFFS = { initial: "Sincerely,", 1: "Regards,", 2: "Kind regards," } as const;
export const signOffFor = (step?: number) => (step === 1 ? SIGN_OFFS[1] : step && step >= 2 ? SIGN_OFFS[2] : SIGN_OFFS.initial);

/**
 * A template or base close that ends "<sign-off>,\n{{my_name}}" (or a literal name) → "<sign-off>,\n{{my_first_name}}",
 * with the sign-off word for its kind when given. The signature block (full name first) is added when the draft is written.
 */
export function templateSignOff(text: string, signOff?: string): string {
  const lines = text.trimEnd().split("\n");
  const i = signOffIndex(lines);
  if (i < 0) return text;
  const tail = lines.slice(i + 1).filter((l) => l.trim());
  if (tail.length > 1 || (tail[0] && !/^\{\{\s*my_(first_)?name\s*\}\}$|^[A-Z][\w'-]*( [A-Z][\w'-]*)?$/.test(tail[0].trim()))) return text;
  return [...lines.slice(0, i), signOff ?? lines[i].trim(), "{{my_first_name}}"].join("\n");
}
