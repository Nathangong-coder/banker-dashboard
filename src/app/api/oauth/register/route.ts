import { errorResponse } from "@/lib/server/http";
import { registerClient } from "@/lib/server/oauth";

/** Dynamic client registration (RFC 7591): public clients only (PKCE, no secret). */
export async function POST(req: Request) {
  try {
    const c = await registerClient(await req.json().catch(() => ({})));
    return Response.json({ ...c, client_id_issued_at: Math.floor(Date.parse(c.created) / 1000), token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
