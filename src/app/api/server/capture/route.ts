import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { addInboxItem, authCapture, newItemId } from "@/lib/server/accounts";
import type { CaptureItem } from "@/lib/infoSessions";

const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const DATA_URL = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+=*)$/;

const Body = z.object({
  text: z.string().max(5000).optional(),
  image: z.string().max(4_000_000).optional(),
  sessionId: z.string().max(300).optional(),
});

/** Decoded size of a base64 data URL; throws an actionable error if it isn't a JPEG/PNG or is too big. */
function checkImage(image: string) {
  const m = image.match(DATA_URL);
  if (!m) throw new HttpError(400, "Only JPEG or PNG images can be sent.");
  const bytes = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith("==") ? 2 : m[2].endsWith("=") ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new HttpError(413, "That image is over 2.5 MB. Take a smaller photo or crop the screenshot.");
}

/** One item from the phone capture page (names typed, or one photo / screenshot) into the account's inbox. */
export async function POST(req: Request) {
  try {
    const a = await authCapture(req);
    const b = Body.parse(await req.json());
    const text = b.text?.trim();
    if (!text && !b.image) throw new HttpError(400, "Add a photo, a screenshot or some names first.");
    if (b.image) checkImage(b.image);
    const item: CaptureItem = { id: newItemId(), at: new Date().toISOString(), via: "phone", ...(text ? { text } : {}), ...(b.image ? { image: b.image } : {}), ...(b.sessionId ? { sessionId: b.sessionId } : {}) };
    await addInboxItem(a.id, item);
    return Response.json({ ok: true, id: item.id });
  } catch (e) {
    return errorResponse(e);
  }
}
