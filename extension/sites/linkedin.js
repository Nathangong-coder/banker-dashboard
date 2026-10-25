// LinkedIn → Coverage. captureLinkedIn / captureLinkedInJob run ONLY when you click the popup, and read only the page
// you're on (a profile, a People search, a job). They never click, scroll or send requests to LinkedIn: automated
// activity breaks LinkedIn's User Agreement (§8.2) and gets accounts restricted. The one exception is the opt-in
// LinkedIn job search at the bottom (test build only, owner accepted the account risk, 2026-10-24).
//
// Same logic as the dashboard's bookmarklet (src/lib/linkedinCapture.ts#captureScript); keep the two in step. The
// payload format is what the dashboard's parseCapture expects (#li=…).

export const isLinkedIn = (url) => /^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(url ?? "");
export const isProfile = (url) => /^https:\/\/([a-z]+\.)?linkedin\.com\/in\/[^/?#]+\/?([?#]|$)/i.test(url ?? "");

/**
 * Injected into the LinkedIn tab with chrome.scripting.executeScript, so it must be self-contained (no imports, no
 * outer variables). Returns { people, page } or { error }.
 */
export function captureLinkedIn() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const noise =
    /^(connect|message|follow|following|pending|save|more|view .*profile|status is .*|• ?(1st|2nd|3rd\+?)|(1st|2nd|3rd\+?)( degree connection)?|.*mutual connections?|.*followers?|open to work|provides services|premium.*|linkedin member)$/i;
  const slugOf = (h) => {
    const m = (h || "").match(/\/in\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : "";
  };
  const out = [];
  const seen = new Set();
  const main = document.querySelector("main") || document.body;
  if (/^\/in\/[^/]+\/?$/.test(location.pathname)) {
    const slug = slugOf(location.pathname);
    const lines = main.innerText.split("\n").map(clean).filter((l) => l && !noise.test(l));
    const name = clean((main.querySelector("h1") || {}).innerText) || lines[0];
    out.push({ slug, name, text: lines.join(" · ").slice(0, 12000) });
  } else {
    for (const a of main.querySelectorAll('a[href*="/in/"]')) {
      const slug = slugOf(a.getAttribute("href"));
      if (!slug || seen.has(slug)) continue;
      const card = a.closest("li") || a.closest("[data-chameleon-result-urn]") || a.closest("div[class*=entity]");
      if (!card) continue;
      const lines = card.innerText.split("\n").map(clean).filter((l) => l && !noise.test(l));
      let name = clean((a.querySelector('span[aria-hidden="true"]') || a).innerText).replace(/view .*profile/i, "").trim();
      if (!name || name.length > 80) name = lines[0] || "";
      if (!name || /^linkedin member$/i.test(name)) continue;
      seen.add(slug);
      out.push({ slug, name, text: lines.filter((l) => l !== name).join(" · ").slice(0, 1500) });
    }
  }
  if (!out.length) return { error: "No profiles on this page yet. Open a profile or a People search, scroll so the results load, then try again." };
  return { people: out.slice(0, 60), page: location.href.slice(0, 300) };
}

/**
 * The dashboard address that receives the capture: a profile opens Coffee chat prep, a search opens Find people.
 * `auto`: the dashboard adds (or updates) them and looks up emails straight away, with no review step.
 */
export function captureUrl(dashboard, capture, { auto = false } = {}) {
  const payload = encodeURIComponent(JSON.stringify({ v: 1, page: capture.page, people: capture.people, ...(auto ? { auto: true } : {}) }));
  return `${dashboard}${isProfile(capture.page) ? "/prep" : "/find"}#li=${payload}`;
}

/** A LinkedIn job page: /jobs/view/<id>, or a jobs search / collection with a job open (currentJobId). */
export const isLinkedInJob = (url) => /^https:\/\/([a-z]+\.)?linkedin\.com\/jobs\/(view\/\d+|search|collections)/i.test(url ?? "") && (/\/jobs\/view\/\d+/.test(url) || /[?&]currentJobId=\d+/.test(url));

/**
 * Injected on a LinkedIn job page when you click "Track this job": reads the job you have open (title, company,
 * location, description, and the bank's own apply link when LinkedIn shows one). Read-only, like captureLinkedIn.
 */
export function captureLinkedInJob() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const id = (location.pathname.match(/\/jobs\/view\/(\d+)/) || location.search.match(/[?&]currentJobId=(\d+)/) || [])[1] || "";
  const top =
    document.querySelector(".job-details-jobs-unified-top-card__container--two-pane, .jobs-unified-top-card, .job-view-layout, [class*='top-card']") ||
    document.querySelector("main") ||
    document.body;
  const title = clean((top.querySelector("h1, h2, [class*='job-title']") || {}).innerText);
  const companyEl = top.querySelector("[class*='company-name'] a, [class*='company-name'], a[href*='/company/']");
  const company = clean(companyEl && companyEl.innerText);
  const location_ = clean((top.querySelector("[class*='primary-description'] span, [class*='tertiary-description'] span, [class*='bullet']") || {}).innerText);
  const desc = document.querySelector("#job-details, .jobs-description__content, [class*='jobs-description'], [class*='description__text']");
  // An external job's Apply button sometimes links through LinkedIn's redirect with the real address in ?url=.
  let applyUrl = "";
  for (const a of document.querySelectorAll("a[href*='externalApply'], a[href*='/redir/'], a[data-tracking-control-name*='apply']")) {
    try {
      const u = new URL(a.href, location.href);
      const real = u.searchParams.get("url");
      const target = real ? new URL(real) : u;
      if (!/(^|\.)linkedin\.com$/i.test(target.hostname)) {
        applyUrl = target.href;
        break;
      }
    } catch {
      // ignore
    }
  }
  if (!id || (!title && !company)) return { error: "Open a job first (its title and company should be showing), then try again." };
  return {
    title: title.slice(0, 200),
    company: company.slice(0, 120),
    location: location_.slice(0, 120),
    description: clean(desc && desc.innerText).slice(0, 6000),
    url: `https://www.linkedin.com/jobs/view/${id}/`,
    applyUrl: applyUrl.slice(0, 1000),
    linkedinJobId: id,
  };
}

/** Applications on your dashboard, with the job in the address fragment (never sent to a server). */
export function jobCaptureUrl(dashboard, job) {
  return `${dashboard}/applications#job=${encodeURIComponent(JSON.stringify(job))}`;
}

/**
 * Opt-in LinkedIn job search (test build only: the store build has no LinkedIn site access to run it with). A Jobs
 * search address with your words, the past month, internships.
 */
export function linkedinJobsUrl(terms, location) {
  const u = new URL("https://www.linkedin.com/jobs/search/");
  u.searchParams.set("keywords", String(terms || "").trim() || "summer analyst investment banking");
  if (String(location || "").trim()) u.searchParams.set("location", String(location).trim());
  u.searchParams.set("f_TPR", "r2592000");
  u.searchParams.set("f_E", "1");
  return u.toString();
}

/** LinkedIn sent you to sign in or a security check: the job reader stops there (it never solves those). */
export const isLinkedInWall = (url) => /linkedin\.com\/(checkpoint|authwall|login|uas\/login|signup)/i.test(url ?? "");

/**
 * Injected into a LinkedIn Jobs search tab: scrolls the results list a little at a time (like reading it) and
 * returns the jobs listed: [{ id, title, company, location }]. Self-contained.
 */
export async function readLinkedInJobs(max) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const list = document.querySelector(".jobs-search-results-list, .scaffold-layout__list, [class*='jobs-search-results']") || document.scrollingElement;
  const seen = new Map();
  for (let round = 0; round < 8 && seen.size < max; round++) {
    for (const a of document.querySelectorAll('a[href*="/jobs/view/"]')) {
      const id = (a.getAttribute("href").match(/\/jobs\/view\/(\d+)/) || [])[1];
      if (!id || seen.has(id)) continue;
      const card = a.closest("li, [data-job-id], [data-occludable-job-id]") || a.parentElement;
      const lines = clean(card?.innerText ?? "")
        .split(/\s{2,}|\n/)
        .map(clean)
        .filter(Boolean);
      const title = clean((a.querySelector("strong, span[aria-hidden='true']") || a).innerText) || lines[0] || "";
      const company = clean(card?.querySelector("[class*='subtitle'], [class*='company']")?.innerText) || "";
      const location = clean(card?.querySelector("[class*='metadata'], [class*='location']")?.innerText) || "";
      seen.set(id, { id, title: title.slice(0, 200), company: company.slice(0, 120), location: location.slice(0, 120) });
    }
    list.scrollBy({ top: 700, behavior: "smooth" });
    await sleep(1200 + Math.random() * 1200);
  }
  return [...seen.values()].slice(0, max);
}
