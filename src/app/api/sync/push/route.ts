import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { requireUser } from "@/lib/server/users";
import { pushDocs } from "@/lib/server/userData";

const Body = z.object({
  changed: z.record(z.string().max(600), z.string().max(2_000_000)),
  removed: z.array(z.string().max(600)).max(20_000),
});

/** Save changed docs of the signed-in user's dashboard (lib/sync.ts sends ≤ ~500 KB per call). Returns the new revision. */
export async function POST(req: Request) {
  try {
    const u = await requireUser(req);
    const b = Body.parse(await req.json());
    return Response.json({ rev: await pushDocs(u.id, b.changed, b.removed) });
  } catch (e) {
    return errorResponse(e);
  }
}
