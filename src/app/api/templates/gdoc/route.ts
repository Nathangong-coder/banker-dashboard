import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";

/**
 * Fetch a Google Doc as .docx (keeps tabs as Title headings). Only works for docs shared as
 * "Anyone with the link can view"; the URL is restricted to docs.google.com so this can't be used as a proxy.
 */
const Body = z.object({ url: z.string().url() });

export async function POST(req: Request) {
  try {
    const { url } = Body.parse(await req.json());
    const u = new URL(url);
    const id = u.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]{20,})/)?.[1];
    if (u.hostname !== "docs.google.com" || !id) throw new HttpError(400, "Paste a Google Docs link (https://docs.google.com/document/d/…).");
    const res = await fetch(`https://docs.google.com/document/d/${id}/export?format=docx`, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || type.includes("text/html"))
      throw new HttpError(403, "Couldn't open that doc. In Google Docs: Share → General access → “Anyone with the link” (Viewer), then try again. Or use File → Download → .docx and upload that.");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 4_000_000) throw new HttpError(413, "That doc is too large (over 4 MB). Download it as .docx and upload it instead.");
    return new Response(buf, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
  } catch (e) {
    return errorResponse(e);
  }
}
