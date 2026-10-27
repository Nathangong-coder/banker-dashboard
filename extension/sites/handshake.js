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
 * Injected into a Handshake job search tab: returns the jobs listed that aren't in `known` ([{ id, title, company,
 * location }]). Handshake's 2026 cards are `[data-hook="job-result-card | <id>"]` with lines company / title / type /
 * location (checked on the live site 2026-10-26); job links (/job-search/<id>, /jobs/<id>) are the fallback.
 */
export async function readHandshakeJobs(max, known) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const skip = new Set(known || []);
  const seen = new Map();
  const CARD = '[data-hook^="job-result-card |"]';
  const box = [...document.querySelectorAll("div, ul, section, main")].find((e) => e.scrollHeight > e.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.querySelector(CARD));
  for (let round = 0; round < 6 && seen.size < max; round++) {
    for (const card of document.querySelectorAll(CARD)) {
      const id = (card.getAttribute("data-hook").split("|")[1] || "").trim();
      if (!/^\d{3,15}$/.test(id) || seen.has(id) || skip.has(id)) continue;
      const lines = (card.innerText || "").split("\n").map(clean).filter((l) => l && l !== "∙");
      seen.set(id, { id, company: (lines[0] || "").slice(0, 120), title: (lines[1] || "").slice(0, 200), location: (lines.find((l, k) => k > 1 && /,\s*[A-Z]{2}\b|remote|united states/i.test(l)) || "").slice(0, 120) });
    }
    if (!document.querySelector(CARD))
      for (const a of document.querySelectorAll('a[href*="/jobs/"], a[href*="/job-search/"]')) {
        const id = ((a.getAttribute("href") || "").match(/\/(?:stu\/)?(?:jobs|job-search)\/(\d{3,15})/) || [])[1];
        if (!id || seen.has(id) || skip.has(id)) continue;
        // The link is an empty overlay; its aria-label reads "<company> <title> $pay · Internship · … <location> <age>".
        const label = clean(a.getAttribute("aria-label")).replace(/^Selected,\s*/, "");
        seen.set(id, { id, company: "", title: label.split(/\s+\$|\s+·\s+/)[0].slice(0, 200), location: "" });
      }
    (box || document.scrollingElement).scrollBy({ top: 700, behavior: "smooth" });
    await sleep(1000 + Math.random() * 1000);
  }
  return [...seen.values()].slice(0, max);
}

/**
 * Injected on a Handshake job page: firm (the page's first line), title (h1), location, posted / deadline, the full
 * description (its "More" buttons are pressed first; they only expand text), and the apply link when it's a link.
 */
export async function captureHandshakeJob() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const id = (location.pathname.match(/\/(?:stu\/)?(?:jobs|job-search)\/(\d{3,15})/) || [])[1] || "";
  const main = document.querySelector("main") || document.body;
  for (const b of main.querySelectorAll("button")) if (/^(more|show more|see more)$/i.test(clean(b.innerText))) b.click();
  await new Promise((r) => setTimeout(r, 600));
  const title = clean((main.querySelector("h1") || {}).innerText);
  const lines = (main.innerText || "").split("\n").map(clean).filter(Boolean);
  const company = lines[0] && lines[0] !== title ? lines[0] : clean((main.querySelector('a[href*="/e/"], a[href*="/employers/"]') || {}).innerText);
  const location_ = (lines.find((l) => /^(hybrid|onsite|on-site|remote|in person)\b.*\bbased in\b/i.test(l) || /^(hybrid|onsite|remote)$/i.test(l)) || lines.find((l) => l.length < 80 && /,\s*[A-Z]{2}\b/.test(l) && l !== title) || "").replace(/^.*?based in\s*/i, "");
  const posted = lines.find((l) => /^posted\b/i.test(l)) || "";
  // The description: from "Job description" to the employer section.
  const text = main.innerText || "";
  const at = text.search(/\nJob description\s*\n/i);
  const rest = at >= 0 ? text.slice(at).replace(/^\s*Job description\s*/i, "") : "";
  const end = rest.search(/\n(About the employer|Similar Jobs|Alumni at this employer)\b/i);
  const desc = clean((end > 0 ? rest.slice(0, end) : rest).replace(/\n(Less|More)\n/g, "\n"));
  let applyUrl = "";
  for (const a of main.querySelectorAll("a[href^='http']")) {
    try {
      const u = new URL(a.href);
      if (!/joinhandshake\.com$/i.test(u.hostname) && /apply/i.test(`${a.innerText} ${a.getAttribute("aria-label") || ""}`)) {
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
