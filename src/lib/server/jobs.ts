import "server-only";
import { Client, Receiver } from "@upstash/qstash";
import { HttpError } from "./http";
import { appUrl } from "./accounts";

/**
 * Upstash QStash delivers our own timed calls: one message per queued send (delivered at its send time), and an
 * hourly schedule that sends each account's 9am WhatsApp text. Vercel Cron on Hobby only runs daily, so it can't hit
 * 5 PM / 7 PM PT; QStash can, to the minute.
 */

let qc: Client | null = null;
function qstash() {
  if (!process.env.QSTASH_TOKEN) throw new HttpError(503, "The server isn't set up for automatic sending (QStash not connected).");
  qc ??= new Client({ token: process.env.QSTASH_TOKEN, baseUrl: process.env.QSTASH_URL });
  return qc;
}

export const SEND_PATH = "/api/server/run-send";
export const TICK_PATH = "/api/server/tick";
const TICK_SCHEDULE = "coverage-hourly-tick";

/** Ask QStash to call run-send at `sendAt`. Dedup on (account, draft, time) so re-syncs don't double-queue. */
export async function queueSendJob(req: Request, acct: string, draftId: string, sendAt: string) {
  const at = Math.max(Math.floor(new Date(sendAt).getTime() / 1000), Math.floor(Date.now() / 1000) + 5);
  await qstash().publishJSON({
    url: `${appUrl(req)}${SEND_PATH}`,
    body: { acct, draftId, sendAt },
    notBefore: at,
    retries: 3,
    deduplicationId: `${acct}-${draftId}-${at}`.replace(/[^A-Za-z0-9_-]/g, ""),
    label: "coverage-send",
  });
}

/** The hourly digest tick (created once; upserts by id). Skipped off Vercel, where QStash can't reach localhost. */
export async function ensureTick(req: Request) {
  if (!process.env.VERCEL) return;
  await qstash()
    .schedules.create({ scheduleId: TICK_SCHEDULE, destination: `${appUrl(req)}${TICK_PATH}`, cron: "0 * * * *", retries: 1 })
    .catch((e: unknown) => {
      throw new HttpError(502, `Couldn't set up the hourly reminder job: ${(e as Error).message}`);
    });
}

/** Only QStash may call the job routes. Returns the raw body. */
export async function verifyQstash(req: Request) {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) throw new HttpError(503, "QStash signing keys missing.");
  const body = await req.text();
  const ok = await new Receiver({ currentSigningKey: current, nextSigningKey: next })
    .verify({ signature: req.headers.get("upstash-signature") ?? "", body, clockTolerance: 30 })
    .catch(() => false);
  if (!ok) throw new HttpError(401, "Bad signature.");
  return body;
}
