import "server-only";
import { HttpError } from "./http";

const BASE = "https://api.apollo.io/api/v1";

export interface ApolloPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string | null;
  email_status?: string | null;
  personal_emails?: string[];
  linkedin_url?: string | null;
  title?: string | null;
  headline?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  departments?: string[];
  organization?: { name?: string; primary_domain?: string } | null;
  employment_history?: { organization_name?: string; title?: string; current?: boolean }[];
}

async function apollo<T>(key: string, path: string, init: RequestInit & { query?: URLSearchParams }) {
  const url = `${BASE}${path}${init.query ? `?${init.query}` : ""}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": key },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = JSON.parse(text).error ?? JSON.parse(text).message ?? msg;
    } catch {}
    throw new HttpError([401, 402, 403, 422, 429].includes(res.status) ? res.status : 502, `Apollo: ${msg}`);
  }
  return JSON.parse(text) as T;
}

/** Real email or null (Apollo returns placeholders like email_not_unlocked@domain.com). */
export function usableEmail(p: ApolloPerson | null | undefined, allowPersonal: boolean): string | null {
  if (!p) return null;
  const e = p.email ?? "";
  if (e && !/not_unlocked|@domain\.com$/i.test(e)) return e;
  if (allowPersonal && p.personal_emails?.length) return p.personal_emails[0];
  return null;
}

export type MatchDetail = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  organization_name?: string;
  domain?: string;
  linkedin_url?: string;
};

export async function bulkMatch(key: string, details: MatchDetail[], revealPersonal: boolean) {
  const query = new URLSearchParams({ reveal_personal_emails: String(revealPersonal) });
  const data = await apollo<{ matches: (ApolloPerson | null)[] }>(key, "/people/bulk_match", {
    method: "POST",
    query,
    body: JSON.stringify({ details }),
  });
  return data.matches ?? [];
}

export async function searchPeople(
  key: string,
  opts: { domain?: string; keywords?: string; titles: string[]; locations: string[]; perPage: number },
) {
  const q = new URLSearchParams();
  opts.titles.forEach((t) => q.append("person_titles[]", t));
  opts.locations.forEach((l) => q.append("person_locations[]", l));
  if (opts.domain) q.append("q_organization_domains_list[]", opts.domain);
  if (opts.keywords) q.set("q_keywords", opts.keywords);
  q.set("per_page", String(opts.perPage));
  q.set("page", "1");
  const data = await apollo<{ people: { id: string; first_name?: string; title?: string }[] }>(
    key,
    "/mixed_people/api_search",
    { method: "POST", query: q },
  );
  return data.people ?? [];
}
