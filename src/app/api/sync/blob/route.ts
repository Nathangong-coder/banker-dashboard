import { HttpError, errorResponse } from "@/lib/server/http";
import { requireUser } from "@/lib/server/users";
import { PART_BYTES, deleteParts, getPart, putPart } from "@/lib/server/userData";

function args(req: Request) {
  const q = new URL(req.url).searchParams;
  return { name: q.get("name") ?? "", part: Number(q.get("part") ?? 0) };
}

/** One part (≤3 MB) of a big file: the workbook, parsed sheets, a resume, the signature logo. */
export async function PUT(req: Request) {
  try {
    const u = await requireUser(req);
    const { name, part } = args(req);
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > PART_BYTES) throw new HttpError(413, "File part too big.");
    await putPart(u.id, name, part, new Uint8Array(await req.arrayBuffer()));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    const { name, part } = args(req);
    const bytes = await getPart(u.id, name, part);
    if (!bytes) throw new HttpError(404, "That file isn't in your account.");
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** ?name=…&from=N removes parts N and up (all when from is 0). */
export async function DELETE(req: Request) {
  try {
    const u = await requireUser(req);
    const q = new URL(req.url).searchParams;
    await deleteParts(u.id, q.get("name") ?? "", Math.max(0, Number(q.get("from") ?? 0) || 0));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
