import { errorResponse } from "@/lib/server/http";
import { currentUser, publicUser } from "@/lib/server/users";

/** Who's signed in on this browser ({ user: null } when nobody). Never cached. */
export async function GET(req: Request) {
  try {
    const u = await currentUser(req);
    return Response.json({ user: u ? { ...publicUser(u), accountId: u.accountId ?? null } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
