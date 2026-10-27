// Job application autofill: the functions injected into the job page (with chrome.scripting.executeScript, only
// after you click "Autofill this page" in the popup, or while a multi-page fill you started is running on a site you
// allowed). Each must be self-contained: no imports, no outer variables.
//
// scanForm reads the form (labels, types, options; custom dropdowns are opened to read their choices, then closed)
// and tags each field. fillForm types the values the Coverage tab decided into those tagged fields only, picking
// dropdown / suggestion options by text. clickNext presses a page's Next / Continue button by fixed rules (never
// anything that says submit, apply, sign…). No AI decides any click, and nothing here ever submits an application.

/** Hosts autofill never runs on (LinkedIn automation breaks its User Agreement). */
export const isBlockedSite = (url) => /^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(url ?? "");

/**
 * Application systems the extension may be allowed on for multi-page fills and embedded forms (the optional host
 * permissions in manifest.json; you grant one site at a time from the popup). Keep in step with the manifest.
 */
export const APPLICATION_SITES = [
  "myworkdayjobs.com", "myworkdaysite.com", "workday.com", "greenhouse.io", "lever.co", "ashbyhq.com", "smartrecruiters.com", "icims.com", "taleo.net",
  "oraclecloud.com", "successfactors.com", "successfactors.eu", "jobvite.com", "brassring.com", "eightfold.ai", "avature.net", "workable.com",
];

/** The permission pattern for a page on one of APPLICATION_SITES ("https://*.myworkdayjobs.com/*"), or null. */
export function sitePattern(url) {
  try {
    const host = new URL(url).hostname;
    const site = APPLICATION_SITES.find((s) => host === s || host.endsWith(`.${s}`));
    return site ? `https://*.${site}/*` : null;
  } catch {
    return null;
  }
}

/** Workday walks you through several pages (My Information → Experience → Questions → Disclosures → Review). */
export const isMultiPageSite = (url) => /^https:\/\/([a-z0-9-]+\.)*(myworkdayjobs|myworkdaysite|workday)\.com\//i.test(url ?? "");

export async function scanForm() {
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
  const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim().slice(0, 600);
  // Workday (and other apps) set aria-hidden / inert on the whole page while a dropdown or dialog is open. If that hides
  // every field, scan again without it: size, position, visibility and clipping checks still keep hidden traps out.
  let ariaStrict = true;
  const shown = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.closest(ariaStrict ? '[aria-hidden="true"],[hidden],[inert],template' : "[hidden],template")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // Pushed off the page (left: -9999px and similar): a field you can't see is never filled.
    if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) <= 0.05) return false;
    // Clipped away inside a tiny overflow-hidden box (the "visually hidden" trick).
    for (let a = el.parentElement, i = 0; a && i < 6; a = a.parentElement, i++) {
      const ar = a.getBoundingClientRect();
      if ((ar.width < 2 || ar.height < 2) && getComputedStyle(a).overflow !== "visible") return false;
      if (ar.right + scrollX <= 0 || ar.bottom + scrollY <= 0) return false;
    }
    return true;
  };
  const textOf = (ids) => clean(ids.split(/\s+/).map((i) => document.getElementById(i)?.innerText || "").join(" "));
  const ownLabel = (el) => {
    if (el.getAttribute("aria-labelledby")) {
      const t = textOf(el.getAttribute("aria-labelledby"));
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && clean(l.innerText)) return clean(l.innerText);
    }
    const wrap = el.closest("label");
    if (wrap && clean(wrap.innerText)) return clean(wrap.innerText);
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    return "";
  };
  // The question a field (or a radio group) sits under: the nearest label-like text in its container that isn't
  // the label of some other input.
  const containerLabel = (el, stopAt) => {
    let node = el.parentElement;
    for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
      const legend = node.matches("fieldset") ? node.querySelector(":scope > legend") : null;
      if (legend && clean(legend.innerText)) return clean(legend.innerText);
      if (node.getAttribute("aria-labelledby")) {
        const t = textOf(node.getAttribute("aria-labelledby"));
        if (t) return t;
      }
      if (node.getAttribute("role") === "radiogroup" || node.getAttribute("role") === "group") {
        const t = clean(node.getAttribute("aria-label") || "");
        if (t) return t;
      }
      for (const lab of node.querySelectorAll("label, legend, [class*='label' i], [data-automation-id*='label' i], [class*='question' i]")) {
        if (lab.contains(el) || (stopAt && lab.contains(stopAt)) || lab.querySelector("input,select,textarea,button")) continue;
        if (lab.htmlFor && document.getElementById(lab.htmlFor) && document.getElementById(lab.htmlFor) !== el) continue;
        const t = clean(lab.innerText);
        if (t) return t;
      }
    }
    return "";
  };
  // A file input hidden behind an "Attach" / "Upload resume" link has no label: use the text around it (the link and
  // the heading above it), staying inside the box that holds only this upload. Then its id ("resume_upload").
  const fileLabel = (el) => {
    for (let node = el.parentElement, i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
      // Stop before a box that also holds another question's input or dropdown.
      const others = [...node.querySelectorAll('input:not([type=hidden]), select, textarea, [aria-haspopup="listbox"]')].filter((x) => x !== el);
      if (others.length) break;
      const t = clean(node.innerText);
      if (t) return t.slice(0, 120);
    }
    return clean((el.id || "").replace(/[_-]+/g, " "));
  };
  const visibleOptions = () => [...document.querySelectorAll('[role="option"], [id*="-option-"], [class*="__option"]')].filter(shown);
  // Real input through the extension (test build: Chrome's debugging protocol). Greenhouse's react-select dropdowns
  // ignore dispatched events entirely; a real click opens them. Returns false when not available (store build).
  const real = async (type, payload) => {
    try {
      return (await chrome.runtime.sendMessage({ type, ...payload })) === true;
    } catch {
      return false;
    }
  };
  const realClick = async (node) => {
    if (!node || window.top !== window) return false;
    node.scrollIntoView({ block: "center", behavior: "instant" });
    await sleep(120);
    const r = node.getBoundingClientRect();
    return real("cov-click", { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 });
  };
  // A react-select's own list (react-select-<input id>-listbox), so other open lists (the phone number's country
  // picker keeps 244 hidden options on the page) are never read as its choices.
  const rsList = (input) => (input.id ? document.getElementById(`react-select-${input.id}-listbox`) : null);
  const rsOptions = (input) => {
    const lb = rsList(input);
    return lb ? [...lb.querySelectorAll('[role="option"]')] : visibleOptions().filter((o) => !o.closest('[id^="iti-"], .iti'));
  };
  /** Open a react-select: a real click on its control, else dispatched events. */
  const rsOpen = async (input) => {
    const control = input.closest("[class*='control' i]") || input;
    if (!(await realClick(control))) {
      input.focus();
      control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    }
    for (let i = 0; i < 12; i++) {
      await sleep(120);
      if (rsOptions(input).length) return true;
    }
    return false;
  };
  const rsClose = async (input) => {
    if (!(await real("cov-key", { key: "Escape" }))) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    await sleep(80);
  };

  const placeholderish = (t) => !t || /^(select|select one|choose|choose one|please select|--|—|-)\b/i.test(t);

  const tag = (el, id) => el.setAttribute("data-coverage-field", id);
  let n = 0;
  const collect = async () => {
  const fields = [];
  const groups = new Map();
  const skipKinds = new Set(["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"]);

  for (const el of document.querySelectorAll("input, select, textarea")) {
    if (fields.length >= 250) break;
    if (el.disabled || el.readOnly) continue;
    const type = (el.getAttribute("type") || (el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : "text")).toLowerCase();
    if (skipKinds.has(type) || el.autocomplete === "current-password" || el.autocomplete === "new-password") continue;

    if (type === "radio" || type === "checkbox") {
      const name = el.name || "";
      const lab = ownLabel(el) || clean(el.value);
      const visibleBox = shown(el) || shown(el.closest("label")) || (el.id && shown(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)));
      if (!visibleBox) continue;
      const key = `${type}:${el.form ? [...document.forms].indexOf(el.form) : -1}:${name || `solo${n}`}`;
      let g = groups.get(key);
      if (!g) {
        g = { id: `cf${n++}`, type, els: [], labels: [] };
        groups.set(key, g);
      }
      el.setAttribute("data-coverage-option", String(g.els.length));
      tag(el, g.id);
      g.els.push(el);
      g.labels.push(lab);
      continue;
    }

    const isFile = type === "file";
    if (!isFile && !shown(el)) continue;
    // Upload fields: their id / name often says what they're for ("cover_letter", "resume") when the visible text doesn't.
    const label = isFile
      ? clean(`${ownLabel(el) || fileLabel(el)} ${[el.id, el.getAttribute("name"), el.getAttribute("data-automation-id")].filter(Boolean).join(" ").replace(/[_-]+/g, " ")}`)
      : ownLabel(el) || containerLabel(el) || clean(el.getAttribute("placeholder") || el.getAttribute("name") || "");
    const id = `cf${n++}`;
    tag(el, id);
    // A text box that only takes a picked suggestion (react-select, Workday search boxes).
    if (el.tagName === "INPUT" && el.getAttribute("role") === "combobox") {
      const box = el.closest("[class*='container' i], [data-automation-id], div");
      const picked = box?.querySelector("[class*='singleValue' i], [data-automation-id='selectedItem'], [class*='selected' i]");
      const filled = !!clean(picked?.innerText) || !!el.value.trim();
      // A react-select with a fixed list (Greenhouse's Yes / No questions, Country, Gender…) opens on ArrowDown and
      // shows every option: read them, so the answer is picked from the list. A search box (School) shows nothing
      // until you type: that stays a typeahead.
      let options;
      if (!filled) {
        await rsOpen(el);
        const labels = rsOptions(el).map((o) => clean(o.innerText)).filter(Boolean);
        if (labels.length && !labels.every((l) => /loading|type to search|start typing|no (results|options)/i.test(l))) options = labels.slice(0, 300).map((l, i) => ({ value: String(i), label: l }));
        await rsClose(el);
      }
      fields.push({ id, kind: options ? "listbox" : "typeahead", label, required: el.required || el.getAttribute("aria-required") === "true", filled, options });
      continue;
    }
    const kind = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : ["email", "tel", "url", "number", "date", "month", "file"].includes(type) ? type : "text";
    const field = {
      id,
      kind,
      label,
      required: el.required || el.getAttribute("aria-required") === "true",
      maxLength: el.maxLength > 0 ? el.maxLength : undefined,
      placeholder: clean(el.getAttribute("placeholder") || "") || undefined,
      accept: isFile ? el.getAttribute("accept") || "" : undefined,
    };
    if (kind === "select") {
      field.options = [...el.options].slice(0, 200).map((o, i) => ({ value: String(i), label: clean(o.text) }));
      field.filled = el.selectedIndex > 0 && el.value !== "";
    } else if (isFile) field.filled = el.files && el.files.length > 0;
    else field.filled = !!el.value.trim();
    fields.push(field);
  }

  for (const g of groups.values()) {
    const first = g.els[0];
    const multi = g.els.length > 1;
    const question = multi ? containerLabel(first, first) || g.labels.join(" / ") : g.labels[0] || containerLabel(first);
    fields.push({
      id: g.id,
      kind: g.type === "radio" ? "radio" : multi ? "checkboxes" : "checkbox",
      label: clean(question),
      required: first.required,
      options: multi || g.type === "radio" ? g.labels.map((l, i) => ({ value: String(i), label: l })) : undefined,
      filled: g.type === "radio" ? g.els.some((e) => e.checked) : false,
    });
  }

  // Custom dropdowns (a button that opens a list). Open each to read its choices, then close it again.
  const buttons = [...document.querySelectorAll('button[aria-haspopup="listbox"], [role="button"][aria-haspopup="listbox"], [role="combobox"]:not(input):not(select)')].filter(shown).slice(0, 40);
  for (const b of buttons) {
    if (b.hasAttribute("data-coverage-field") || b.querySelector("[data-coverage-field]")) continue;
    const label = ownLabel(b) || containerLabel(b);
    const current = clean(b.innerText || b.getAttribute("value") || "");
    const id = `cf${n++}`;
    tag(b, id);
    const field = { id, kind: "listbox", label, required: b.getAttribute("aria-required") === "true" || /\*\s*$/.test(label), filled: !placeholderish(current) };
    if (!field.filled) {
      b.click();
      let opts = [];
      for (let i = 0; i < 12 && !opts.length; i++) {
        await sleep(100);
        opts = visibleOptions();
      }
      field.options = opts.slice(0, 200).map((o, i) => ({ value: String(i), label: clean(o.innerText) })).filter((o) => o.label);
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(60);
      if (b.getAttribute("aria-expanded") === "true") b.click();
      await sleep(60);
    }
    fields.push(field);
  }
  return fields;
  };

  let fields = [];
  let error;
  try {
    fields = await collect();
    // Workday marks parts of the page aria-hidden while a notice / popup is open, which hid all but one field of a
    // logged-in form (owner, 2026-10-26). With few fields found, look again without that filter and keep the clearly
    // bigger result (size, position, visibility and clipping checks still keep hidden traps out).
    const real = fields.filter((f) => f.kind !== "file").length;
    if (real < 4) {
      ariaStrict = false;
      for (const el of document.querySelectorAll("[data-coverage-field]")) el.removeAttribute("data-coverage-field");
      const loose = await collect();
      if (loose.filter((f) => f.kind !== "file").length >= real + 2 || !real) fields = loose;
      else {
        ariaStrict = true;
        for (const el of document.querySelectorAll("[data-coverage-field]")) el.removeAttribute("data-coverage-field");
        fields = await collect();
      }
    }
  } catch (e) {
    error = String(e?.message || e).slice(0, 200);
  }
  // What the page had, for the "no fields" message.
  const seen = { inputs: document.querySelectorAll("input:not([type=hidden]), select, textarea").length, dropdowns: document.querySelectorAll('[aria-haspopup="listbox"], [role="combobox"]').length, error };

  const frames = [...document.querySelectorAll("iframe")]
    .filter((f) => {
      try {
        const r = f.getBoundingClientRect();
        return r.width > 300 && r.height > 300 && f.src && new URL(f.src, location.href).origin !== location.origin;
      } catch {
        return false;
      }
    })
    .map((f) => new URL(f.src, location.href).href.slice(0, 500));
  const main = document.querySelector("main") || document.body;
  return { fields, frames, seen, text: (main.innerText || "").replace(/\s+/g, " ").slice(0, 6000), url: location.href, title: document.title.slice(0, 200) };
}

/**
 * Types the planned values into the tagged fields, highlights them (green = your info, amber = AI draft) and shows a
 * small review box in the corner. `items` come from the Coverage tab; anything that doesn't match a tagged field of
 * the right kind is ignored. Dropdowns and suggestion boxes are opened and the matching option clicked.
 */
export async function fillForm(items, review) {
  const NEVER = /\b(password|passcode|ssn|social security|social insurance|national insurance|tax id|taxpayer|itin|bank account|routing|account number|iban|swift|credit card|card number|cvv|cvc|security code|driver'?s? licen[cs]e (number|no\b|#|id)|passport number|mother'?s maiden|date of birth|birth ?date|dob)\b/i;
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
  const norm = (s) => (s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const STOP = new Set(["of", "the", "and", "at", "in", "for"]);
  // How well a suggestion matches an answer: exact > prefix > the answer as initials (UCLA) > shared words.
  const score = (option, want) => {
    const o = norm(option);
    const w = norm(want);
    if (!o || !w) return 0;
    if (o === w) return 1;
    if (o.startsWith(w) || w.startsWith(o)) return 0.9;
    const initials = o.split(" ").filter((x) => !STOP.has(x)).map((x) => x[0]).join("");
    if (w.length >= 2 && !w.includes(" ") && initials === w) return 0.85;
    const ow = new Set(o.split(" ").filter((x) => x.length > 1));
    const ww = w.split(" ").filter((x) => x.length > 1);
    if (!ww.length) return 0;
    return (ww.filter((x) => ow.has(x)).length / ww.length) * 0.8;
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
  };
  const visibleOptions = () => [...document.querySelectorAll('[role="option"], [id*="-option-"], [class*="__option"]')].filter(shown);
  // Real input through the extension (test build: Chrome's debugging protocol). Greenhouse's react-select dropdowns
  // ignore dispatched events entirely; a real click opens them. Returns false when not available (store build).
  const real = async (type, payload) => {
    try {
      return (await chrome.runtime.sendMessage({ type, ...payload })) === true;
    } catch {
      return false;
    }
  };
  const realClick = async (node) => {
    if (!node || window.top !== window) return false;
    node.scrollIntoView({ block: "center", behavior: "instant" });
    await sleep(120);
    const r = node.getBoundingClientRect();
    return real("cov-click", { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 });
  };
  // A react-select's own list (react-select-<input id>-listbox), so other open lists (the phone number's country
  // picker keeps 244 hidden options on the page) are never read as its choices.
  const rsList = (input) => (input.id ? document.getElementById(`react-select-${input.id}-listbox`) : null);
  const rsOptions = (input) => {
    const lb = rsList(input);
    return lb ? [...lb.querySelectorAll('[role="option"]')] : visibleOptions().filter((o) => !o.closest('[id^="iti-"], .iti'));
  };
  /** Open a react-select: a real click on its control, else dispatched events. */
  const rsOpen = async (input) => {
    const control = input.closest("[class*='control' i]") || input;
    if (!(await realClick(control))) {
      input.focus();
      control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    }
    for (let i = 0; i < 12; i++) {
      await sleep(120);
      if (rsOptions(input).length) return true;
    }
    return false;
  };
  const rsClose = async (input) => {
    if (!(await real("cov-key", { key: "Escape" }))) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    await sleep(80);
  };

  const pressOption = (opt) => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) opt.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    opt.click();
  };
  const best = (opts, wants) => {
    let top = null;
    for (const o of opts)
      for (const w of wants) {
        const s = score(o.innerText, w);
        if (!top || s > top.s) top = { o, s };
      }
    return top && top.s >= 0.5 ? top.o : null;
  };
  const setNative = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const escape = () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const mark = (el, source) => {
    const target = el.type === "radio" || el.type === "checkbox" ? el.closest("label") || el : el;
    if (!target.dataset.coverageOutline) target.dataset.coverageOutline = target.style.outline || "none";
    target.style.outline = `2px solid ${source === "ai" ? "#c47f17" : "#1f7a5c"}`;
    target.style.outlineOffset = "2px";
  };
  // Watch mode ("Watch it work" on the dashboard): scroll to each field, type it out visibly, and show a banner with
  // a Stop button. Stop only ever stops Coverage; it never presses anything on the page.
  const watch = !!review?.watch;
  let banner = null;
  const say = (text) => {
    if (!watch) return;
    if (!banner) {
      document.getElementById("coverage-autofill-live")?.remove();
      const host = document.createElement("div");
      host.id = "coverage-autofill-live";
      host.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;";
      const root = host.attachShadow({ mode: "closed" });
      const box = document.createElement("div");
      box.style.cssText = "display:flex;align-items:center;gap:10px;background:#0e1a2b;color:#fff;border-radius:999px;padding:7px 8px 7px 14px;font:13px/1.3 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);";
      const dot = document.createElement("span");
      dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:#3ccf91;box-shadow:0 0 0 4px rgba(60,207,145,.25);";
      const label = document.createElement("span");
      const stop = document.createElement("button");
      stop.textContent = "Stop";
      stop.style.cssText = "border:0;border-radius:999px;background:#fff;color:#0e1a2b;padding:4px 12px;font:600 12px system-ui,sans-serif;cursor:pointer;";
      stop.addEventListener("click", () => {
        document.documentElement.dataset.coverageStop = "1";
        label.textContent = "Stopping…";
      });
      box.append(dot, label, stop);
      root.append(box);
      document.documentElement.append(host);
      banner = { host, label };
    }
    banner.label.textContent = text;
  };
  const stopped = () => document.documentElement.dataset.coverageStop === "1";
  const typeOut = async (el, v) => {
    if (!watch || v.length > 600) return setNative(el, v);
    for (let i = 1; i <= v.length; i++) {
      if (stopped()) break;
      setNative(el, v.slice(0, i));
      await sleep(v.length > 200 ? 4 : 18);
    }
  };
  const focusOn = async (el) => {
    if (!watch) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const target = el.type === "radio" || el.type === "checkbox" ? el.closest("label") || el : el;
    const prev = target.style.boxShadow;
    target.style.boxShadow = "0 0 0 4px rgba(31,122,92,.35)";
    await sleep(350);
    setTimeout(() => (target.style.boxShadow = prev), 900);
  };

  const done = [];
  const failed = [];
  let step = 0;
  for (const it of items) {
    step++;
    if (stopped()) {
      failed.push({ label: it.label, why: "You stopped Coverage before this one." });
      continue;
    }
    say(`Coverage is filling · ${step} of ${items.length}: ${(it.label || "field").slice(0, 60)}`);
    let els = [...document.querySelectorAll(`[data-coverage-field="${CSS.escape(String(it.id))}"]`)];
    if (!els.length && it.label) {
      // React forms rebuild a field after another answer (Greenhouse's School box): find it again by its label.
      const want = norm(it.label);
      const labelText = (x) => {
        const by = (x.getAttribute("aria-labelledby") || "").split(/\s+/).map((i) => document.getElementById(i)?.innerText || "").join(" ");
        const forL = x.id ? document.querySelector(`label[for="${CSS.escape(x.id)}"]`)?.innerText : "";
        return norm(by || forL || x.getAttribute("aria-label") || "");
      };
      const again = [...document.querySelectorAll("input:not([type=hidden]), select, textarea, [role=combobox]")].find((x) => {
        const t = labelText(x);
        return t && (t === want || (t.length > 6 && want.startsWith(t)));
      });
      if (again) {
        again.setAttribute("data-coverage-field", String(it.id));
        els = [again];
      }
    }
    const el = els[0];
    if (el) await focusOn(el);
    if (!el) {
      failed.push({ label: it.label, why: "The field changed or disappeared." });
      continue;
    }
    if (el.type === "password" || NEVER.test(it.label || "")) {
      failed.push({ label: it.label, why: "Never filled automatically." });
      continue;
    }
    try {
      if (it.fileData) {
        if (el.type !== "file") throw new Error("Not a file field.");
        const bin = atob(it.fileData.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], it.fileData.name, { type: it.fileData.type }));
        el.files = dt.files;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        mark(el.closest("label, div") || el, "profile");
      } else if (el.tagName === "SELECT") {
        const opt = el.options[Number(it.value)];
        if (!opt) throw new Error("Option not found.");
        setNative(el, opt.value);
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        mark(el, it.source);
      } else if (el.type === "radio" || el.type === "checkbox") {
        const target = it.value !== undefined && it.value !== null ? els.find((x) => x.dataset.coverageOption === String(it.value)) : el;
        if (!target || (target.type !== "radio" && target.type !== "checkbox")) throw new Error("Option not found.");
        const want = target.type === "radio" ? true : it.checked ?? true;
        // A click on a radio / checkbox only ticks it (never submits); frameworks listen for the click.
        if (target.checked !== want) target.click();
        mark(target, it.source);
      } else if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && (el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("role") === "combobox")) {
        // Custom dropdown: open it, click the option with the planned text.
        el.click();
        let opts = [];
        for (let i = 0; i < 15 && !opts.length; i++) {
          await sleep(100);
          opts = visibleOptions();
        }
        const wants = [it.optionLabel, it.value].filter((x) => typeof x === "string" && x && !/^\d+$/.test(x));
        const opt = (it.optionLabel && opts.find((o) => norm(o.innerText) === norm(it.optionLabel))) || best(opts, wants);
        if (!opt) {
          escape();
          throw new Error("Couldn't find that choice: pick it yourself.");
        }
        pressOption(opt);
        await sleep(150);
        mark(el, it.source);
      } else if (el.tagName === "INPUT" && el.getAttribute("role") === "combobox" && it.optionLabel) {
        // A react-select with a fixed list: open it, click the planned option; a long list (Country) is filtered by
        // typing the option's text first.
        const find = async () => {
          for (let i = 0; i < 12; i++) {
            await sleep(120);
            const opts = rsOptions(el);
            const hit = opts.find((o) => norm(o.innerText) === norm(it.optionLabel)) || best(opts, [it.optionLabel]);
            if (hit) return hit;
          }
          return null;
        };
        await rsOpen(el);
        let opt = await find();
        if (!opt) {
          // A long list (Country): type to filter it.
          if (!(await real("cov-type", { text: it.optionLabel.slice(0, 40) }))) setNative(el, it.optionLabel.slice(0, 40));
          opt = await find();
        }
        if (!opt) {
          await rsClose(el);
          throw new Error("Couldn't find that choice: pick it yourself.");
        }
        if (!(await realClick(opt))) pressOption(opt);
        await sleep(200);
        mark(el, it.source);
      } else if (el.tagName === "INPUT" && el.getAttribute("role") === "combobox") {
        // Suggestion box: type, wait for the list, click the best match (or clear it again).
        if (typeof it.value !== "string" || !it.value) continue;
        // A search box (School, Location): real typing when available, so the site's search runs. Schools are tried
        // several ways ("University of California, Los Angeles", "UCLA", "Los Angeles") and only a real match is taken.
        const alts = Array.isArray(it.alts) ? it.alts : [];
        const words = (w) => norm(w).split(" ").filter((x) => x.length > 1 && !STOP.has(x));
        const accept = (o) => {
          const t = ` ${norm(o.innerText)} `;
          return alts.some((w) => {
            const ws = words(w);
            return ws.length && ws.every((x) => t.includes(` ${x} `));
          });
        };
        const queries = (Array.isArray(it.search) && it.search.length ? it.search : [it.value]).slice(0, 4);
        let opt = null;
        let typedReal = false;
        for (const q of queries) {
          setNative(el, "");
          typedReal = (await realClick(el)) && (await real("cov-type", { text: q }));
          if (!typedReal) {
            el.focus();
            el.click();
            setNative(el, q);
          }
          let opts = [];
          for (let i = 0; i < 30; i++) {
            await sleep(120);
            opts = rsOptions(el);
            if (opts.length && !opts.every((o) => /loading|searching|no (results|options)/i.test(o.innerText))) break;
          }
          if (it.strict) {
            // Prefer the full name over the acronym, then the shortest ("UCLA Extension" loses to "UCLA").
            const good = opts.filter(accept).sort((a, b) => Number(!words(alts[0] ?? "").every((x) => ` ${norm(a.innerText)} `.includes(` ${x} `))) - Number(!words(alts[0] ?? "").every((x) => ` ${norm(b.innerText)} `.includes(` ${x} `))) || a.innerText.length - b.innerText.length);
            opt = good[0] ?? null;
          } else opt = best(opts, [it.value, ...alts]);
          if (opt) break;
        }
        if (!opt) {
          setNative(el, "");
          await rsClose(el);
          throw new Error("None of its suggestions matched: pick it yourself.");
        }
        if (!(await realClick(opt))) pressOption(opt);
        await sleep(150);
        mark(el, it.source);
      } else if (typeof it.value === "string") {
        if (el.value && el.value.trim()) {
          failed.push({ label: it.label, why: "Already had something in it: left as is." });
          continue;
        }
        el.focus();
        await typeOut(el, el.maxLength > 0 ? it.value.slice(0, el.maxLength) : it.value);
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        mark(el, it.source);
      } else continue;
      done.push(it.label);
    } catch (e) {
      failed.push({ label: it.label, why: e instanceof Error ? e.message : "Couldn't fill it." });
    }
  }

  banner?.host.remove();
  // The review box: text only (textContent), in a shadow root so the page's styles don't change it.
  document.getElementById("coverage-autofill-review")?.remove();
  const host = document.createElement("div");
  host.id = "coverage-autofill-review";
  host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const box = document.createElement("div");
  box.style.cssText =
    "width:320px;max-height:60vh;overflow:auto;background:#fff;color:#1d2733;border:1px solid #dfe4ea;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);font:13px/1.45 system-ui,sans-serif;padding:12px 14px;";
  const line = (text, css = "") => {
    const p = document.createElement("div");
    p.textContent = text;
    p.style.cssText = css;
    box.append(p);
    return p;
  };
  line(`Coverage filled ${done.length} field${done.length === 1 ? "" : "s"}`, "font-weight:600;font-size:14px;");
  line("Green = your info, amber = AI draft. Read every field, then submit it yourself. Coverage never submits.", "color:#5d6b7a;margin:2px 0 8px;");
  const left = [...(review?.skipped ?? []), ...failed].slice(0, 15);
  if (left.length) {
    line(`Needs you (${left.length})`, "font-weight:600;margin-top:4px;");
    for (const s of left) line(`• ${s.label || "Unlabelled field"}: ${s.why}`, "color:#5d6b7a;font-size:12px;");
  }
  const close = document.createElement("button");
  close.textContent = "Done reviewing";
  close.style.cssText = "margin-top:10px;border:1px solid #dfe4ea;background:#f4f6f8;border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;";
  close.addEventListener("click", () => {
    for (const t of document.querySelectorAll("[data-coverage-outline]")) {
      t.style.outline = t.dataset.coverageOutline === "none" ? "" : t.dataset.coverageOutline;
      delete t.dataset.coverageOutline;
    }
    host.remove();
  });
  box.append(close);
  root.append(box);
  document.body.append(host);
  return { filled: done.length, failed, stopped: stopped() };
}

/**
 * Where a multi-page form stands: a signature that changes when the next page loads, whether it's the final
 * review / submit page, and any error messages the site shows (a Next that didn't go through).
 */
export function pageState() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
  };
  const heading = [...document.querySelectorAll("h1, h2, h3, [data-automation-id*='pageHeader' i], [aria-current='step']")]
    .filter(shown)
    .map((h) => clean(h.innerText))
    .join(" | ")
    .slice(0, 300);
  const inputs = [...document.querySelectorAll("input, select, textarea, button[aria-haspopup='listbox']")].filter(shown).length;
  const buttons = [...document.querySelectorAll("button, [role='button'], input[type='submit']")].filter(shown).map((b) => clean(b.innerText || b.value || ""));
  const errors = [...document.querySelectorAll("[role='alert'], [aria-invalid='true'], [data-automation-id*='error' i]")]
    .filter(shown)
    .map((e) => clean(e.innerText || e.getAttribute("aria-label") || ""))
    .filter(Boolean)
    .slice(0, 5);
  const busy = !!document.querySelector("[aria-busy='true'], [data-automation-id*='loading' i]");
  // The last step: a "Review" heading, or a Submit button with no way forward left.
  const hasNext = buttons.some((t) => /^(next|continue|save and continue|save & continue|save and next|next step|proceed)$/i.test(t));
  const review = /\breview\b/i.test(heading) || (buttons.some((t) => /^submit\b/i.test(t)) && !hasNext);
  return { sig: `${location.pathname}|${heading}|${inputs}`, review, errors, busy };
}

/**
 * Presses the page's Next / Continue button. Fixed rules, no AI: the button's text must be one of a few forward
 * words, and anything that could submit, apply, sign or remove is refused. Workday's own next button is preferred.
 */
export async function clickNext() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const DENY = /submit|apply|sign|withdraw|delete|remove|cancel|decline|back|previous|finish|send|accept|agree|pay|purchase|log ?out/i;
  const ALLOW = /^(next|continue|save and continue|save & continue|save and next|next step|proceed)$/i;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden" && !el.disabled && el.getAttribute("aria-disabled") !== "true";
  };
  const text = (el) => clean(el.innerText || el.value || el.getAttribute("aria-label") || "");
  const workday = [...document.querySelectorAll('[data-automation-id="bottom-navigation-next-button"], [data-automation-id="pageFooterNextButton"]')].find(shown);
  let pick = workday && !DENY.test(text(workday)) ? workday : null;
  if (!pick) {
    const ok = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")].filter((b) => shown(b) && ALLOW.test(text(b)) && !DENY.test(text(b)) && !b.closest("header, nav"));
    if (ok.length !== 1) return { clicked: false, why: ok.length ? "More than one Next button: go on yourself." : "No Next button on this page." };
    pick = ok[0];
  }
  const label = text(pick);
  if (DENY.test(label)) return { clicked: false, why: `Won't press "${label}".` };
  pick.scrollIntoView({ block: "center", behavior: "instant" });
  const r = pick.getBoundingClientRect();
  let real = false;
  try {
    real = window.top === window && (await chrome.runtime.sendMessage({ type: "cov-click", x: r.left + r.width / 2, y: r.top + r.height / 2 })) === true;
  } catch {
    // no real clicks here
  }
  if (!real) pick.click();
  return { clicked: true, label };
}

/** True once you pressed Stop on the page's Coverage banner (batch fills check it between steps). */
export function stopRequested() {
  return document.documentElement.dataset.coverageStop === "1";
}

/**
 * Is this a sign-in, create-account or verify-your-email page? Fixed rules over what's visible: one password box =
 * sign in; two (password + confirm) or a create-account form = sign up; a "check your email" page = verify.
 */
export function loginState() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  };
  const pw = [...document.querySelectorAll("input[type=password]")].filter(shown);
  const text = clean((document.querySelector("[role=dialog]") || document.querySelector("main") || document.body).innerText).slice(0, 4000);
  const buttons = [...document.querySelectorAll("button, [role=button], input[type=submit], a")].filter(shown).map((b) => clean(b.innerText || b.value || b.getAttribute("aria-label") || ""));
  const signInSwitch = buttons.some((t) => /^(sign in|log in|already have an account\??\s*sign in)$/i.test(t)) || !!document.querySelector('[data-automation-id="signInLink"]');
  if (/check your (email|inbox)|verify your (email|account)|verification (code|link) (has been )?sent/i.test(text) && !pw.length) return { kind: "verify", signInSwitch };
  if (pw.length >= 2 || (pw.length && /\b(verify new password|confirm password|re-?enter password)\b/i.test(text))) return { kind: "signup", signInSwitch };
  if (pw.length === 1) return { kind: "signin", signInSwitch };
  return { kind: "none", signInSwitch };
}

/**
 * Fills a create-account form (Workday and similar) with your email, a password Coverage generated and already saved
 * in your vault, and your name when it's asked, ticks the form's own terms box, and presses "Create Account"
 * (owner, 2026-10-26: "account creation on Workday … automated"; opt-in in Options). Only on the site the password was
 * saved for; nothing else on the page is touched.
 */
export async function createAccount(email, password, first, last, origin) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  if (window.top !== window || location.origin !== origin) return { ok: false, why: "Not the saved site." };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
  };
  const pw = [...document.querySelectorAll("input[type=password]")].filter(shown);
  if (pw.length < 1) return { ok: false, why: "No password fields." };
  const scope = pw[0].form || pw[0].closest("[role=dialog], form, section, main") || document;
  const set = (el, v) => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };
  const labelOf = (i) => clean(`${i.getAttribute("aria-label") || ""} ${i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.innerText || "" : ""} ${i.name} ${i.id} ${i.autocomplete} ${i.placeholder || ""} ${i.getAttribute("data-automation-id") || ""}`).toLowerCase();
  const inputs = [...scope.querySelectorAll("input")].filter((i) => shown(i) && !["password", "hidden", "checkbox", "radio", "submit", "button"].includes(i.type));
  let filled = 0;
  for (const i of inputs) {
    if (i.value) continue;
    const l = labelOf(i);
    const v = i.type === "email" || /e-?mail|user ?name|login/.test(l) ? email : /first|given/.test(l) ? first : /last|family|surname/.test(l) ? last : "";
    if (!v) continue;
    set(i, v);
    filled++;
  }
  for (const p of pw) set(p, password);
  // The create-account form's own terms / privacy box (Workday's "I agree" under the password).
  for (const c of [...scope.querySelectorAll("input[type=checkbox]")].filter((c) => (shown(c) || shown(c.closest("label") || c)) && !c.checked)) {
    const t = clean(`${c.closest("label")?.innerText || ""} ${c.id ? document.querySelector(`label[for="${CSS.escape(c.id)}"]`)?.innerText || "" : ""} ${c.getAttribute("aria-label") || ""} ${c.getAttribute("data-automation-id") || ""}`);
    if (/agree|terms|privacy|consent|acknowledge|createAccountCheckbox/i.test(t)) c.click();
  }
  // Workday's buttons are a bare <div data-automation-id="click_filter" role="button" aria-label="Sign In"> over the
  // visible button, and the page header has its own "Sign In" (utilityButtonSignIn): pick the matching button nearest
  // the form, never one in the header, and press it with a real click when the extension can (else .click()).
  const pickButton = (re, anchor) => {
    const label = (b) => clean(b.innerText || b.value || b.getAttribute("aria-label") || "");
    const ay = anchor ? anchor.getBoundingClientRect().top : 0;
    const all = [...document.querySelectorAll('button, [role=button], input[type=submit], [data-automation-id="click_filter"]')].filter(
      (b) => shown(b) && re.test(label(b)) && !b.closest('header, nav, [data-automation-id^="utility"], [data-automation-id="globalNavigation"]') && !/^utility/.test(b.getAttribute("data-automation-id") || ""),
    );
    return all.sort((a, b) => Math.abs(a.getBoundingClientRect().top - ay) - Math.abs(b.getBoundingClientRect().top - ay))[0] ?? null;
  };
  const press = async (b) => {
    b.scrollIntoView({ block: "center", behavior: "instant" });
    const r = b.getBoundingClientRect();
    try {
      if (window.top === window && (await chrome.runtime.sendMessage({ type: "cov-click", x: r.left + r.width / 2, y: r.top + r.height / 2 })) === true) return;
    } catch {
      // no real clicks here: fall back
    }
    // Click what a person's click would land on: Workday's click_filter overlay sits on top of the visible button.
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    (top && (b.contains(top) || top.contains(b) || top.getAttribute("data-automation-id") === "click_filter") ? top : b).click();
  };
  const wd = [...document.querySelectorAll('[data-automation-id="createAccountSubmitButton"]')].find(shown);
  const btn = wd || pickButton(/^(create account|create my account|sign up|register|create)$/i, pw[pw.length - 1]);
  if (!btn) return { ok: true, clicked: false, filled, why: "Filled it in; press Create Account yourself." };
  await press(btn);
  return { ok: true, clicked: true, filled };
}

/**
 * On a sign-in page with no saved login, open the site's own "Create Account" (Workday's createAccountLink, or a
 * link / button saying so). Fixed rule; only used with "Create accounts for me" on.
 */
export function switchToCreateAccount() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
  };
  const wd = [...document.querySelectorAll('[data-automation-id="createAccountLink"], [data-automation-id="createAccountButton"]')].find(shown);
  const hit = wd || [...document.querySelectorAll("button, [role=button], a")].find((b) => shown(b) && /^(create (an )?account|sign up|register|new user\??( create (an )?account)?)$/i.test(clean(b.innerText || b.getAttribute("aria-label") || "")));
  if (!hit) return { clicked: false };
  hit.click();
  return { clicked: true };
}

/** On a create-account page, press the "Sign in" link (for an account you already have). Fixed rule, nothing else. */
export function switchToSignIn() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const wd = document.querySelector('[data-automation-id="signInLink"]');
  const hit =
    wd ||
    [...document.querySelectorAll("button, [role=button], a")].find((b) => /^(sign in|log in|already have an account\??\s*sign in)$/i.test(clean(b.innerText || b.getAttribute("aria-label") || "")));
  if (!hit) return { clicked: false };
  hit.click();
  return { clicked: true };
}

/**
 * Types a saved login into this page's sign-in form and presses its Sign in button. Runs only in the top frame,
 * only when the page's origin is exactly the login's (checked again here), only with one visible password box.
 */
export async function signIn(username, password, origin) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  if (window.top !== window || location.origin !== origin) return { ok: false, why: "Not the saved site." };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
  };
  const pw = [...document.querySelectorAll("input[type=password]")].filter(shown);
  if (pw.length !== 1) return { ok: false, why: "Not a single sign-in form." };
  const scope = pw[0].form || pw[0].closest("[role=dialog], section, main") || document;
  const user = [...scope.querySelectorAll("input")].filter(
    (i) => shown(i) && i !== pw[0] && (i.type === "email" || i.type === "text" || /user|email|login/i.test(`${i.name} ${i.id} ${i.autocomplete}`)),
  )[0];
  const set = (el, v) => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };
  // Workday's buttons are a bare <div data-automation-id="click_filter" role="button" aria-label="Sign In"> over the
  // visible button, and the page header has its own "Sign In" (utilityButtonSignIn): pick the matching button nearest
  // the form, never one in the header, and press it with a real click when the extension can (else .click()).
  const pickButton = (re, anchor) => {
    const label = (b) => clean(b.innerText || b.value || b.getAttribute("aria-label") || "");
    const ay = anchor ? anchor.getBoundingClientRect().top : 0;
    const all = [...document.querySelectorAll('button, [role=button], input[type=submit], [data-automation-id="click_filter"]')].filter(
      (b) => shown(b) && re.test(label(b)) && !b.closest('header, nav, [data-automation-id^="utility"], [data-automation-id="globalNavigation"]') && !/^utility/.test(b.getAttribute("data-automation-id") || ""),
    );
    return all.sort((a, b) => Math.abs(a.getBoundingClientRect().top - ay) - Math.abs(b.getBoundingClientRect().top - ay))[0] ?? null;
  };
  const press = async (b) => {
    b.scrollIntoView({ block: "center", behavior: "instant" });
    const r = b.getBoundingClientRect();
    try {
      if (window.top === window && (await chrome.runtime.sendMessage({ type: "cov-click", x: r.left + r.width / 2, y: r.top + r.height / 2 })) === true) return;
    } catch {
      // no real clicks here: fall back
    }
    // Click what a person's click would land on: Workday's click_filter overlay sits on top of the visible button.
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    (top && (b.contains(top) || top.contains(b) || top.getAttribute("data-automation-id") === "click_filter") ? top : b).click();
  };
  if (user && !user.value) set(user, username);
  set(pw[0], password);
  const wd = [...document.querySelectorAll('[data-automation-id="signInSubmitButton"]')].find(shown);
  const btn = wd || pickButton(/^(sign in|log in|login|continue|next)$/i, pw[0]);
  if (!btn) return { ok: true, clicked: false, why: "Typed it in; press Sign in yourself." };
  await press(btn);
  return { ok: true, clicked: true };
}

/**
 * Opens the application form from a job page: Workday's own Apply → "Apply Manually" buttons (by their fixed ids),
 * or Lever's "Apply for this job" link. These only open the form; nothing here submits anything.
 */
export async function startApplication() {
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
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
  };
  // Workday: "Autofill with Resume" when it's offered (the resume is uploaded first and Workday fills the experience
  // and education sections from it; owner, 2026-10-26), else "Apply Manually".
  const manual = () => [...document.querySelectorAll('[data-automation-id="autofillWithResume"], [data-automation-id="applyManually"]')].filter(shown).sort((a) => (a.getAttribute("data-automation-id") === "autofillWithResume" ? -1 : 1))[0];
  const name = (el) => (el.getAttribute("data-automation-id") === "autofillWithResume" ? "Autofill with Resume" : "Apply Manually");
  if (manual()) {
    const m = manual();
    m.click();
    return { clicked: true, label: name(m) };
  }
  const adventure = [...document.querySelectorAll('[data-automation-id="adventureButton"]')].find(shown);
  if (adventure) {
    adventure.click();
    for (let i = 0; i < 30 && !manual(); i++) await sleep(200);
    if (manual()) {
      const m = manual();
      m.click();
      return { clicked: true, label: `Apply → ${name(m)}` };
    }
    return { clicked: true, label: "Apply" };
  }
  const here = location.pathname.replace(/\/$/, "");
  const lever = [...document.querySelectorAll("a[href]")].find((a) => {
    try {
      const u = new URL(a.href);
      return shown(a) && u.origin === location.origin && u.pathname.replace(/\/$/, "") === `${here}/apply`;
    } catch {
      return false;
    }
  });
  if (lever) {
    lever.click();
    return { clicked: true, label: "Apply for this job" };
  }
  return { clicked: false };
}
