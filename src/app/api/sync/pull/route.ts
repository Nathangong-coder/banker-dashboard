import { errorResponse } from "@/lib/server/http";
import { requireUser } from "@/lib/server/users";
import { pullDocs } from "@/lib/server/userData";

/** The signed-in user's docs changed after revision ?since= (0 = everything). Loop while `more`. */
export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    const since = Math.max(0, Math.floor(Number(new URL(req.url).searchParams.get("since") ?? 0)) || 0);
    return Response.json(await pullDocs(u.id, since), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
