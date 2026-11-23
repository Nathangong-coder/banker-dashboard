import { z } from "zod";
import { HttpError, errorResponse } from "@/lib/server/http";
import { SITE } from "@/lib/site";

/**
 * Public facts about a firm for its bank page (owner, 2026-11-22: "copy like something from their wiki"): Wikipedia's
 * summary of the best-matching article plus Wikidata's official website, headquarters, founding year and head count.
 * Stateless; only the firm's name is sent (to Wikipedia / Wikidata). Nothing is stored here: the browser shows it for
 * review and keeps it on the firm record with its source.
 */
const Body = z.object({ name: z.string().trim().min(2).max(120) });

const UA = { "User-Agent": `Coverage/1.0 (${SITE.url})`, Accept: "application/json" };
const get = async <T,>(url: string) => {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(502, `Wikipedia answered ${r.status}.`);
  return (await r.json()) as T;
};

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["the", "and", "&", "co", "company", "group", "inc", "llc", "partners", "securities", "capital"].includes(w));

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };

export async function POST(req: Request) {
  try {
    const { name } = Body.parse(await req.json());
    const search = await get<{ query?: { search?: { title: string; snippet: string }[] } }>(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(`${name} investment bank OR financial services company`)}`,
    );
    const want = words(name);
    // The first result whose title shares the firm's distinctive words (not "List of investment banks").
    const hit = (search.query?.search ?? []).find((s) => !/^list of/i.test(s.title) && want.every((w) => s.title.toLowerCase().includes(w)))
      ?? (search.query?.search ?? []).find((s) => !/^list of/i.test(s.title) && want.some((w) => s.title.toLowerCase().includes(w)));
    if (!hit) return Response.json({ found: false });
    const sum = await get<{ title: string; extract?: string; type?: string; wikibase_item?: string; content_urls?: { desktop?: { page?: string } } }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
    );
    if (sum.type === "disambiguation" || !sum.extract) return Response.json({ found: false });
    const out: { found: true; title: string; about: string; url?: string; website?: string; hq?: string; founded?: string; employees?: string } = {
      found: true,
      title: sum.title,
      about: sum.extract.slice(0, 1500),
      url: sum.content_urls?.desktop?.page,
    };
    if (sum.wikibase_item && /^Q\d+$/.test(sum.wikibase_item)) {
      try {
        const ent = await get<{ entities: Record<string, { claims?: Record<string, Claim[]> }> }>(`https://www.wikidata.org/wiki/Special:EntityData/${sum.wikibase_item}.json`);
        const claims = ent.entities[sum.wikibase_item]?.claims ?? {};
        const val = (p: string) => claims[p]?.[0]?.mainsnak?.datavalue?.value;
        const site = val("P856");
        if (typeof site === "string" && /^https?:\/\//.test(site)) out.website = site;
        const inception = val("P571") as { time?: string } | undefined;
        if (inception?.time) out.founded = inception.time.slice(1, 5).replace(/^0+/, "");
        const staff = claims.P1128?.at(-1)?.mainsnak?.datavalue?.value as { amount?: string } | undefined;
        if (staff?.amount) out.employees = Number(staff.amount).toLocaleString("en-US");
        const hq = val("P159") as { id?: string } | undefined;
        if (hq?.id && /^Q\d+$/.test(hq.id)) {
          const lab = await get<{ entities: Record<string, { labels?: { en?: { value: string } } }> }>(
            `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${hq.id}`,
          );
          out.hq = lab.entities[hq.id]?.labels?.en?.value;
        }
      } catch {
        // The summary alone is still useful.
      }
    }
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
