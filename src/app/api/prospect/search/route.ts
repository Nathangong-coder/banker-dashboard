import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/ai";
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
  if (res.status === 401 || res.status === 403) throw new HttpError(401, "Serper: invalid API key");
  if (!res.ok) throw new HttpError(502, `Serper: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { organic?: Organic[] };
  return j.organic ?? [];
}

export async function POST(req: Request) {
  try {
    const serperKey = req.headers.get("x-serper-key")?.trim();
    const apolloKey = req.headers.get("x-apollo-key")?.trim();
    const { bank, queries, perQuery, apollo } = Body.parse(await req.json());
    if (!serperKey && !(apollo?.enabled && apolloKey))
      throw new HttpError(400, "Add a Serper (Google search) key, or enable Apollo search with an Apollo key.");

    const out = new Map<string, Prospect>();
    const warnings: string[] = [];

    if (serperKey) {
      const lists = await Promise.all(
        queries.map((q) => serperSearch(serperKey, q.replaceAll("{bank}", bank.name), perQuery)),
      );
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

    if (apollo?.enabled && apolloKey) {
      try {
        const people = await searchPeople(apolloKey, {
          domain: bank.domain,
          keywords: bank.domain ? "investment banking" : `${bank.name} investment banking`,
          titles: ["investment banking analyst", "investment banking associate", "vice president investment banking"],
          locations: ["California, US", "New York, US"],
          perPage: Math.min(apollo.maxPeople, 25),
        });
        const ids = people.slice(0, apollo.maxPeople).map((p) => p.id);
        for (let i = 0; i < ids.length; i += 10) {
          const matches = await bulkMatch(
            apolloKey,
            ids.slice(i, i + 10).map((id) => ({ id })),
            false,
          );
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
