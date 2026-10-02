import { z } from "zod";
import { bulkMatch, usableEmail, type ApolloPerson, type MatchDetail } from "@/lib/server/apollo";
import { HttpError, errorResponse } from "@/lib/server/http";
import { keysFrom, withFallback } from "@/lib/server/keys";
import { canonBank } from "@/lib/banks";
import { detectRegion } from "@/lib/region";

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
        /** Their office as the sheet / LinkedIn says (for the city cross-check). */
        region: z.string().optional(),
        location: z.string().optional(),
      }),
    )
    .min(1)
    .max(10),
});
type In = z.infer<typeof Body>["contacts"][number];

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

const slug = (u?: string | null) => u?.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]?.toLowerCase();
const plain = (s?: string | null) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
const sameFirm = (a: string, b: string) => {
  const x = canonBank(a);
  const y = canonBank(b);
  return x === y || x.includes(y) || y.includes(x);
};

/**
 * Is this match really our person? Apollo has matched the wrong person before (a London MD for an SF analyst), so the
 * match must agree with what we know from LinkedIn / the sheet: LinkedIn URL, last name, firm, and city.
 */
function mismatch(c: In, m: { linkedin?: string | null; lastName?: string | null; firm?: string | null; where?: string; country?: string | null }): string | undefined {
  const a = slug(c.linkedin);
  const b = slug(m.linkedin);
  if (a && b && a !== b) return `matched a different LinkedIn profile (/in/${b})`;
  // Apollo search hides last names ("S."), so only compare full ones.
  if (m.lastName && m.lastName.length > 2 && c.lastName && plain(m.lastName) !== plain(c.lastName)) return `matched ${m.lastName}, not ${c.lastName}`;
  if (m.firm && c.bank && !sameFirm(m.firm, c.bank)) return `match works at ${m.firm}, not ${c.bank}`;
  const known = c.region && c.region !== "Other" ? c.region : undefined;
  if (known && m.country && !/^(us|usa|united states)/i.test(m.country)) return `match is in ${[m.where, m.country].filter(Boolean).join(", ")}, not ${known}`;
  const theirs = m.where ? detectRegion(m.where) : "Other";
  if (known && theirs !== "Other" && theirs !== known) return `match is in ${m.where}, but ${c.name} is in ${known}`;
  return undefined;
}

async function hunterFind(key: string, c: In, domain?: string) {
  const q = new URLSearchParams({ first_name: c.firstName, last_name: c.lastName, api_key: key });
  if (domain) q.set("domain", domain);
  else q.set("company", c.bank);
  const res = await fetch(`https://api.hunter.io/v2/email-finder?${q}`);
  if ([401, 402, 403, 429].includes(res.status)) throw new HttpError(res.status, `Hunter: ${(await res.text()).slice(0, 160)}`);
  if (!res.ok) return null;
  const j = (await res.json()) as {
    data?: { email?: string; score?: number; linkedin_url?: string | null; company?: string | null; last_name?: string | null; verification?: { status?: string | null } };
  };
  return j.data?.email ? j.data : null;
}

export async function POST(req: Request) {
  try {
    const apolloKeys = keysFrom(req, "apollo");
    const hunterKeys = keysFrom(req, "hunter");
    if (!apolloKeys.length && !hunterKeys.length) throw new HttpError(400, "Add an Apollo (or Hunter) API key in Settings.");
    const { contacts, revealPersonal } = Body.parse(await req.json());

    const results: EnrichResult[] = contacts.map((c) => ({ id: c.id, email: null, source: null }));
    const notes: string[][] = contacts.map(() => []);

    // Only verified addresses are kept: Apollo "verified", then Hunter "valid". Guessed / extrapolated ones don't count.
    if (apolloKeys.length) {
      const details: MatchDetail[] = contacts.map((c) => ({
        first_name: c.firstName || undefined,
        last_name: c.lastName || undefined,
        name: c.name,
        organization_name: c.bank,
        domain: c.domain,
        linkedin_url: c.linkedin?.match(/linkedin\.com\/in\//) ? c.linkedin.split("?")[0] : undefined,
      }));
      const matches = await withFallback(apolloKeys, "Apollo", (k) => bulkMatch(k, details, revealPersonal));
      matches.forEach((p: ApolloPerson | null, i) => {
        if (!p) return;
        const r = results[i];
        const c = contacts[i];
        const where = [p.city, p.state].filter(Boolean).join(", ");
        const wrong = mismatch(c, { linkedin: p.linkedin_url, lastName: p.last_name, firm: p.organization?.name, where, country: p.country });
        if (wrong) {
          notes[i].push(`Apollo ${wrong}: discarded`);
          return;
        }
        r.linkedin = p.linkedin_url ?? undefined;
        r.title = p.title ?? undefined;
        r.headline = p.headline ?? undefined;
        r.location = where || undefined;
        r.domain = p.organization?.primary_domain;
        const email = usableEmail(p, revealPersonal);
        if (email && p.email_status === "verified") {
          r.email = email;
          r.source = "apollo";
          r.emailStatus = "verified";
        } else notes[i].push(email ? `Apollo's address is ${p.email_status || "unverified"}, not verified: not used` : "Matched in Apollo but no email available");
      });
    }

    if (hunterKeys.length) {
      await Promise.all(
        results.map(async (r, i) => {
          if (r.email) return;
          const c = contacts[i];
          if (!c.firstName || !c.lastName) return;
          const found = await withFallback(hunterKeys, "Hunter", (k) => hunterFind(k, c, r.domain ?? c.domain));
          if (!found) return;
          const wrong = mismatch(c, { linkedin: found.linkedin_url, lastName: found.last_name, firm: found.company });
          if (wrong) return void notes[i].push(`Hunter ${wrong}: discarded`);
          const status = found.verification?.status ?? "";
          if (status !== "valid") return void notes[i].push(`Hunter's address is ${status || "unverified"} (score ${found.score ?? "?"}), not verified: not used`);
          r.email = found.email!;
          r.source = "hunter";
          r.emailStatus = `valid (hunter score ${found.score ?? "?"})`;
        }),
      );
    }

    results.forEach((r, i) => {
      if (!r.email) r.note = notes[i].join(". ") || "No match found";
    });
    return Response.json({ results });
  } catch (e) {
    return errorResponse(e);
  }
}
