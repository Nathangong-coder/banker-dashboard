import { errorResponse } from "@/lib/server/http";
import { authAccount, deleteAccount } from "@/lib/server/accounts";
import { revoke } from "@/lib/server/google";

/** Turn automatic sending off: revoke Google access and delete everything the server keeps for this account. */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    await revoke(a);
    await deleteAccount(a.id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
