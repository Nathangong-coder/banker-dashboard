// LinkedIn → Coverage. Runs ONLY when you click "Send to Coverage" in the popup, and reads only the page you're on
// (a profile or a People search). It never clicks, scrolls, sends requests to LinkedIn or runs in the background:
// automated activity breaks LinkedIn's User Agreement (§8.2) and gets accounts restricted.
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
