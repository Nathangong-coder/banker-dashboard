import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { DIGEST_DAY, DIGEST_ERR, authAccount, db, dropSends, getSends, putSend, saveAccount, seal, type QueuedSend } from "@/lib/server/accounts";
import { ensureTick, queueSendJob } from "@/lib/server/jobs";
import { ackHits, readHits } from "@/lib/server/opens";
import { ackTexts, pruneTracked, trackAccount, trackStates } from "@/lib/server/gmailTrack";

const Item = z.object({ contactId: z.string().max(200), name: z.string().max(200), email: z.string().max(320).optional(), label: z.string().max(60) });
const Body = z.object({
  tz: z.string().max(64),
  /** null = turn the 9 PM text off; undefined = leave as is. */
  whatsapp: z.object({ phone: z.string().min(8).max(32), apiKey: z.string().min(3).max(64) }).nullable().optional(),
  digests: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.object({ items: z.array(Item).max(400), queued: z.number().int().min(0) })).optional(),
  /** People today's calendar events are matched against (thank-you reminders). */
  people: z
    .array(
      z.object({
        contactId: z.string().max(200),
        name: z.string().max(200),
        email: z.string().max(320).optional(),
        thankedAt: z.string().max(40).optional(),
        bank: z.string().max(200).optional(),
        linkedin: z.string().max(300).optional(),
        loggedAt: z.string().max(40).optional(),
      }),
    )
    .max(400)
    .optional(),
  /** People whose replies / thank-yous / intros the server watches in Gmail (needs read access). */
  track: z
    .array(
      z.object({
        contactId: z.string().max(200),
        name: z.string().max(200),
        emails: z.array(z.string().email().max(320)).min(1).max(4),
        since: z.string().max(40).optional(),
        hot: z.boolean().optional(),
        knownLast: z.string().max(40).optional(),
      }),
    )
    .max(400)
    .optional(),
  /** The "press Search" reminder: null = off. */
  jobRun: z.object({ lastAt: z.string().max(40).optional(), everyDays: z.number().int().min(1).max(14) }).nullable().optional(),
  /** Reply texts the dashboard has read (dropped from the server). */
  trackAck: z.array(z.object({ contactId: z.string().max(200), ids: z.array(z.string().max(100)).max(50) })).max(400).default([]),
  /** Every send the dashboard wants queued. Queued sends missing from this list are cancelled. */
  sends: z.array(z.object({ draftId: z.string().min(5).max(200), contactId: z.string().max(200), name: z.string().max(200), step: z.number().int().min(0).max(10), sendAt: z.string().datetime() })).max(400),
  /** Pixel hits (`id|at`) the dashboard has stored; dropped from the server. */
  opensAck: z.array(z.string().max(80)).max(2000).default([]),
  /** Finished sends the dashboard has applied (removed from the server). */
  ack: z.array(z.string().max(200)).max(400).default([]),
});

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
    const next = { ...a, tz: b.tz, ...(b.digests ? { digests: Object.fromEntries(Object.entries(b.digests).slice(0, 31)) } : {}), ...(b.people ? { people: b.people } : {}), ...(b.track ? { track: b.track } : {}) };
    if (b.jobRun === null) delete next.jobRun;
    else if (b.jobRun) next.jobRun = b.jobRun;
    if (b.whatsapp === null) delete next.whatsapp;
    else if (b.whatsapp) next.whatsapp = { phone: seal(b.whatsapp.phone), apiKey: seal(b.whatsapp.apiKey) };
    await saveAccount(next);

    await dropSends(a.id, b.ack);
    const have = await getSends(a.id);
    const want = new Map(b.sends.map((s) => [s.draftId, s]));
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
    const { hits: opens, more: moreOpens } = await readHits(a.id, 500);

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
