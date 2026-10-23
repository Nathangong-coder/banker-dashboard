import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { authAccount } from "@/lib/server/accounts";
import { accessToken, getDoc, searchDocs } from "@/lib/server/google";
import { docJsonText, driveQueries, type DriveDoc } from "@/lib/docMatch";

const Body = z.object({
  /** People to look up in Drive: key → full name. */
  find: z.array(z.object({ key: z.string().max(200), name: z.string().min(2).max(120) })).max(25).optional(),
  /** Doc ids to read. */
  read: z.array(z.string().regex(/^[\w-]{20,100}$/)).max(10).optional(),
});

/**
 * Chat notes docs (owner, 2026-10-23), read with the server's optional read-only Docs + Drive access, so private docs
 * work and no Google popup is needed. `find` searches Drive for each person (the browser picks with
 * lib/docMatch.ts#pickDoc); `read` returns docs' text. Nothing is stored. No access = `docs: false`.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    const b = Body.parse(await req.json());
    if (!a.google?.docs) return Response.json({ docs: false });
    const access = await accessToken(a);
    const found: Record<string, DriveDoc[]> = {};
    const errors: string[] = [];
    // A few at a time: Drive's per-user rate limit is generous, Vercel's time limit less so.
    const find = b.find ?? [];
    for (let i = 0; i < find.length; i += 5)
      await Promise.all(
        find.slice(i, i + 5).map(async (p) => {
          try {
            found[p.key] = await searchDocs(access, driveQueries(p.name));
          } catch (e) {
            errors.push((e as Error).message);
          }
        }),
      );
    const texts: Record<string, { title?: string; text?: string; error?: string }> = {};
    await Promise.all(
      (b.read ?? []).map(async (id) => {
        try {
          const d = await getDoc(access, id);
          texts[id] = { title: d.title, text: docJsonText(d) };
        } catch (e) {
          texts[id] = { error: (e as Error).message };
        }
      }),
    );
    // One error for the whole search is enough (they're all the same "API not enabled" / "no access").
    return Response.json({ docs: true, found, texts, error: [...new Set(errors)][0] });
  } catch (e) {
    return errorResponse(e);
  }
}
