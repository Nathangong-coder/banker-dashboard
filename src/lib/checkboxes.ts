/**
 * The "Referral?" column: an Excel cell checkbox (Insert → Checkbox, Microsoft 365) per contact row.
 *
 * Excel stores a checkbox as a boolean cell (`t="b"`, TRUE = ticked) whose cell format carries an extension pointing at
 * xl/featurePropertyBag/featurePropertyBag.xml. ExcelJS drops both on read and write, so after every save the cells are
 * re-marked here, straight in the XML (same idea as sheetLinks.ts). The XML below is what Excel 365 itself writes
 * (checked 2026-10-20 by making a checkbox through COM and unzipping the file). Older Excel shows TRUE / FALSE.
 */
import { addrName, attrs, sheetPaths } from "./sheetLinks";

const loadZip = async () => (await import("jszip")).default;

export const REFERRAL_HEADERS = ["referral?", "referral", "referred?", "referred", "referred me?", "referred me", "referral (y/n)"];
export const REFERRAL_TITLE = "Referral?";

/** A checkbox cell's value: true / false, or undefined for text that isn't a yes/no (left alone, never overwritten). */
export function parseCheck(v: string | undefined): boolean | undefined {
  const t = (v ?? "").trim().toLowerCase();
  if (/^(true|yes|y|x|1|✓|✔|☑|✅)$/.test(t)) return true;
  if (/^(false|no|n|0|☐|-)?$/.test(t)) return false;
  return undefined;
}

/**
 * `contact.referral` after the sheet's box was read again: ticked since last time → referred (keeping the dashboard's
 * date and note), unticked since last time → not. A column that's new (`before` undefined) only ever adds a referral,
 * so a blank column someone just made doesn't wipe the ones logged on /prep.
 */
export function mergeReferral<T extends { at: string }>(before: boolean | undefined, now: boolean | undefined, current: T | undefined, at?: string): T | { at: string } | undefined {
  if (now === true && !before) return current ?? { at: at ?? new Date().toISOString() };
  if (now === false && before === true) return undefined;
  return current;
}

type Touches = { chats?: { at: string }[]; call?: { at: string }; lastHeardAt?: string; repliedAt?: string; lastEmailedAt?: string; lastTouchAt?: string; sentAt?: string };

/**
 * When a referral ticked in the sheet happened, as best we know: the latest chat, call or reply with them (a box has
 * no date). Stamping it "now" made Firms show the firm as active today on every import.
 */
export function referralDate(c: Touches, now = Date.now()): string {
  const past = [...(c.chats ?? []).map((x) => x.at), c.call?.at, c.lastHeardAt, c.repliedAt, c.lastEmailedAt, c.lastTouchAt, c.sentAt].filter(
    (d): d is string => !!d && Date.parse(d) <= now,
  );
  return past.sort().at(-1) ?? new Date(now).toISOString();
}

/** Cells to show as checkboxes, per tab: "r:c" keys. */
export type CheckboxCells = Record<string, string[]>;

const BAG_PATH = "xl/featurePropertyBag/featurePropertyBag.xml";
const BAG_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<FeaturePropertyBags xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag"><bag type="Checkbox"/><bag type="XFControls"><bagId k="CellControl">0</bagId></bag><bag type="XFComplement"><bagId k="XFControls">1</bagId></bag><bag type="XFComplements" extRef="XFComplementsMapperExtRef"><a k="MappedFeaturePropertyBags"><bagId>2</bagId></a></bag></FeaturePropertyBags>';
const BAG_REL = "http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag";
const BAG_TYPE = "application/vnd.ms-excel.featurepropertybag+xml";
const EXT_URI = "{C7286773-470A-42A8-94C5-96B5CB345126}";
const EXT = `<ext uri="${EXT_URI}" xmlns:xfpb="http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag"><xfpb:xfComplement i="0"/></ext>`;

/** The same cell format plus the checkbox control. */
function withCheckbox(xf: string) {
  if (xf.includes(EXT_URI)) return xf;
  if (xf.endsWith("/>")) return `${xf.slice(0, -2)}><extLst>${EXT}</extLst></xf>`;
  if (xf.includes("</extLst>")) return xf.replace("</extLst>", `${EXT}</extLst>`);
  return xf.replace(/<\/xf>$/, `<extLst>${EXT}</extLst></xf>`);
}

/** Turn the given boolean cells of a saved file into Excel checkboxes. */
export async function writeCheckboxes(buffer: ArrayBuffer, cells: CheckboxCells): Promise<ArrayBuffer> {
  if (!Object.values(cells).some((l) => l.length)) return buffer;
  const zip = await (await loadZip()).loadAsync(buffer);
  let styles = await zip.file("xl/styles.xml")?.async("string");
  const block = styles?.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (!styles || !block) return buffer;
  const xfs = [...block[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => m[0]);
  const added: string[] = [];
  const mapped = new Map<number, number>();
  const checkStyle = (s: number) => {
    if (!mapped.has(s)) {
      const xf = xfs[s] ?? xfs[0];
      if (xf.includes(EXT_URI)) mapped.set(s, s);
      else {
        mapped.set(s, xfs.length + added.length);
        added.push(withCheckbox(xf));
      }
    }
    return mapped.get(s)!;
  };
  let marked = 0;
  for (const [name, path] of await sheetPaths(zip)) {
    const want = new Set((cells[name] ?? []).map(addrName));
    if (!want.size) continue;
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const next = xml.replace(/<c\b[^>]*?(?:\/>|>)/g, (tag) => {
      const a = attrs(tag);
      if (!want.has(a.r) || a.t !== "b") return tag;
      marked++;
      const s = String(checkStyle(Number(a.s ?? 0)));
      return a.s !== undefined ? tag.replace(/\bs="[^"]*"/, `s="${s}"`) : tag.replace(/^<c\b/, `<c s="${s}"`);
    });
    if (next !== xml) zip.file(path, next);
  }
  if (!marked) return buffer;
  if (added.length) {
    const all = [...xfs, ...added];
    const xfsBlock = `<cellXfs count="${all.length}">${all.join("")}</cellXfs>`;
    styles = styles.replace(block[0], () => xfsBlock);
    zip.file("xl/styles.xml", styles);
  }
  // The feature bag the format points at (ExcelJS drops it, so whatever was there is gone; Excel's own content).
  zip.file(BAG_PATH, BAG_XML);
  const relsPath = "xl/_rels/workbook.xml.rels";
  const rels = await zip.file(relsPath)?.async("string");
  if (rels && !rels.includes(BAG_REL)) {
    const ids = new Set([...rels.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]));
    let n = ids.size + 1;
    while (ids.has(`rId${n}`)) n++;
    zip.file(relsPath, rels.replace("</Relationships>", `<Relationship Id="rId${n}" Type="${BAG_REL}" Target="featurePropertyBag/featurePropertyBag.xml"/></Relationships>`));
  }
  const typesPath = "[Content_Types].xml";
  const types = await zip.file(typesPath)?.async("string");
  if (types && !types.includes(`/${BAG_PATH}`)) zip.file(typesPath, types.replace("</Types>", `<Override PartName="/${BAG_PATH}" ContentType="${BAG_TYPE}"/></Types>`));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
