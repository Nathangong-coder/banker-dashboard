import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { authAccount } from "@/lib/server/accounts";
import { infoSessionsBetween } from "@/lib/server/google";

const Body = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });
const MAX_DAYS = 240;

/**
 * Info sessions on your Google Calendar between `from` and `to` (the dashboard's /info-sessions). Read with the
 * server's read-only Calendar access; nothing is stored. No Calendar access = `calendar: false` and no sessions.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    const b = Body.parse(await req.json());
    const from = Date.parse(b.from);
    const to = Date.parse(b.to);
    if (!(to > from)) throw new HttpError(400, "`to` must be after `from`.");
    if (to - from > MAX_DAYS * 86400_000) throw new HttpError(400, `Ask for at most ${MAX_DAYS} days at a time.`);
    if (!a.google?.calendar) return Response.json({ calendar: false, sessions: [] });
    const sessions = await infoSessionsBetween(a, new Date(from).toISOString(), new Date(to).toISOString());
    return Response.json({ calendar: true, sessions });
  } catch (e) {
    return errorResponse(e);
  }
}
