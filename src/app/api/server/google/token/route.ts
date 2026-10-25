import { errorResponse } from "@/lib/server/http";
import { authAccount, db, seal, unseal } from "@/lib/server/accounts";
import { accessTokenWithScopes } from "@/lib/server/google";

/**
 * A short-lived Google access token for the dashboard's own Gmail / Calendar / Docs calls (lib/googleToken.ts), from
 * the "Connect Google" refresh token, so signed-in users never get Google's popup. Cached (sealed) until shortly
 * before it expires. Returns { access: null } when Google isn't connected.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    if (!a.google) return Response.json({ access: null, scopes: [] });
    const key = `gtok:${a.id}`;
    const cached = await db().get<string>(key);
    if (cached) return Response.json(JSON.parse(unseal(cached)), { headers: { "Cache-Control": "no-store" } });
    const t = await accessTokenWithScopes(a);
    const out = { access: t.access, scopes: t.scopes, email: a.google.email, exp: Date.now() + (t.expiresIn - 120) * 1000 };
    await db().set(key, seal(JSON.stringify(out)), { ex: Math.max(60, t.expiresIn - 300) });
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
