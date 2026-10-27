// Handshake job reader (opt-in, test build only; owner, 2026-10-26). Same rules as the LinkedIn reader: it runs in
// your own logged-in browser, at a person's pace, reads job postings only (never people or messages), and stops at
// any sign-in page. During Fill selected it clicks one button: "Apply externally" (to get to the bank's own form,
// usually Workday). It never uses Handshake's own Apply and never submits anything.
//
// Every function injected into a page is self-contained (chrome.scripting serializes it). Handshake's DOM changes,
// so the readers key on links to /jobs/<id> or /job-search/<id> and on visible text, not on class names.

/** Handshake sent you to sign in: the reader stops there. */
export const isHandshakeWall = (url) => /joinhandshake\.com\/(login|sso|sessions|auth|users\/sign_in|explore\/?$)/i.test(url ?? "");

export const isHandshake = (url) => /^https:\/\/([a-z0-9-]+\.)*joinhandshake\.com\//i.test(url ?? "");

/** The job page for an id (works for every school's Handshake). */
export const handshakeJobUrl = (id) => `https://app.joinhandshake.com/jobs/${id}`;

/** The search address with the page number (Handshake pages with ?page=N). */
export function handshakePage(url, page) {
  const u = new URL(url);
  u.searchParams.set("page", String(page));
  return u.toString();
}

/**
 * Injected into a Handshake job search tab: scrolls the results a little at a time and returns the jobs listed that
 * aren't in `known` ([{ id, title, company }]).
 */
export async function readHandshakeJobs(max, known) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const skip = new Set(known || []);
  const seen = new Map();
  const idOf = (href) => ((href || "").match(/\/(?:stu\/)?(?:jobs|job-search)\/(\d{3,15})/) || [])[1];
  for (let round = 0; round < 8 && seen.size < max; round++) {
    for (const a of document.querySelectorAll('a[href*="/jobs/"], a[href*="/job-search/"]')) {
      const id = idOf(a.getAttribute("href"));
      if (!id || seen.has(id) || skip.has(id)) continue;
      const card = a.closest("li, [role='listitem'], [data-hook*='card'], [class*='card' i]") || a;
      // Line breaks first (clean() would join title and company into one line).
      const lines = (card.innerText || "").split(/\n|\s{3,}/).map(clean).filter(Boolean);
      seen.set(id, { id, title: (lines[0] || clean(a.innerText)).slice(0, 200), company: (lines[1] || "").slice(0, 120) });
    }
    const list = document.querySelector("[data-hook*='search-results'], [class*='results' i], main") || document.scrollingElement;
    list.scrollBy({ top: 700, behavior: "smooth" });
    window.scrollBy({ top: 500, behavior: "smooth" });
    await sleep(1200 + Math.random() * 1200);
  }
  return [...seen.values()].slice(0, max);
}

/** Injected on a Handshake job page: title, company, location, description, the external apply link when it's a link. */
export function captureHandshakeJob() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const id = (location.pathname.match(/\/(?:stu\/)?(?:jobs|job-search)\/(\d{3,15})/) || [])[1] || "";
  const main = document.querySelector("main") || document.body;
  const title = clean((main.querySelector("h1") || {}).innerText);
  const employer = main.querySelector('a[href*="/e/"], a[href*="/employers/"]');
  const company = clean(employer && employer.innerText);
  // Location: a short line naming a city / Remote near the top.
  const lines = (main.innerText || "").split("\n").map(clean).filter(Boolean).slice(0, 60);
  const location_ = lines.find((l) => l.length < 80 && /(,\s*[A-Z]{2}\b|remote|united states|new york|san francisco|chicago|los angeles|boston|charlotte|houston|dallas)/i.test(l) && l !== title) || "";
  const posted = lines.find((l) => /^posted\b|ago$|apply by/i.test(l) && l.length < 80) || "";
  // The description: the biggest block of text on the page.
  let desc = "";
  for (const el of main.querySelectorAll("[class*='description' i], [data-hook*='description'], section, article, div")) {
    const t = clean(el.innerText);
    if (t.length > desc.length && t.length < 20000 && el.querySelectorAll("a[href*='/jobs/']").length < 5) desc = t;
  }
  let applyUrl = "";
  for (const a of main.querySelectorAll("a[href^='http']")) {
    try {
      const u = new URL(a.href);
      if (!/joinhandshake\.com$/i.test(u.hostname) && /apply/i.test(a.innerText + a.getAttribute("aria-label"))) {
        applyUrl = u.href;
        break;
      }
    } catch {
      // ignore
    }
  }
  if (!id || !title) return { error: "Open a Handshake job first." };
  return {
    site: "handshake",
    handshakeJobId: id,
    title: title.slice(0, 200),
    company: company.slice(0, 120),
    location: location_.slice(0, 120),
    posted: posted.slice(0, 60),
    description: desc.slice(0, 6000),
    applyUrl: applyUrl.slice(0, 1000),
  };
}

/**
 * Injected during Fill selected on a Handshake job page: finds "Apply externally". A link → its address (the worker
 * opens it in the same tab); a button → clicked (Handshake opens the bank's site in a new tab). Handshake's own
 * "Apply" (inside Handshake) is never clicked: `internal` tells the worker to leave it for you.
 */
export function clickApplyExternally() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
  };
  const all = [...document.querySelectorAll("a, button, [role='button']")].filter(shown);
  const ext = all.find((el) => /^apply (externally|on (the )?(company|employer)('s)? (site|website))/i.test(clean(el.innerText || el.getAttribute("aria-label"))));
  if (ext) {
    const href = ext.tagName === "A" ? ext.href : "";
    if (href && /^https:\/\//.test(href) && !/joinhandshake\.com\//i.test(href)) return { href };
    ext.click();
    return { clicked: true };
  }
  if (all.some((el) => /^apply$/i.test(clean(el.innerText)))) return { internal: true };
  return { none: true };
}
