import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { keysFrom, withFallback } from "@/lib/server/keys";
import { bulkMatch, searchPeople } from "@/lib/server/apollo";
import type { Prospect } from "@/lib/types";

export const maxDuration = 120;

const Body = z.object({
  bank: z.object({ name: z.string().min(1), domain: z.string().optional() }),
  queries: z.array(z.string()).max(10),
  perQuery: z.number().min(10).max(50).default(20),
  apollo: z
    .object({ enabled: z.boolean(), maxPeople: z.number().min(1).max(30).default(10) })
    .optional(),
});

type Organic = { title?: string; link?: string; snippet?: string };

function parseLinkedInTitle(title: string) {
  // "Jane Doe - Analyst - Goldman Sachs | LinkedIn"
  const clean = title.replace(/\s*[|·]\s*LinkedIn.*$/i, "").trim();
  const parts = clean.split(/\s+[-–—]\s+/);
  return { name: parts[0]?.trim() ?? "", headline: parts.slice(1).join(" - ") };
}

async function serperSearch(key: string, q: string, num: number): Promise<Organic[]> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num }),
  });
  if ([401, 402, 403, 429].includes(res.status))
    throw new HttpError(res.status, `Serper: ${res.status === 429 ? "rate limited or out of credits" : res.status === 402 ? "out of credits" : "invalid API key"}`);
  if (!res.ok) throw new HttpError(502, `Serper (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { organic?: Organic[] };
  return j.organic ?? [];
}

async function braveSearch(key: string, q: string, num: number): Promise<Organic[]> {
  const out: Organic[] = [];
  // Brave returns at most 20 per page; page with offset for more.
  for (let offset = 0; out.length < num && offset <= 2; offset++) {
    const u = new URL("https://api.search.brave.com/res/v1/web/search");
    u.searchParams.set("q", q);
    u.searchParams.set("count", String(Math.min(20, num)));
    u.searchParams.set("offset", String(offset));
    u.searchParams.set("extra_snippets", "true");
    const res = await fetch(u, { headers: { "X-Subscription-Token": key, Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text();
      // Brave reports a bad key as 422 SUBSCRIPTION_TOKEN_INVALID; treat it like 401 so the next key is tried.
      const badKey = [401, 403].includes(res.status) || /SUBSCRIPTION_TOKEN_INVALID/.test(body);
      if (badKey) throw new HttpError(401, "Brave: invalid API key");
      if ([402, 429].includes(res.status)) throw new HttpError(res.status, "Brave: rate limited or out of credits");
      const detail = body.match(/"detail":"([^"]+)"/)?.[1] ?? body.slice(0, 200);
      throw new HttpError(502, `Brave (${res.status}): ${detail}`);
    }
    const j = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string; extra_snippets?: string[] }[] }; query?: { more_results_available?: boolean } };
    const page = j.web?.results ?? [];
    out.push(...page.map((r) => ({ title: r.title, link: r.url, snippet: [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(" … ").replace(/<\/?strong>/g, "") })));
    if (!j.query?.more_results_available || page.length === 0) break;
    await new Promise((r) => setTimeout(r, 1100)); // free plan: 1 request/second
  }
  return out;
}

/** Serper first; if it has no keys or every Serper key fails, fall back to Brave. */
async function webSearch(serperKeys: string[], braveKeys: string[], q: string, num: number, warnings: string[]) {
  if (serperKeys.length) {
    try {
      return await withFallback(serperKeys, "Serper", (k) => serperSearch(k, q, num));
    } catch (e) {
      if (!braveKeys.length) throw e;
      const msg = `${(e as Error).message}. Using Brave instead.`;
      if (!warnings.includes(msg)) warnings.push(msg);
    }
  }
  return withFallback(braveKeys, "Brave", (k) => braveSearch(k, q, num));
}

export async function POST(req: Request) {
  try {
    const serperKeys = keysFrom(req, "serper");
    const braveKeys = keysFrom(req, "brave");
    const apolloKeys = keysFrom(req, "apollo");
    const { bank, queries, perQuery, apollo } = Body.parse(await req.json());
    if (!serperKeys.length && !braveKeys.length && !(apollo?.enabled && apolloKeys.length))
      throw new HttpError(400, "Add a Serper or Brave Search key, or enable Apollo search with an Apollo key.");

    const out = new Map<string, Prospect>();
    const warnings: string[] = [];

    if (serperKeys.length || braveKeys.length) {
      // Sequential: Brave's free plan allows 1 request/second, and errors are clearer per query.
      const lists: Organic[][] = [];
      for (const q of queries) {
        const query = q.replaceAll("{bank}", bank.name);
        try {
          lists.push(await webSearch(serperKeys, braveKeys, query, perQuery, warnings));
        } catch (e) {
          if (lists.length === 0 && q === queries[queries.length - 1]) throw e;
          warnings.push(`A query failed: ${(e as Error).message}`);
        }
      }
      for (const r of lists.flat()) {
        const link = r.link ?? "";
        const m = link.match(/linkedin\.com\/in\/([^/?#]+)/i);
        if (!m) continue;
        const slug = decodeURIComponent(m[1]).toLowerCase();
        if (out.has(slug)) continue;
        const { name, headline } = parseLinkedInTitle(r.title ?? "");
        if (!name) continue;
        out.set(slug, {
          id: `g_${slug}`,
          name,
          bank: bank.name,
          title: headline,
          snippet: r.snippet ?? "",
          linkedin: `https://www.linkedin.com/in/${slug}/`,
          source: "google",
        });
      }
    }

    if (apollo?.enabled && apolloKeys.length) {
      try {
        const people = await withFallback(apolloKeys, "Apollo", (k) =>
          searchPeople(k, {
          domain: bank.domain,
          keywords: bank.domain ? "investment banking" : `${bank.name} investment banking`,
          titles: ["investment banking analyst", "investment banking associate", "vice president investment banking"],
          locations: ["California, US", "New York, US"],
          perPage: Math.min(apollo.maxPeople, 25),
          }),
        );
        const ids = people.slice(0, apollo.maxPeople).map((p) => p.id);
        for (let i = 0; i < ids.length; i += 10) {
          const batch = ids.slice(i, i + 10).map((id) => ({ id }));
          const matches = await withFallback(apolloKeys, "Apollo", (k) => bulkMatch(k, batch, false));
          for (const p of matches) {
            if (!p) continue;
            const slug = p.linkedin_url?.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? `apollo_${p.id}`;
            if (out.has(slug)) continue;
            const history = (p.employment_history ?? [])
              .slice(0, 4)
              .map((e) => `${e.title ?? ""} @ ${e.organization_name ?? ""}`)
              .join("; ");
            out.set(slug, {
              id: `a_${p.id}`,
              name: p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
              firstName: p.first_name,
              lastName: p.last_name,
              bank: bank.name,
              title: p.title ?? "",
              snippet: [p.headline, [p.city, p.state].filter(Boolean).join(", "), history, p.departments?.join(", ")]
                .filter(Boolean)
                .join(" · "),
              linkedin: p.linkedin_url ?? "",
              source: "apollo",
            });
          }
        }
      } catch (e) {
        warnings.push(e instanceof Error ? e.message : "Apollo search failed");
      }
    }

    return Response.json({ prospects: [...out.values()], warnings });
  } catch (e) {
    return errorResponse(e);
  }
}
