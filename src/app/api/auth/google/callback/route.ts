import { appUrl, db } from "@/lib/server/accounts";
import { SIGNIN_CALLBACK, exchangeSignIn } from "@/lib/server/googleSignIn";
import { SIGNIN_COOKIE, cookie, createSession, readCookie, upsertGoogleUser } from "@/lib/server/users";

/** Google sends the browser back here after "Sign in with Google": make the session, then go back to the page. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const base = appUrl(req);
  const clear = cookie(req, SIGNIN_COOKIE, "", 0, "/api/auth");
  const fail = (reason: string) => new Response(null, { status: 302, headers: [["Location", `${base}/?signin=error&reason=${encodeURIComponent(reason)}`], ["Set-Cookie", clear]] });
  const state = u.searchParams.get("state") ?? "";
  if (u.searchParams.get("error")) return fail(u.searchParams.get("error") === "access_denied" ? "You cancelled the Google screen." : u.searchParams.get("error")!);
  if (!state || readCookie(req, SIGNIN_COOKIE) !== state) return fail("That sign-in didn't start in this browser. Try Sign in again.");
  const pending = await db().getdel<{ returnTo: string }>(`signin:${state}`);
  if (!pending) return fail("That sign-in link expired. Try Sign in again.");
  try {
    const profile = await exchangeSignIn(u.searchParams.get("code") ?? "", `${base}${SIGNIN_CALLBACK}`);
    const user = await upsertGoogleUser(profile);
    const session = await createSession(req, user.id);
    return new Response(null, { status: 302, headers: [["Location", `${base}${pending.returnTo}`], ["Set-Cookie", session], ["Set-Cookie", clear]] });
  } catch (e) {
    return fail((e as Error).message.slice(0, 200));
  }
}
