import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { authAccount, captureUrl } from "@/lib/server/accounts";

const Body = z.object({ rotate: z.boolean().optional() });

/** The phone capture link (/capture#k=…), made on first use. `rotate` makes a new one and breaks the old link. */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    const b = Body.parse(await req.json().catch(() => ({})));
    return Response.json({ url: await captureUrl(a, req, !!b.rotate) });
  } catch (e) {
    return errorResponse(e);
  }
}
