/** Plain text out of Word files, in the browser. JSZip is loaded on demand (only Word files need it). */

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");

/** Paragraph text of a .docx (JSZip loaded on demand: it's only needed for Word files). */
export async function docxText(data: ArrayBuffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("That doesn't look like a Word document.");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .map((p) =>
      [...p.matchAll(/<w:(t|tab|br)(?: [^>]*)?(?:\/>|>([^<]*)<\/w:t>)/g)]
        .map((m) => (m[1] === "t" ? decodeXml(m[2] ?? "") : m[1] === "tab" ? "\t" : "\n"))
        .join(""),
    )
    .join("\n");
}
