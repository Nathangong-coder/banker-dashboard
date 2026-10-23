import { authServerMetadata } from "@/lib/server/oauth";

/** OAuth authorization server metadata (RFC 8414) for the Claude connector. */
export function GET(req: Request) {
  return Response.json(authServerMetadata(req), { headers: { "Cache-Control": "public, max-age=3600" } });
}
