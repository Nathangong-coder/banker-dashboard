import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { authAccount, readInbox } from "@/lib/server/accounts";

const Body = z.object({ ack: z.array(z.string().max(100)).max(200).optional() });

/**
 * The dashboard pulls what your phone sent (capture page, share sheet, texts to your Twilio number): deletes the
 * `ack`ed items, then returns the oldest waiting ones with their images (≤ 30, ≤ ~3.5 MB of images). `more` = call
 * again after acking these.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    const b = Body.parse(await req.json().catch(() => ({})));
    return Response.json(await readInbox(a.id, b.ack ?? []));
  } catch (e) {
    return errorResponse(e);
  }
}
