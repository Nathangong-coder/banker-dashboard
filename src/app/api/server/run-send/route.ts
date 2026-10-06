import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { getSend, loadAccount, putSend } from "@/lib/server/accounts";
import { accessToken, sendDraft } from "@/lib/server/google";
import { verifyQstash } from "@/lib/server/jobs";

const Body = z.object({ acct: z.string(), draftId: z.string(), sendAt: z.string() });

/** QStash calls this at a queued send's time: send that Gmail draft, unless it was cancelled or rescheduled. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(JSON.parse(await verifyQstash(req)));
    const [a, s] = await Promise.all([loadAccount(b.acct), getSend(b.acct, b.draftId)]);
    // Cancelled, rescheduled (a newer job carries the new time) or already done: nothing to do.
    if (!a || !s || s.status !== "queued" || s.sendAt !== b.sendAt) return Response.json({ skipped: true });
    const done = new Date().toISOString();
    try {
      const sent = await sendDraft(await accessToken(a), s.draftId);
      await putSend(a.id, { ...s, status: "sent", messageId: sent.id, threadId: sent.threadId, doneAt: done });
      console.log(`[server] sent queued draft for ${a.id.slice(0, 6)}… step ${s.step}`);
      return Response.json({ sent: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 404 || status === 400) {
        // The draft is gone: sent by hand, deleted, or it belongs to a different Gmail account.
        await putSend(a.id, { ...s, status: "missing", doneAt: done, error: "The Gmail draft wasn't there (sent or deleted already, or made in another Gmail account)." });
        return Response.json({ missing: true });
      }
      if (status === 401) {
        await putSend(a.id, { ...s, status: "failed", doneAt: done, error: (e as Error).message });
        return Response.json({ failed: true });
      }
      // Gmail hiccup: let QStash retry.
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}
