import "server-only";
import { HttpError } from "./http";
import { withFallback } from "./keys";

export type Organic = { title?: string; link?: string; snippet?: string };

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
