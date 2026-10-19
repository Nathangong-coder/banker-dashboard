import { errorResponse } from "@/lib/server/http";
import { authCapture } from "@/lib/server/accounts";

/**
 * The phone's share sheet posts straight to /api/capture-share with no way to add a header (no service worker), so
 * the capture page stores its key in an HttpOnly cookie scoped to that path. Same key as the page's header.
 */
export async function POST(req: Request) {
  try {
    await authCapture(req);
    const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `coverage_capture=${key}; Path=/api/capture-share; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
