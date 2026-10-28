import { z } from "zod";
import { errorResponse } from "@/lib/server/http";
import { authAccount } from "@/lib/server/accounts";
import { accessToken, gmail } from "@/lib/server/google";
import { parseAddrs } from "@/lib/replyTracking";

const Body = z.object({
  /** "YYYY/MM/DD": sent mail on or after this day. */
  after: z.string().regex(/^\d{4}\/\d{2}\/\d{2}$/),
  /** Gmail's page token from the previous answer (`next`). */
  page: z.string().max(200).optional(),
});

type Meta = { id: string; threadId: string; internalDate: string; labelIds?: string[]; payload?: { headers?: { name: string; value: string }[] } };

const PER_CALL = 250;
const BUDGET_MS = 25_000;

/**
 * Who you emailed (owner, 2026-10-28): the To / Cc / Bcc of your sent mail since `after`, read with the server's
 * read-only Gmail access, so the dashboard can find bankers you wrote to who aren't in the tracker (lib/offSheet.ts)
 * without a Google popup in the tab. Three Tidal info-session thank-yous and two Mizuho ones (mizuhogroup.com) were
 * missed because the old scan only ran with a Gmail token in the browser, and only read To. Nothing is stored.
 * No read access = `read: false`.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    const b = Body.parse(await req.json());
    if (!a.google?.read) return Response.json({ read: false, recipients: [] });
    const access = await accessToken(a);
    const list = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(
      access,
      `/messages?q=${encodeURIComponent(`in:sent after:${b.after}`)}&maxResults=${PER_CALL}${b.page ? `&pageToken=${encodeURIComponent(b.page)}` : ""}`,
    );
    const ids = (list.messages ?? []).map((m) => m.id);
    const started = Date.now();
    const out: { id: string; email: string; name: string; at: number; subject: string; threadId: string }[] = [];
    let i = 0;
    let stopped = false;
    const worker = async () => {
      while (i < ids.length) {
        if (Date.now() - started > BUDGET_MS) {
          stopped = true;
          return;
        }
        const id = ids[i++];
        const m = await gmail<Meta>(access, `/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc&metadataHeaders=Subject`);
        const at = Number(m.internalDate);
        // A Schedule-send email that hasn't gone out isn't one to follow up on yet.
        if (m.labelIds?.includes("SCHEDULED") || at > Date.now()) continue;
        const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value;
        const subject = (h("subject") ?? "").slice(0, 200);
        for (const r of [...parseAddrs(h("to")), ...parseAddrs(h("cc")), ...parseAddrs(h("bcc"))])
          out.push({ id: m.id, email: r.email.toLowerCase().slice(0, 320), name: (r.name ?? "").slice(0, 200), at, subject, threadId: m.threadId });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    // Out of time mid-page: the dashboard asks for the same page again and skips messages it already has.
    return Response.json({ read: true, recipients: out, next: stopped ? (b.page ?? "") : (list.nextPageToken ?? null), partial: stopped });
  } catch (e) {
    return errorResponse(e);
  }
}
