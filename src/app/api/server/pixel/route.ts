import { resolveMx } from "node:dns/promises";
import { z } from "zod";
import { errorResponse, HttpError } from "@/lib/server/http";
import { appUrl, authAccount } from "@/lib/server/accounts";
import { pixelKeyFor } from "@/lib/pixel";

const Body = z.object({ domains: z.array(z.string().min(1).max(253)).max(50).optional() });
const DOMAIN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

async function mxKind(domain: string): Promise<"google" | "other"> {
  if (!DOMAIN.test(domain)) return "other";
  try {
    const rows = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 3000)),
    ]);
    return rows.some((r) => /(^|\.)(google|googlemail)\.com\.?$/i.test(r.exchange)) ? "google" : "other";
  } catch {
    return "other";
  }
}

/** The account's pixel key (the dashboard mints ids offline), the public base URL, and optionally which domains use Google mail. */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req, { create: true });
    const b = Body.parse(await req.json().catch(() => ({})));
    const secret = process.env.SERVER_ENC_KEY;
    if (!secret) throw new HttpError(503, "The server isn't set up for open tracking (SERVER_ENC_KEY).");
    const out: { key: string; base: string; mx?: Record<string, "google" | "other"> } = { key: await pixelKeyFor(secret, a.id), base: appUrl(req) };
    if (b.domains?.length) {
      const list = [...new Set(b.domains.map((d) => d.toLowerCase()))];
      out.mx = Object.fromEntries(await Promise.all(list.map(async (d) => [d, await mxKind(d)] as const)));
    }
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
