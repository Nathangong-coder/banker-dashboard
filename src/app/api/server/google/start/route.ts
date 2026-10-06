import { randomBytes } from "node:crypto";
import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { appUrl, authAccount, db } from "@/lib/server/accounts";
import { CALLBACK_PATH, authUrl } from "@/lib/server/google";

const Body = z.object({ loginHint: z.string().email().optional(), returnTo: z.string().regex(/^\/[A-Za-z0-9/_?=&.-]*$/).max(200).optional() });

/** Start connecting Gmail for automatic sending: returns Google's consent URL (the browser opens it). */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req, { create: true });
    const b = Body.parse(await req.json().catch(() => ({})));
    const state = randomBytes(24).toString("base64url");
    // One-time, short-lived: the callback looks the account up by it (no credentials in the URL).
    await db().set(`oauth:${state}`, { acct: a.id, returnTo: b.returnTo ?? "/followups" }, { ex: 600 });
    return Response.json({ url: authUrl(`${appUrl(req)}${CALLBACK_PATH}`, state, b.loginHint) });
  } catch (e) {
    return errorResponse(e);
  }
}
