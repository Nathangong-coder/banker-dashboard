import { resourceMetadata } from "@/lib/server/oauth";

/** Protected resource metadata (RFC 9728): /api/mcp is protected by Coverage's own authorization server. */
export function GET(req: Request) {
  return Response.json(resourceMetadata(req), { headers: { "Cache-Control": "public, max-age=3600" } });
}
