import { revokeToken } from "@/lib/server/oauth";

/** Token revocation (RFC 7009): always 200. */
export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text().catch(() => ""));
  const token = form.get("token");
  if (token) await revokeToken(token).catch(() => undefined);
  return new Response(null, { status: 200 });
}
