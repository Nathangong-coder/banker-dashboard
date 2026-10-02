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
      .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => named[Number(i)]);
  };
  const style = fontCss ? ` style="font-family:${fontCss.replace(/"/g, "&quot;")}"` : "";
  return `<div dir="ltr"${style}>${normalizeBody(unwrapRedirects(text))
    .split("\n")
    .map((l) => (l ? `<div>${linkify(l)}</div>` : "<div><br></div>"))
    .join("")}</div>`;
}

/** Plain-text part: "[LinkedIn](url)" → "LinkedIn: url". */
export function bodyToPlain(text: string): string {
  return normalizeBody(unwrapRedirects(text)).replace(MD_LINK, (_m, label: string, url: string) => `${label}: ${url}`);
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

type SignatureProfile = { email?: string; linkedin?: string; signature?: string; school?: string; year?: string; major?: string; phone?: string };

/**
 * Lines added under the sign-off name:
 *   UCLA Class of 2029
 *   Economics & Applied Mathematics
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
  const contact = [p.phone?.trim(), url && `[LinkedIn](${url})`, p.email?.trim()].filter(Boolean).join(" | ");
  return [classOf, p.major?.trim(), contact].filter(Boolean).join("\n");
}

/** Append the signature unless the body already has it (or already mentions the LinkedIn/email). */
export function withSignature(body: string, p: SignatureProfile): string {
  let sig = signatureLine(p);
  if (!sig) return body;
  const b = body.trimEnd();
  if (b.includes(sig) || (p.linkedin && b.includes(p.linkedin.trim())) || (p.email && b.includes(p.email.trim()))) return b;
  // Templates already end with the name; don't repeat it if the custom signature starts with it too.
  const lastLine = b.split("\n").pop()?.trim().toLowerCase() ?? "";
  if (lastLine) {
    const lines = sig.split("\n");
    const first = lines[0].split(/\s*\|\s*/);
    if (first[0].trim().toLowerCase() === lastLine) {
      first.shift();
      lines[0] = first.join(" | ");
      sig = lines.filter((l, i) => l.trim() || i > 0).join("\n").trim();
    }
  }
  return sig ? `${b}\n${sig}` : b;
}
