import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { authAccount, loadAccount, mergeAccounts, type Account } from "@/lib/server/accounts";
import { requireUser, saveUser } from "@/lib/server/users";

const Body = z.object({ drop: z.string().regex(/^[A-Za-z0-9_-]{16,64}\.\S{32,}$/).optional() });

/**
 * Tie the browser's automatic-sending account (Authorization: Bearer id.token, the one in its synced settings) to the
 * signed-in user. `drop` = another account's credentials this browser had (its old local data, or the account's data
 * it replaced): it's merged in and deleted, so a user always ends up with exactly one.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const a = await authAccount(req, { create: true });
    const b = Body.parse(await req.json().catch(() => ({})));
    const others = new Set<string>();
    if (user.accountId && user.accountId !== a.id) others.add(user.accountId);
    if (b.drop) {
      const other = new Request(req.url, { headers: { authorization: `Bearer ${b.drop}` } });
      const d: Account | null = await authAccount(other).catch(() => null);
      if (d && d.id !== a.id) others.add(d.id);
    }
    for (const id of others) if (await loadAccount(id)) await mergeAccounts(a.id, id);
    if (user.accountId !== a.id) await saveUser({ ...user, accountId: a.id });
    return Response.json({ accountId: a.id, merged: others.size });
  } catch (e) {
    return errorResponse(e);
  }
}
