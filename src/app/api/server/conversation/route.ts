import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { authAccount } from "@/lib/server/accounts";
import { accessToken, gmail } from "@/lib/server/google";
import { META, plainText, toMsg, type RawMsg } from "@/lib/server/gmailTrack";
import { personQuery, stripQuotedText } from "@/lib/replyTracking";
import { buildLedger } from "@/lib/mailLedger";

export const maxDuration = 60;

const Body = z.object({
  people: z
    .array(
      z.object({
        contactId: z.string().max(200),
        name: z.string().min(1).max(160),
        emails: z.array(z.string().email().max(320)).min(1).max(4),
      }),
    )
    .min(1)
    .max(12),
});

const BUDGET_MS = 40_000;

/**
 * One person's whole email conversation (owner, 2026-11-22): every thread to or from their addresses in the last year
 * (newest 20 threads), read with the server's read-only Gmail access → lib/mailLedger.ts. Returns the messages
 * (dates, direction, subject, snippet) and the text of their newest email and yours. Nothing is stored here; the
 * dashboard keeps it on the contact. No read access = `read: false`.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    const b = Body.parse(await req.json());
    if (!a.google?.read) return Response.json({ read: false, people: [] });
    const access = await accessToken(a);
    const me = [a.google.email];
    const started = Date.now();
    const out: unknown[] = [];
    const left: string[] = [];
    const year = new Date(Date.now() - 365 * 86_400_000).toISOString();
    let i = 0;
    const worker = async () => {
      while (i < b.people.length) {
        const p = b.people[i++];
        if (Date.now() - started > BUDGET_MS) {
          left.push(p.contactId);
          continue;
        }
        try {
          const list = await gmail<{ threads?: { id: string }[] }>(access, `/threads?q=${encodeURIComponent(personQuery(p.emails, year))}&maxResults=20`);
          const threads = await Promise.all((list.threads ?? []).map((t) => gmail<{ messages?: RawMsg[] }>(access, `/threads/${t.id}?format=metadata&${META}`)));
          const msgs = threads.flatMap((t) => (t.messages ?? []).filter((m) => !m.labelIds?.includes("DRAFT") && !m.labelIds?.includes("SCHEDULED")).map(toMsg));
          const L = buildLedger({ contactId: p.contactId, name: p.name, emails: p.emails.map((e) => e.toLowerCase()) }, msgs, me);
          const text = async (id?: string) => {
            if (!id) return undefined;
            const full = await gmail<RawMsg>(access, `/messages/${id}?format=full`);
            return stripQuotedText(plainText(full.payload)).slice(0, 1500);
          };
          const [lastIn, lastOut] = await Promise.all([text(L.lastInId), text(L.lastOutId)]);
          out.push({ contactId: p.contactId, messages: L.messages.slice(-12), aliases: L.aliases, namesOnFile: L.namesOnFile, lastIn: L.lastInId ? { id: L.lastInId, text: lastIn } : undefined, lastOut: L.lastOutId ? { id: L.lastOutId, text: lastOut } : undefined });
        } catch (e) {
          // Rate limit / a hiccup: hand this person back for the next call. A revoked token fails the whole call.
          if (e instanceof HttpError && e.status === 401) throw e;
          left.push(p.contactId);
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    return Response.json({ read: true, people: out, left });
  } catch (e) {
    return errorResponse(e);
  }
}
