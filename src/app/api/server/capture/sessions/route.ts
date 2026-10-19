import { errorResponse } from "@/lib/server/http";
import { authCapture } from "@/lib/server/accounts";
import { currentSession, infoSessionsBetween } from "@/lib/server/google";

/**
 * For the phone page's session picker: your info sessions from 7 days back to 2 days ahead, newest first, and the one
 * to preselect (going on now, else the one that ended most recently). No Calendar access = an empty list.
 */
export async function POST(req: Request) {
  try {
    const a = await authCapture(req);
    if (!a.google?.calendar) return Response.json({ calendar: false, sessions: [], defaultId: null });
    const now = Date.now();
    const sessions = (await infoSessionsBetween(a, new Date(now - 7 * 86400_000).toISOString(), new Date(now + 2 * 86400_000).toISOString())).sort(
      (x, y) => Date.parse(y.start) - Date.parse(x.start),
    );
    return Response.json({ calendar: true, sessions, defaultId: currentSession(sessions, now)?.eventId ?? null, tz: a.tz });
  } catch (e) {
    return errorResponse(e);
  }
}
