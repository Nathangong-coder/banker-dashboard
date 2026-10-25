"use client";

import { docxText } from "./docxText";

/**
 * Plain text out of a document you upload (writing samples, resumes), read in the browser. PDFs use pdf.js, loaded
 * on demand with its worker (pdf.js 6 has no eval path, so a crafted PDF can't run code through it).
 */

async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      } else if (item.str && !item.str.endsWith(" ")) line += " ";
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+/g, " ").trim()).join("\n"));
  }
  await task.destroy();
  return pages.join("\n\n");
}

/** Text of a .pdf, .docx, .txt or .md file. Throws a readable error for anything else (or a scanned PDF). */
export async function documentText(name: string, data: ArrayBuffer): Promise<string> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") {
    const text = (await pdfText(data)).replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 40) throw new Error("That PDF has no readable text (probably a scan). Paste the text instead.");
    return text;
  }
  if (ext === "docx") return docxText(data);
  if (ext === "doc") throw new Error("Old .doc files can't be read. Save it as .docx or PDF first.");
  if (ext === "txt" || ext === "md") return new TextDecoder().decode(data);
  throw new Error("Use a .pdf, .docx, .txt or .md file, or paste the text.");
}
