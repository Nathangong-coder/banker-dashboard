import { errorResponse } from "@/lib/server/http";
import { authAccount } from "@/lib/server/accounts";
import { readScheduled } from "@/lib/server/scheduled";

export const maxDuration = 30;

/** Emails waiting in Gmail's Schedule send (lib/server/scheduled.ts). */
export async function POST(req: Request) {
  try {
    return Response.json(await readScheduled(await authAccount(req)));
  } catch (e) {
    return errorResponse(e);
  }
}
