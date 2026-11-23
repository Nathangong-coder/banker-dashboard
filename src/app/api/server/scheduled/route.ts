import { HttpError, errorResponse } from "@/lib/server/http";
import { authAccount } from "@/lib/server/accounts";
import { accessToken, gmail } from "@/lib/server/google";
import { parseAddrs } from "@/lib/replyTracking";

export const maxDuration = 30;

type Meta = { id: string; threadId: string; internalDate: string; labelIds?: string[]; payload?: { headers?: { name: string; value: string }[] } };

/**
 * Emails waiting in Gmail's Schedule send (owner, 2026-11-23 audit: 16 were scheduled for Nov 24, the dashboard knew
 * 5, so people with a follow-up already queued showed as due / gone quiet). Recipients (To / Cc), when, subject and the
 * label names on each (to flag one labelled "DO NOT SEND" / "HOLD" that's still scheduled). Needs the server's
 * read-only Gmail access; nothing is stored.
 */
export async function POST(req: Request) {
  try {
    const a = await authAccount(req);
    if (!a.google?.read) return Response.json({ read: false, items: [] });
    const access = await accessToken(a);
    const list = await gmail<{ messages?: { id: string }[] }>(access, `/messages?q=${encodeURIComponent("in:scheduled")}&maxResults=100`);
    const labels = await gmail<{ labels?: { id: string; name: string; type: string }[] }>(access, "/labels").catch(() => ({ labels: [] }));
    const names = new Map((labels.labels ?? []).filter((l) => l.type === "user").map((l) => [l.id, l.name]));
    const items: { id: string; threadId: string; at: string; subject: string; to: string[]; labels: string[] }[] = [];
    const ids = (list.messages ?? []).map((m) => m.id);
    for (let i = 0; i < ids.length; i += 8) {
      const batch = await Promise.all(
        ids.slice(i, i + 8).map((id) =>
          gmail<Meta>(access, `/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`).catch((e) => {
            if (e instanceof HttpError && e.status === 404) return null;
            throw e;
          }),
        ),
      );
      for (const m of batch) {
        if (!m) continue;
        const h = (n: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value;
        items.push({
          id: m.id,
          threadId: m.threadId,
          at: new Date(Number(m.internalDate)).toISOString(),
          subject: (h("subject") ?? "").slice(0, 200),
          to: [...parseAddrs(h("to")), ...parseAddrs(h("cc"))].map((r) => r.email.toLowerCase()).slice(0, 10),
          labels: (m.labelIds ?? []).map((l) => names.get(l)).filter((x): x is string => !!x).slice(0, 20),
        });
      }
    }
    return Response.json({ read: true, items });
  } catch (e) {
    return errorResponse(e);
  }
}
