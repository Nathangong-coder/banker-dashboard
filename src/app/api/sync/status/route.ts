import { errorResponse } from "@/lib/server/http";
import { requireUser } from "@/lib/server/users";
import { dataStatus } from "@/lib/server/userData";

/** How much the signed-in user has stored ({rev, docs, contacts}): an empty account gets a browser's data moved in. */
export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    return Response.json(await dataStatus(u.id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
