import { errorResponse } from "@/lib/server/http";
import { deleteAccount, loadAccount } from "@/lib/server/accounts";
import { revoke } from "@/lib/server/google";
import { deleteUserData } from "@/lib/server/userData";
import { cookie, deleteUserRecord, requireUser, SESSION_COOKIE } from "@/lib/server/users";

/**
 * Delete the signed-in user's Coverage account: every synced doc and file, automatic sending (Google access revoked,
 * queue, texts, captures, Claude connector tokens) and every session. Can't be undone.
 */
export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    if (u.accountId) {
      const a = await loadAccount(u.accountId);
      if (a) {
        await revoke(a);
        await deleteAccount(a.id);
      }
    }
    await deleteUserData(u.id);
    await deleteUserRecord(u.id);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie(req, SESSION_COOKIE, "", 0) } });
  } catch (e) {
    return errorResponse(e);
  }
}
