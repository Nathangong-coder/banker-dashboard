import { createHmac } from "node:crypto";
import { hitThrottle, netOf, repeatGate, type RawHit } from "@/lib/opens";
import { pixelExpired, pixelKeyFor, verifyPixelId } from "@/lib/pixel";
import { pushHit } from "@/lib/server/opens";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF (43 bytes).
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAEAOw==", "base64");
const HEADERS = {
  "Content-Type": "image/gif",
  "Content-Length": String(GIF.length),
  "Cache-Control": "no-store, private",
};
/** Per server instance: a replayed pixel URL is answered but recorded at most 20 times per 10 minutes (no Redis cost). */
const allow = hitThrottle(20, 10 * 60_000);
/** Per server instance: the same reader reopening the same email within 30 minutes is one open. */
const fresh = repeatGate();
const gif = () => new Response(new Uint8Array(GIF), { status: 200, headers: HEADERS });

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The tracking pixel. Always the same GIF (good id, bad id, no storage); a genuine id also records the hit, unless the
 * email is past the 60-day window or the same reader opened it in the last 30 minutes.
 */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  try {
    const { file } = await ctx.params;
    const secret = process.env.SERVER_ENC_KEY;
    const id = file.endsWith(".gif") ? file.slice(0, -4) : "";
    if (!secret || !id) return gif();
    const ok = await verifyPixelId(id, (acct) => pixelKeyFor(secret, acct));
    if (!ok || pixelExpired(ok.day)) return gif();
    const h = req.headers;
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
    // Keyed with the server secret: the 16-hex value syncs to the dashboard and must not be reversible by trying every IPv4.
    const ipHash = createHmac("sha256", secret).update("ip:" + ok.accountId + ":" + ip).digest("hex").slice(0, 16);
    if (!fresh(id + "|" + ipHash) || !allow(id)) return gif();
    const ua = (h.get("user-agent") ?? "").slice(0, 300);
    const city = h.get("x-vercel-ip-city");
    const country = h.get("x-vercel-ip-country");
    const hit: RawHit = {
      id,
      at: new Date().toISOString(),
      ua,
      ...(city ? { city: safeDecode(city).slice(0, 80) } : {}),
      ...(country ? { country: country.slice(0, 8) } : {}),
      ipHash,
      net: netOf(ip, ua),
    };
    await pushHit(ok.accountId, hit);
  } catch {
    // Never let storage trouble change what the mail client sees.
  }
  return gif();
}
