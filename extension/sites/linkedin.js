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
  // LinkedIn's 2026 layout has no stable title element, but the tab title is "<title> | <company> | LinkedIn".
  const parts = document.title.split(" | ");
  const fromTab = parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1]);
  const companyEl = top.querySelector("[class*='company-name'] a, [class*='company-name'], a[href*='/company/']");
  const title = fromTab ? clean(parts.slice(0, -2).join(" | ")) : clean((top.querySelector("h1, [class*='job-title']") || {}).innerText);
  const company = fromTab ? clean(parts[parts.length - 2]) : clean(companyEl && companyEl.innerText);
  const location_ = clean((top.querySelector("[class*='primary-description'] span, [class*='tertiary-description'] span, [class*='bullet']") || {}).innerText);
  const descEl = document.querySelector("#job-details, .jobs-description__content, [class*='jobs-description'], [class*='description__text']");
  let descText = clean(descEl && descEl.innerText);
  if (!descText) {
    // New layout: the text under "About the job", up to the next section.
    const all = (document.querySelector("main") || document.body).innerText;
    const at = all.search(/\nAbout the job\s*\n/i);
    const rest = at >= 0 ? all.slice(at).replace(/^\s*About the job\s*/i, "") : "";
    const end = rest.search(/\n(Set alert for similar jobs|About the company|More jobs|Looking for talent\?|Similar jobs|People you can reach out to)\b/i);
    descText = clean(end > 0 ? rest.slice(0, end) : rest).replace(/… more$/, "");
  }
  // "Los Angeles, CA · 15 hours ago · 20 people clicked apply" under the title.
  const metaLine = ((document.querySelector("main") || document.body).innerText.split("\n").find((l) => / · /.test(l) && /ago|reposted/i.test(l)) || "").split(" · ")[0];
  // An external job's Apply button sometimes links through LinkedIn's redirect with the real address in ?url=.
  let applyUrl = "";
  const applyLinks = [...document.querySelectorAll("a[href*='externalApply'], a[href*='/redir/'], a[data-tracking-control-name*='apply']"), ...[...document.querySelectorAll("a[href]")].filter((a) => /^apply$/i.test(clean(a.innerText)))];
  for (const a of applyLinks) {
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
    location: (location_ || clean(metaLine)).slice(0, 120),
    description: descText.slice(0, 6000),
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
 * returns the jobs listed that aren't in `known`: [{ id, title, company, location }]. Self-contained.
 * LinkedIn's search list mostly carries the job id on the card (data-job-id / data-occludable-job-id) and links with
 * ?currentJobId=, not /jobs/view/ links: all three are read.
 */
export async function readLinkedInJobs(max, known) {
  // Waits are timed by the extension's worker: a hidden tab's own timers are throttled to ~1/min after 5 min, which
  // stalled background fills until the tab was opened (owner, 2026-10-26). Falls back to a page timer.
  const sleep = (ms) =>
    new Promise((r) => {
      try {
        chrome.runtime.sendMessage({ type: "cov-sleep", ms }).then(() => r(), () => setTimeout(r, ms));
      } catch {
        setTimeout(r, ms);
      }
    });
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const skip = new Set(known || []);
  const CARD = '[componentkey^="job-card-component-ref-"]';
  // The results scroll in their own box (no stable class): the scrollable element holding the cards.
  const list =
    document.querySelector(".jobs-search-results-list, .scaffold-layout__list, [class*='jobs-search-results']") ||
    [...document.querySelectorAll("div, ul, section")].find((e) => e.scrollHeight > e.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.querySelector(`${CARD}, [data-occludable-job-id]`)) ||
    document.scrollingElement;
  const seen = new Map();
  const idOf = (el) =>
    (el.getAttribute("componentkey") || "").replace(/^job-card-component-ref-/, "") ||
    el.getAttribute("data-job-id") ||
    el.getAttribute("data-occludable-job-id") ||
    ((el.getAttribute("href") || "").match(/\/jobs\/view\/(\d+)|[?&]currentJobId=(\d+)/) || []).slice(1).find(Boolean);
  for (let round = 0; round < 8 && seen.size < max; round++) {
    for (const a of document.querySelectorAll(`${CARD}, [data-job-id], [data-occludable-job-id], a[href*="/jobs/view/"]`)) {
      const id = idOf(a);
      if (!id || !/^\d{5,15}$/.test(id) || seen.has(id) || skip.has(id)) continue;
      if (a.matches(CARD)) {
        // "Selected, <title> (Verified job)" / <title> / <company> / <location> / …
        const lines = [...new Set((a.innerText || "").split("\n").map(clean).filter(Boolean).map((l) => l.replace(/^Selected, /, "").replace(/\s*\(Verified job\)$/, "")))];
        seen.set(id, { id, title: (lines[0] || "").slice(0, 200), company: (lines[1] || "").slice(0, 120), location: (lines[2] || "").slice(0, 120) });
        continue;
      }
      const card = a.closest("li, [data-job-id], [data-occludable-job-id]") || a.parentElement;
      const lines = clean(card?.innerText ?? "")
        .split(/\s{2,}|\n/)
        .map(clean)
        .filter(Boolean);
      const link = a.matches("a") ? a : card?.querySelector('a[href*="/jobs/"]') || a;
      const title = clean((link.querySelector("strong, span[aria-hidden='true']") || link).innerText) || lines[0] || "";
      const company = clean(card?.querySelector("[class*='subtitle'], [class*='company']")?.innerText) || "";
      const location = clean(card?.querySelector("[class*='metadata'], [class*='location']")?.innerText) || "";
      seen.set(id, { id, title: title.slice(0, 200), company: company.slice(0, 120), location: location.slice(0, 120) });
    }
    list.scrollBy({ top: 700, behavior: "smooth" });
    await sleep(1200 + Math.random() * 1200);
  }
  return [...seen.values()].slice(0, max);
}
