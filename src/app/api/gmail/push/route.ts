import { z } from "zod";
import { loadAccount } from "@/lib/server/accounts";
import { trackAccount } from "@/lib/server/gmailTrack";
import { accountForMailbox, pushSecretOk } from "@/lib/server/gmailPush";

export const maxDuration = 30;

const Push = z.object({ message: z.object({ data: z.string().max(10_000) }) });
const Note = z.object({ emailAddress: z.string().max(320), historyId: z.union([z.string(), z.number()]) });

/**
 * Google Pub/Sub push for Gmail changes (lib/server/gmailPush.ts): `{message: {data: base64({emailAddress, historyId})}}`.
 * Only the secret in the subscription URL is trusted; the body just says "this mailbox changed", and the actual read
 * goes through the account's own Gmail connection. Always 204: Pub/Sub retries anything else, and a retry storm
 * would cost more than a missed note (the hourly tick reads the history anyway).
 */
export async function POST(req: Request) {
  if (!pushSecretOk(new URL(req.url).searchParams.get("k"))) return new Response(null, { status: 403 });
  try {
    const { message } = Push.parse(await req.json());
    const note = Note.parse(JSON.parse(Buffer.from(message.data, "base64").toString("utf8")));
    const id = await accountForMailbox(note.emailAddress);
    const a = id ? await loadAccount(id) : null;
    if (a?.google?.read && a.google.email.toLowerCase() === note.emailAddress.toLowerCase()) {
      // A burst of notes (a long thread arriving) reads once; the rest are covered by the next note or the tick.
      await trackAccount(a, 20_000, { minGapMs: 20_000 });
    }
  } catch (e) {
    console.warn(`[gmail-push] ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
  return new Response(null, { status: 204 });
}
