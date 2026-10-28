import { SyncBody as Body } from "@/lib/serverSyncBody";
import { HttpError, errorResponse } from "@/lib/server/http";
import { DIGEST_DAY, DIGEST_ERR, authAccount, db, dropSends, getSends, putSend, saveAccount, seal, type QueuedSend } from "@/lib/server/accounts";
import { ensureTick, queueSendJob } from "@/lib/server/jobs";
import { ackHits, readHits } from "@/lib/server/opens";
import { ackTexts, pruneTracked, trackAccount, trackStates } from "@/lib/server/gmailTrack";

/**
 * The dashboard's state for automatic sending: the queue of Gmail drafts to send and when, and what each night's 9 PM
 * WhatsApp text says. Returns what the server has done since (sent / failed sends) for the dashboard to apply.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req, { create: true });
    const b = Body.parse(await req.json());
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: b.tz });
    } catch {
      throw new HttpError(400, `Unknown time zone ${b.tz}.`);
    }
    // A page of opens only (the dashboard draining hits): nothing else is read or written, the queue is left as is.
    if (b.opensOnly) {
      await ackHits(a.id, b.opensAck);
      const { hits: opens, more: moreOpens } = await readHits(a.id, 500);
      return Response.json({ email: a.google?.email ?? null, opens, moreOpens });
    }
    const sends = b.sends;
    if (!sends) throw new HttpError(400, "The send queue is missing.");
    const next = { ...a, tz: b.tz, ...(b.digests ? { digests: Object.fromEntries(Object.entries(b.digests).slice(0, 31)) } : {}), ...(b.people ? { people: b.people } : {}), ...(b.track ? { track: b.track } : {}) };
    if (b.jobRun === null) delete next.jobRun;
    else if (b.jobRun) next.jobRun = b.jobRun;
    if (b.whatsapp === null) delete next.whatsapp;
    else if (b.whatsapp) next.whatsapp = { phone: seal(b.whatsapp.phone), apiKey: seal(b.whatsapp.apiKey) };
    await saveAccount(next);

    await dropSends(a.id, b.ack);
    const have = await getSends(a.id);
    const want = new Map(sends.map((s) => [s.draftId, s]));
    if (want.size && !next.google) throw new HttpError(400, "Connect Gmail for automatic sending first.");
    // Cancel: queued here, no longer wanted (the job finds nothing and does nothing).
    await dropSends(a.id, Object.values(have).filter((s) => s.status === "queued" && !want.has(s.draftId)).map((s) => s.draftId));
    for (const s of want.values()) {
      const cur = have[s.draftId];
      if (cur && (cur.status !== "queued" || cur.sendAt === s.sendAt)) continue;
      const q: QueuedSend = { ...s, status: "queued" };
      await putSend(a.id, q);
      await queueSendJob(req, a.id, s.draftId, s.sendAt);
    }
    if (next.whatsapp || next.google?.read) await ensureTick(req);

    // Reply tracking: drop texts already read, then check whoever is due (short budget; the hourly tick does the rest).
    let tracking: Awaited<ReturnType<typeof trackStates>> | undefined;
    if (next.google?.read) {
      await ackTexts(a.id, b.trackAck);
      if (b.track) await pruneTracked(a.id, new Set(b.track.map((p) => p.contactId)));
      await trackAccount(next, 20_000).catch(() => 0);
      tracking = await trackStates(a.id);
    }

    await ackHits(a.id, b.opensAck);
    const { hits: opens, more: moreOpens } = b.opens ? await readHits(a.id, 500) : { hits: [], more: false };

    const after = await getSends(a.id);
    const [lastDigestDay, lastDigestError] = await Promise.all([db().get<string>(DIGEST_DAY(a.id)), db().get<string>(DIGEST_ERR(a.id))]);
    return Response.json({
      email: next.google?.email ?? null,
      whatsapp: !!next.whatsapp,
      calendar: !!next.google?.calendar,
      gmailRead: !!next.google?.read,
      docs: !!next.google?.docs,
      tracking,
      lastDigestDay,
      lastDigestError,
      sends: Object.values(after),
      opens,
      moreOpens,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
