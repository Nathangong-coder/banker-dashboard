import { OAuthError, exchange } from "@/lib/server/oauth";

/** Token endpoint: authorization_code (+ PKCE) and refresh_token grants, form-encoded, RFC 6749 errors. */
export async function POST(req: Request) {
  try {
    const type = req.headers.get("content-type") ?? "";
    const form = type.includes("application/json") ? new URLSearchParams((await req.json()) as Record<string, string>) : new URLSearchParams(await req.text());
    return Response.json(await exchange(form), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const code = e instanceof OAuthError ? e.code : "server_error";
    return Response.json({ error: code, error_description: (e as Error).message }, { status: e instanceof OAuthError ? 400 : 500, headers: { "Cache-Control": "no-store" } });
  }
}
