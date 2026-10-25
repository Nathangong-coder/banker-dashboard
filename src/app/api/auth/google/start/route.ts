import { randomBytes } from "node:crypto";
import { appUrl, db } from "@/lib/server/accounts";
import { SIGNIN_CALLBACK, signInUrl } from "@/lib/server/googleSignIn";
import { SIGNIN_COOKIE, cookie } from "@/lib/server/users";

const RETURN = /^\/[A-Za-z0-9/_?=&.%-]*$/;

/**
 * "Sign in with Google": a plain link (GET), so it works from any page. The state is kept in Redis for 10 minutes and
 * in a cookie on this browser, so a sign-in started somewhere else can't be finished here (login CSRF).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const base = appUrl(req);
  const r = u.searchParams.get("returnTo") ?? "/";
  const returnTo = RETURN.test(r) && !r.startsWith("//") ? r.slice(0, 300) : "/";
  try {
    const state = randomBytes(24).toString("base64url");
    await db().set(`signin:${state}`, { returnTo }, { ex: 600 });
    const hint = u.searchParams.get("hint") ?? undefined;
    return new Response(null, {
      status: 302,
      headers: { Location: signInUrl(`${base}${SIGNIN_CALLBACK}`, state, hint && /^[^@\s]+@[^@\s]+$/.test(hint) ? hint : undefined), "Set-Cookie": cookie(req, SIGNIN_COOKIE, state, 600, "/api/auth") },
    });
  } catch (e) {
    return Response.redirect(`${base}/?signin=error&reason=${encodeURIComponent((e as Error).message.slice(0, 200))}`, 302);
  }
}
