import { errorResponse } from "@/lib/server/http";
import { currentUser, endSession } from "@/lib/server/users";

/** Sign this browser out (other browsers stay signed in). */
export async function POST(req: Request) {
  try {
    await currentUser(req); // origin check
    return Response.json({ ok: true }, { headers: { "Set-Cookie": await endSession(req) } });
  } catch (e) {
    return errorResponse(e);
  }
}
