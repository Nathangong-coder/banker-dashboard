import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { authAccount } from "@/lib/server/accounts";
import { accessToken, listEvents, plainText } from "@/lib/server/google";
import { meetingLink } from "@/lib/infoSessions";

const Body = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });
const MAX_DAYS = 120;

/**
 * Your Google Calendar events between `from` and `to` for the dashboard's Calendar page (app/calendar), which picks
 * out the coffee chats and info sessions in the browser. Read with the server's read-only Calendar access; nothing is
 * stored. No Calendar access = `calendar: false`.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    const b = Body.parse(await req.json());
    const from = Date.parse(b.from);
    const to = Date.parse(b.to);
    if (!(to > from)) throw new HttpError(400, "`to` must be after `from`.");
    if (to - from > MAX_DAYS * 86400_000) throw new HttpError(400, `Ask for at most ${MAX_DAYS} days at a time.`);
    if (!a.google?.calendar) return Response.json({ calendar: false, events: [] });
    const events = (await listEvents(await accessToken(a), new Date(from).toISOString(), new Date(to).toISOString())).slice(0, 1500).map((e) => ({
      id: e.id,
      title: e.summary,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
      link: meetingLink(`${e.description} ${plainText(e.description)} ${e.location ?? ""}`),
      attendees: e.attendees.slice(0, 8),
    }));
    return Response.json({ calendar: true, events });
  } catch (e) {
    return errorResponse(e);
  }
}
