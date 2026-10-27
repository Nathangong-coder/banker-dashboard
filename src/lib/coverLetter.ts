/**
 * Cover letters from YOUR template (owner, 2026-10-26: "always fill them out using the template I wrote; just change
 * the date to today and the company name"). Pure: no store, no network, so `npm run check:apply` covers it.
 *
 * The template is your latest Writing sample marked "Cover letter" (Applications → Writing). Only two things change:
 *   - the first date in it (written "October 5, 2026", "Oct 5, 2026", "10/5/2026" or "5 October 2026") becomes today,
 *     written the same way;
 *   - the firm it was written for becomes the firm you're applying to: {{company}} / [Company] placeholders, else
 *     every mention of the firm named in it (found by matching the firms Coverage knows: your lists, contacts, starter
 *     banks), whole words only.
 * Nothing else is rewritten (no AI): the letter stays word for word yours.
 */
import { canonBank } from "./banks";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace the first date in the text with `today`, in the same style. */
export function withToday(text: string, today: Date): string {
  const m = today.getMonth();
  const d = today.getDate();
  const y = today.getFullYear();
  const long = new RegExp(`\\b(${MONTHS.join("|")})\\s+\\d{1,2}(st|nd|rd|th)?,?\\s+20\\d{2}\\b`);
  const short = new RegExp(`\\b(${MONTHS.map((x) => x.slice(0, 3)).join("|")})\\.?\\s+\\d{1,2},?\\s+20\\d{2}\\b`);
  const dayFirst = new RegExp(`\\b\\d{1,2}\\s+(${MONTHS.join("|")})\\s+20\\d{2}\\b`);
  const numeric = /\b\d{1,2}\/\d{1,2}\/(20)?\d{2}\b/;
  const found = [
    { re: long, out: `${MONTHS[m]} ${d}, ${y}` },
    { re: short, out: `${MONTHS[m].slice(0, 3)} ${d}, ${y}` },
    { re: dayFirst, out: `${d} ${MONTHS[m]} ${y}` },
    { re: numeric, out: `${m + 1}/${d}/${y}` },
  ]
    .map((f) => ({ ...f, at: text.search(f.re) }))
    .filter((f) => f.at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  return found ? text.replace(found.re, found.out) : text;
}

/** The firm a template was written for: the known firm it names most often. */
export function templateFirm(text: string, knownFirms: string[]): string | undefined {
  let best: { name: string; n: number } | undefined;
  const seen = new Set<string>();
  for (const name of knownFirms.sort((a, b) => b.length - a.length)) {
    const key = canonBank(name);
    if (!key || seen.has(key) || name.length < 3) continue;
    const n = (text.match(new RegExp(`\\b${esc(name)}\\b`, "g")) ?? []).length;
    if (n) {
      seen.add(key);
      if (!best || n > best.n) best = { name, n };
    }
  }
  return best?.name;
}

/** Your template with today's date and this firm. */
export function coverLetterFrom(template: string, company: string, today: Date, knownFirms: string[]): string {
  let text = withToday(template.replace(/\r/g, ""), today);
  if (/\{\{\s*company\s*\}\}|\[company( name)?\]/i.test(text)) return text.replace(/\{\{\s*company\s*\}\}|\[company( name)?\]/gi, company);
  const old = templateFirm(text, knownFirms);
  if (old && canonBank(old) !== canonBank(company)) {
    // Every way the old firm is written in the letter (e.g. "Evercore" and "Evercore ISI" both canon to the same bank).
    const names = knownFirms.filter((n) => canonBank(n) === canonBank(old) && n.length >= 3).sort((a, b) => b.length - a.length);
    for (const n of [...new Set([old, ...names])]) text = text.replace(new RegExp(`\\b${esc(n)}\\b`, "g"), company);
  }
  return text;
}

/**
 * A plain one-column PDF of the letter (Helvetica 11 pt, Letter size, wrapped at ~92 characters, new pages as
 * needed). Hand-written so the extension can upload it without a PDF library. Latin-1 text only (others → "?").
 */
export function letterPdf(text: string): Uint8Array {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const word of para.split(/\s+/)) {
      if ((cur + " " + word).trim().length > 92) {
        lines.push(cur);
        cur = word;
      } else cur = (cur ? cur + " " : "") + word;
    }
    lines.push(cur);
  }
  const perPage = 52;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([""]);
  const pdfStr = (s: string) =>
    s
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-")
      .replace(/…/g, "...")
      .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
      .replace(/([\\()])/g, "\\$1");
  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(""); // pages, filled below
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const page of pages) {
    const stream = `BT /F1 11 Tf 14 TL 72 720 Td ${page.map((l) => `(${pdfStr(l)}) Tj T*`).join(" ")} ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contentId = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(objs.length);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
