/**
 * "Send to Coverage" bookmarklet. It reads ONLY the LinkedIn page the user is already looking at (a People
 * search results page or a single profile) and hands the visible text to the dashboard via the URL hash.
 * It makes no requests to LinkedIn and runs only when clicked. That's deliberate: automated, logged-in
 * crawling violates LinkedIn's User Agreement (§8.2) and gets accounts restricted.
 */
import { canonBank } from "./banks";
import type { Prospect } from "./types";

/** Source of the bookmarklet (runs on linkedin.com). Kept dependency-free and comment-free. */
function captureScript(origin: string) {
  return `(() => {
  const O = ${JSON.stringify(origin)};
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const noise = /^(connect|message|follow|following|pending|save|more|view .*profile|status is .*|• ?(1st|2nd|3rd\\+?)|(1st|2nd|3rd\\+?)( degree connection)?|.*mutual connections?|.*followers?|open to work|provides services|premium.*|linkedin member)$/i;
  const slugOf = (h) => { const m = (h || "").match(/\\/in\\/([^/?#]+)/i); return m ? decodeURIComponent(m[1]).toLowerCase() : ""; };
  const out = []; const seen = new Set();
  const main = document.querySelector("main") || document.body;
  if (/^\\/in\\/[^/]+\\/?$/.test(location.pathname)) {
    const slug = slugOf(location.pathname);
    const lines = main.innerText.split("\\n").map(clean).filter((l) => l && !noise.test(l));
    const name = clean((main.querySelector("h1") || {}).innerText) || lines[0];
    out.push({ slug, name, text: lines.join(" · ").slice(0, 6000) });
  } else {
    for (const a of main.querySelectorAll('a[href*="/in/"]')) {
      const slug = slugOf(a.getAttribute("href"));
      if (!slug || seen.has(slug)) continue;
      const card = a.closest("li") || a.closest("[data-chameleon-result-urn]") || a.closest("div[class*=entity]");
      if (!card) continue;
      const lines = card.innerText.split("\\n").map(clean).filter((l) => l && !noise.test(l));
      let name = clean((a.querySelector('span[aria-hidden="true"]') || a).innerText).replace(/view .*profile/i, "").trim();
      if (!name || name.length > 80) name = lines[0] || "";
      if (!name || /^linkedin member$/i.test(name)) continue;
      seen.add(slug);
      out.push({ slug, name, text: lines.filter((l) => l !== name).join(" · ").slice(0, 1500) });
    }
  }
  if (!out.length) { alert("No LinkedIn profiles found on this page. Open a People search (or a profile) first, scroll so the results load, then click again."); return; }
  const payload = encodeURIComponent(JSON.stringify({ v: 1, page: location.href.slice(0, 300), people: out.slice(0, 60) }));
  window.open(O + "/find#li=" + payload, "_blank");
})();`;
}

export function bookmarkletHref(origin: string) {
  return "javascript:" + encodeURIComponent(captureScript(origin));
}

/** LinkedIn People search for a bank, pre-filled with the user's usual keywords. */
export function linkedinSearchUrl(bank: string, extra = "investment banking") {
  const u = new URL("https://www.linkedin.com/search/results/people/");
  const short = bank.replace(/\s*(&\s*)?(co\.?|company|partners|group|advisors|inc\.?|llc)$/i, "").trim() || bank;
  u.searchParams.set("keywords", `"${short}" ${extra}`.trim());
  u.searchParams.set("origin", "GLOBAL_SEARCH_HEADER");
  return u.toString();
}

interface Captured {
  slug: string;
  name: string;
  text: string;
}

const normText = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")} `;

/** Which known bank does this text mention first? (Headline/current role come first in the captured text.) */
export function guessBank(text: string, knownBanks: string[]): string | undefined {
  const t = normText(text);
  let best: { name: string; at: number } | undefined;
  for (const name of knownBanks) {
    for (const key of new Set([canonBank(name), normText(name).trim()])) {
      if (key.length < 3) continue;
      const at = t.indexOf(` ${key} `);
      if (at >= 0 && (!best || at < best.at)) best = { name, at };
    }
  }
  return best?.name;
}

/** Parse the `#li=` payload into prospects. Untrusted input: validate shapes and cap sizes. */
export function parseCapture(hash: string, knownBanks: string[], fallbackBank?: string): Prospect[] {
  const raw = hash.replace(/^#?li=/, "");
  let data: { people?: Captured[] };
  try {
    data = JSON.parse(decodeURIComponent(raw));
  } catch {
    return [];
  }
  const people = Array.isArray(data.people) ? data.people.slice(0, 60) : [];
  const out: Prospect[] = [];
  for (const p of people) {
    if (!p || typeof p.slug !== "string" || typeof p.name !== "string") continue;
    const slug = p.slug.toLowerCase().replace(/[^a-z0-9%_-]/g, "").slice(0, 100);
    const name = p.name.replace(/[,|].*$/, "").replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 80);
    const text = typeof p.text === "string" ? p.text.slice(0, 6000) : "";
    if (!slug || name.length < 2) continue;
    const parts = text.split(" · ");
    out.push({
      id: `li_${slug}`,
      name,
      bank: guessBank(text, knownBanks) ?? fallbackBank ?? "Unknown",
      title: parts[0] ?? "",
      snippet: text,
      linkedin: `https://www.linkedin.com/in/${slug}/`,
      source: "linkedin",
    });
  }
  return out;
}
