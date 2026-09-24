import { z } from "zod";
import { bulkMatch, usableEmail, type MatchDetail } from "@/lib/server/apollo";
import { HttpError, errorResponse } from "@/lib/server/ai";

const Body = z.object({
  revealPersonal: z.boolean().default(false),
  contacts: z
    .array(
      z.object({
        id: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        name: z.string(),
        bank: z.string(),
        domain: z.string().optional(),
        linkedin: z.string().optional(),
      }),
    )
    .min(1)
    .max(10),
});

export interface EnrichResult {
  id: string;
  email: string | null;
  source: "apollo" | "hunter" | null;
  emailStatus?: string;
  linkedin?: string;
  title?: string;
  location?: string;
  headline?: string;
  domain?: string;
  note?: string;
}

async function hunterFind(key: string, c: z.infer<typeof Body>["contacts"][number], domain?: string) {
  const q = new URLSearchParams({ first_name: c.firstName, last_name: c.lastName, api_key: key });
  if (domain) q.set("domain", domain);
  else q.set("company", c.bank);
  const res = await fetch(`https://api.hunter.io/v2/email-finder?${q}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: { email?: string; score?: number } };
  return j.data?.email ? { email: j.data.email, score: j.data.score } : null;
}

export async function POST(req: Request) {
  try {
    const apolloKey = req.headers.get("x-apollo-key")?.trim();
    const hunterKey = req.headers.get("x-hunter-key")?.trim();
    if (!apolloKey && !hunterKey) throw new HttpError(400, "Add an Apollo (or Hunter) API key in Settings.");
    const { contacts, revealPersonal } = Body.parse(await req.json());

    const results: EnrichResult[] = contacts.map((c) => ({ id: c.id, email: null, source: null }));

    if (apolloKey) {
      const details: MatchDetail[] = contacts.map((c) => ({
        first_name: c.firstName || undefined,
        last_name: c.lastName || undefined,
        name: c.name,
        organization_name: c.bank,
        domain: c.domain,
        linkedin_url: c.linkedin?.match(/linkedin\.com\/in\//) ? c.linkedin.split("?")[0] : undefined,
      }));
      const matches = await bulkMatch(apolloKey, details, revealPersonal);
      matches.forEach((p, i) => {
        if (!p) return;
        const r = results[i];
        const email = usableEmail(p, revealPersonal);
        r.email = email;
        r.source = email ? "apollo" : null;
        r.emailStatus = p.email_status ?? undefined;
        r.linkedin = p.linkedin_url ?? undefined;
        r.title = p.title ?? undefined;
        r.headline = p.headline ?? undefined;
        r.location = [p.city, p.state].filter(Boolean).join(", ") || undefined;
        r.domain = p.organization?.primary_domain;
        if (!email) r.note = "Matched in Apollo but no email available";
      });
    }

    if (hunterKey) {
      await Promise.all(
        results.map(async (r, i) => {
          if (r.email) return;
          const c = contacts[i];
          if (!c.firstName || !c.lastName) return;
          const found = await hunterFind(hunterKey, c, r.domain ?? c.domain);
          if (found) {
            r.email = found.email;
            r.source = "hunter";
            r.emailStatus = found.score ? `hunter score ${found.score}` : "hunter";
            r.note = undefined;
          }
        }),
      );
    }

    for (const r of results) if (!r.email && !r.note) r.note = "No match found";
    return Response.json({ results });
  } catch (e) {
    return errorResponse(e);
  }
}
