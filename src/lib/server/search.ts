import "server-only";
import { HttpError } from "./http";
import { withFallback } from "./keys";

export type Organic = { title?: string; link?: string; snippet?: string };

async function serperPage(key: string, q: string, num: number, page?: number) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify(page && page > 1 ? { q, num, page } : { q, num }),
  });
  if ([401, 402, 403, 429].includes(res.status))
    throw new HttpError(res.status, `Serper: ${res.status === 429 ? "rate limited or out of credits" : res.status === 402 ? "out of credits" : "invalid API key"}`);
  if (!res.ok) return { error: `Serper (${res.status}): ${(await res.text()).slice(0, 200)}`, status: res.status };
  const j = (await res.json()) as { organic?: Organic[] };
  return { organic: j.organic ?? [] };
}

/**
 * Serper's free plan only allows 10 results per search: asking for num=20 comes back as
 * 404 "not available for free accounts". Free keys get 10 a page, with more pages up to `num` (1 credit each).
 */
const tenOnly = new Set<string>();
const FREE_PLAN = /free (account|plan|tier)|not available/i;

async function serperSearch(key: string, q: string, num: number): Promise<Organic[]> {
  if (num > 10 && !tenOnly.has(key)) {
    const r = await serperPage(key, q, num);
    if (r.organic) return r.organic;
    if (!(FREE_PLAN.test(r.error) || r.status === 404 || r.status === 400)) throw new HttpError(502, r.error);
    tenOnly.add(key);
  }
  const out: Organic[] = [];
  for (let page = 1; out.length < num && page <= Math.ceil(num / 10); page++) {
    const r = await serperPage(key, q, 10, page);
    if (!r.organic) {
      // A later page failing still leaves the first page's results.
      if (page > 1) break;
      throw new HttpError(502, FREE_PLAN.test(r.error) ? `${r.error}. Serper's free plan may not cover this search.` : r.error);
    }
    out.push(...r.organic);
    if (r.organic.length < 10) break;
  }
  return out.slice(0, num);
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

/** Web search: Serper first; if it has no keys or every Serper key fails, fall back to Brave. */
export async function webSearch(serperKeys: string[], braveKeys: string[], q: string, num: number, warnings: string[]) {
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
