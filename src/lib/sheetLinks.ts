/**
 * Links that jump inside the workbook (OVERVIEW → "MS", a bank tab's title → OVERVIEW).
 *
 * Excel stores them as `<hyperlink ref="B3" location="MS!A1"/>` with no relationship. ExcelJS 4.4 drops these on
 * read and can't write them (it turns every link into an external relationship), so they're read and written here
 * straight from the sheet XML. In snapshots and patches they're kept Excel-style as `#MS!A1` / `#'EVR (NY)'!A1`.
 */
import JSZip from "jszip";

/** sheet name → "r:c" → "#Sheet!A1" */
export type InternalLinks = Record<string, Record<string, string>>;

export const isInternalLink = (link?: string) => !!link && link.startsWith("#");

function colNumber(letters: string) {
  return letters.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

/** "#'EVR (NY)'!B3" → { sheet: "EVR (NY)", r: 3, c: 2 }. No sheet part ("#A1") means the same tab. Ranges go to their first cell. */
export function parseSheetLink(link: string): { sheet?: string; r: number; c: number } | undefined {
  if (!isInternalLink(link)) return undefined;
  const m = link.slice(1).match(/^(?:'((?:[^']|'')+)'|([^!]+))?!?\$?([A-Za-z]{1,3})\$?(\d+)(?::.*)?$/);
  if (m) return { sheet: m[1]?.replace(/''/g, "'") ?? m[2], r: Number(m[4]), c: colNumber(m[3]) };
  // Just a tab name (or a defined name we can't resolve): open the tab at the top.
  const name = link.slice(1).replace(/^'(.*)'$/, "$1").replace(/!.*$/, "");
  return name ? { sheet: name, r: 1, c: 1 } : undefined;
}

const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (_, e: string, d?: string, h?: string) =>
    d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()],
  );
const encode = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function attrs(tag: string) {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

/** Tab name → path of its sheet XML inside the zip. */
async function sheetPaths(zip: JSZip) {
  const out = new Map<string, string>();
  const wb = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wb || !rels) return out;
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) targets.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const path = targets.get(a["r:id"]);
    if (a.name && path) out.set(a.name, path);
  }
  return out;
}

function parseAddr(a: string) {
  const m = a.match(/^\$?([A-Z]{1,3})\$?(\d+)/i);
  return m ? `${Number(m[2])}:${colNumber(m[1])}` : undefined;
}

function addrName(key: string) {
  const [r, c] = key.split(":").map(Number);
  let s = "";
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return `${s}${r}`;
}

/** Every in-workbook link, by tab. External links (LinkedIn, mailto) are left to ExcelJS. */
export async function readInternalLinks(buffer: ArrayBuffer): Promise<InternalLinks> {
  const zip = await JSZip.loadAsync(buffer);
  const out: InternalLinks = {};
  for (const [name, path] of await sheetPaths(zip)) {
    const xml = await zip.file(path)?.async("string");
    const block = xml?.match(/<hyperlinks>([\s\S]*?)<\/hyperlinks>/)?.[1];
    if (!block) continue;
    for (const m of block.matchAll(/<hyperlink\b[^>]*>/g)) {
      const a = attrs(m[0]);
      const key = a.ref && parseAddr(a.ref);
      if (!key || !a.location || a["r:id"]) continue;
      (out[name] ??= {})[key] = `#${a.location}`;
    }
  }
  return out;
}

// Elements that come after <hyperlinks> in a worksheet (OOXML order); a new <hyperlinks> goes before the first one present.
const AFTER_HYPERLINKS = ["printOptions", "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst"];

/** Add in-workbook links to a saved file (cells that already carry an external link keep it). */
export async function writeInternalLinks(buffer: ArrayBuffer, links: InternalLinks, display: (sheet: string, key: string) => string): Promise<ArrayBuffer> {
  if (!Object.values(links).some((l) => Object.keys(l).length)) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  for (const [name, path] of await sheetPaths(zip)) {
    const cells = links[name];
    if (!cells || !Object.keys(cells).length) continue;
    let xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const taken = new Set([...(xml.match(/<hyperlinks>[\s\S]*?<\/hyperlinks>/)?.[0] ?? "").matchAll(/<hyperlink\b[^>]*>/g)].map((m) => attrs(m[0]).ref));
    const tags = Object.entries(cells)
      .filter(([key]) => !taken.has(addrName(key)))
      .map(([key, link]) => {
        const shown = display(name, key);
        return `<hyperlink ref="${addrName(key)}" location="${encode(link.slice(1))}"${shown ? ` display="${encode(shown)}"` : ""}/>`;
      })
      .join("");
    if (!tags) continue;
    if (xml.includes("</hyperlinks>")) xml = xml.replace("</hyperlinks>", `${tags}</hyperlinks>`);
    else {
      const next = AFTER_HYPERLINKS.map((t) => xml!.search(new RegExp(`<${t}[\\s/>]`))).filter((i) => i >= 0);
      const at = next.length ? Math.min(...next) : xml.lastIndexOf("</worksheet>");
      xml = `${xml.slice(0, at)}<hyperlinks>${tags}</hyperlinks>${xml.slice(at)}`;
    }
    zip.file(path, xml);
  }
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

/* ---------------- restoring links lost by an older save ---------------- */

type Snap = { name: string; rows: number; cols: number; cells: Record<string, { v: string; link?: string }> };

/** "#MS!A1", or "#'EVR (NY)'!A1" when the tab name needs quoting (Excel's rule: anything but letters, digits, _ and .). */
export const tabLink = (tab: string, cell = "A1") => `#${/^[A-Za-z_][\w.]*$/.test(tab) ? tab : `'${tab.replace(/'/g, "''")}'`}!${cell}`;

/**
 * Links an older save stripped, rebuilt the way the owner's workbook had them: each bank name on the overview tab
 * ("Institution Name" column) → that bank's tab, and each bank tab's "X Application Tracker" title (A1) → the overview.
 * Cells that already have a link are left alone. Returned as cell patches to review and save.
 */
export function tabLinkPatches(snaps: Snap[], canon: (name: string) => string): { patches: Record<string, Record<string, { v: string; link: string }>>; count: number } {
  const patches: Record<string, Record<string, { v: string; link: string }>> = {};
  let count = 0;
  const put = (sheet: string, key: string, v: string, link: string) => {
    (patches[sheet] ??= {})[key] = { v, link };
    count++;
  };
  const overview = snaps.find((s) => /^overview$/i.test(s.name.trim())) ?? snaps.find((s) => Object.values(s.cells).some((c) => /^institution name$/i.test(c.v.trim())));
  const bankTabs = snaps
    .map((s) => ({ s, title: s.cells["1:1"]?.v ?? "" }))
    .filter((x) => /application tracker/i.test(x.title))
    .map((x) => ({ ...x, bank: canon(x.title.replace(/\s*application tracker.*$/i, "").replace(/\(NY\)/i, "")) }));
  if (!overview) return { patches, count };

  for (const { s, title } of bankTabs) if (!s.cells["1:1"]?.link) put(s.name, "1:1", title, tabLink(overview.name));

  const header = Object.entries(overview.cells).find(([, c]) => /^institution name$/i.test(c.v.trim()));
  if (!header) return { patches, count };
  const [hr, hc] = header[0].split(":").map(Number);
  for (let r = hr + 1; r <= overview.rows; r++) {
    const cell = overview.cells[`${r}:${hc}`];
    if (!cell?.v.trim() || cell.link) continue;
    const want = canon(cell.v);
    // The main tab, not a legacy "(NY)" one.
    const tab = bankTabs.filter((t) => t.bank === want).sort((a, b) => Number(/\(NY\)/i.test(a.s.name)) - Number(/\(NY\)/i.test(b.s.name)))[0];
    if (tab) put(overview.name, `${r}:${hc}`, cell.v, tabLink(tab.s.name));
  }
  return { patches, count };
}
