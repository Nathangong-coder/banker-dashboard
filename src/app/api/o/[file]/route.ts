import { createHash } from "node:crypto";
import { netOf, type RawHit } from "@/lib/opens";
import { pixelKeyFor, verifyPixelId } from "@/lib/pixel";
import { pushHit } from "@/lib/server/opens";

export const dynamic = "force-dynamic";

// 1x1 transparent GIF (43 bytes).
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAEAOw==", "base64");
const HEADERS = {
  "Content-Type": "image/gif",
  "Content-Length": String(GIF.length),
  "Cache-Control": "no-store, private",
};
const gif = () => new Response(new Uint8Array(GIF), { status: 200, headers: HEADERS });

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The tracking pixel. Always the same GIF (good id, bad id, no storage); a genuine id also records the hit. */
export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  try {
    const { file } = await ctx.params;
    const secret = process.env.SERVER_ENC_KEY;
    const id = file.endsWith(".gif") ? file.slice(0, -4) : "";
    if (!secret || !id) return gif();
    const ok = await verifyPixelId(id, (acct) => pixelKeyFor(secret, acct));
    if (!ok) return gif();
    const h = req.headers;
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "";
    const ua = (h.get("user-agent") ?? "").slice(0, 300);
    const city = h.get("x-vercel-ip-city");
    const country = h.get("x-vercel-ip-country");
    const hit: RawHit = {
      id,
      at: new Date().toISOString(),
      ua,
      ...(city ? { city: safeDecode(city).slice(0, 80) } : {}),
      ...(country ? { country: country.slice(0, 8) } : {}),
      ipHash: createHash("sha256").update(ok.accountId + ip).digest("hex").slice(0, 16),
      net: netOf(ip, ua),
    };
    await pushHit(ok.accountId, hit);
  } catch {
    // Never let storage trouble change what the mail client sees.
  }
  return gif();
}
