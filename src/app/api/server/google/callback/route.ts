import { appUrl, db, loadAccount, saveAccount, seal } from "@/lib/server/accounts";
import { CALLBACK_PATH, exchangeCode, gmailProfile } from "@/lib/server/google";

/** Google sends the user back here after consent. Stores the encrypted refresh token, then returns to the app. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const base = appUrl(req);
  const back = (returnTo: string, q: Record<string, string>) => Response.redirect(`${base}${returnTo}${returnTo.includes("?") ? "&" : "?"}${new URLSearchParams(q)}`, 302);
  const state = u.searchParams.get("state") ?? "";
  const pending = state ? await db().getdel<{ acct: string; returnTo: string }>(`oauth:${state}`) : null;
  const returnTo = pending?.returnTo ?? "/followups";
  if (u.searchParams.get("error")) return back(returnTo, { server: "error", reason: u.searchParams.get("error") === "access_denied" ? "You cancelled the Google screen." : u.searchParams.get("error")! });
  if (!pending) return back(returnTo, { server: "error", reason: "That sign-in link expired. Try Connect again." });
  try {
    const a = await loadAccount(pending.acct);
    if (!a) return back(returnTo, { server: "error", reason: "Account not found. Try Connect again." });
    const t = await exchangeCode(u.searchParams.get("code") ?? "", `${base}${CALLBACK_PATH}`);
    const { emailAddress } = await gmailProfile(t.access);
    await saveAccount({ ...a, google: { refresh: seal(t.refresh), email: emailAddress, connectedAt: new Date().toISOString() } });
    return back(returnTo, { server: "connected", email: emailAddress });
  } catch (e) {
    return back(returnTo, { server: "error", reason: (e as Error).message.slice(0, 200) });
  }
}
