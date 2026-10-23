import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { authAccount } from "@/lib/server/accounts";
import { SCOPE, checkAuthRequest, issueCode } from "@/lib/server/oauth";

const Body = z.object({
  client_id: z.string().max(100),
  redirect_uri: z.string().max(2000),
  code_challenge: z.string().max(200),
  code_challenge_method: z.string().max(10).optional(),
  response_type: z.string().max(20).optional(),
  state: z.string().max(2000).optional(),
  scope: z.string().max(200).optional(),
  /** true = only check the request and say which app it is (for the approval screen). */
  check: z.boolean().optional(),
  /** false = the user said no. */
  approve: z.boolean().optional(),
});

/**
 * The /connect page's approval: signed in with the browser's Coverage account (Authorization: Bearer id.token, the
 * same as automatic sending). Returns where to send the browser: the app's redirect with a one-time code, or an error.
 */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const client = await checkAuthRequest(b);
    if (b.check) return Response.json({ client: client.client_name });
    const back = new URL(b.redirect_uri);
    if (b.state) back.searchParams.set("state", b.state);
    if (b.approve === false) {
      back.searchParams.set("error", "access_denied");
      return Response.json({ redirect: back.toString() });
    }
    const a = await authAccount(req);
    if (!a.google) throw new HttpError(400, "Turn on automatic sending first (Follow-ups → Reminders): the connector reads what Coverage's server keeps for you.");
    const code = await issueCode(a.id, { clientId: b.client_id, redirectUri: b.redirect_uri, challenge: b.code_challenge, scope: SCOPE });
    back.searchParams.set("code", code);
    return Response.json({ redirect: back.toString() });
  } catch (e) {
    return errorResponse(e);
  }
}
