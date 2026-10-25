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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim().slice(0, 600);
  const shown = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.closest('[aria-hidden="true"],[hidden],[inert],template')) return false;
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
  const visibleOptions = () => [...document.querySelectorAll('[role="option"]')].filter(shown);
  const placeholderish = (t) => !t || /^(select|select one|choose|choose one|please select|--|—|-)\b/i.test(t);

  const fields = [];
  let n = 0;
  const tag = (el, id) => el.setAttribute("data-coverage-field", id);
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
    const label = ownLabel(el) || containerLabel(el) || clean(el.getAttribute("placeholder") || el.getAttribute("name") || "");
    const id = `cf${n++}`;
    tag(el, id);
    // A text box that only takes a picked suggestion (react-select, Workday search boxes).
    if (el.tagName === "INPUT" && el.getAttribute("role") === "combobox") {
      const box = el.closest("[class*='container' i], [data-automation-id], div");
      const picked = box?.querySelector("[class*='singleValue' i], [data-automation-id='selectedItem'], [class*='selected' i]");
      fields.push({ id, kind: "typeahead", label, required: el.required || el.getAttribute("aria-required") === "true", filled: !!clean(picked?.innerText) || !!el.value.trim() });
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
  return { fields, frames, text: (main.innerText || "").replace(/\s+/g, " ").slice(0, 6000), url: location.href, title: document.title.slice(0, 200) };
}

/**
 * Types the planned values into the tagged fields, highlights them (green = your info, amber = AI draft) and shows a
 * small review box in the corner. `items` come from the Coverage tab; anything that doesn't match a tagged field of
 * the right kind is ignored. Dropdowns and suggestion boxes are opened and the matching option clicked.
 */
export async function fillForm(items, review) {
  const NEVER = /\b(password|passcode|ssn|social security|social insurance|national insurance|tax id|taxpayer|itin|bank account|routing|account number|iban|swift|credit card|card number|cvv|cvc|security code|driver'?s? licen[cs]e|passport number|mother'?s maiden|date of birth|birth ?date|dob)\b/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const visibleOptions = () => [...document.querySelectorAll('[role="option"]')].filter(shown);
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
  const done = [];
  const failed = [];
  for (const it of items) {
    const els = [...document.querySelectorAll(`[data-coverage-field="${CSS.escape(String(it.id))}"]`)];
    const el = els[0];
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
      } else if (el.tagName === "INPUT" && el.getAttribute("role") === "combobox") {
        // Suggestion box: type, wait for the list, click the best match (or clear it again).
        if (typeof it.value !== "string" || !it.value) continue;
        el.focus();
        el.click();
        setNative(el, it.value);
        let opts = [];
        for (let i = 0; i < 25; i++) {
          await sleep(100);
          opts = visibleOptions();
          if (opts.length && !opts.every((o) => /loading|searching|no (results|options)/i.test(o.innerText))) break;
        }
        const opt = best(opts, [it.value, ...(Array.isArray(it.alts) ? it.alts : [])]);
        if (!opt) {
          setNative(el, "");
          escape();
          throw new Error("None of its suggestions matched: pick it yourself.");
        }
        pressOption(opt);
        await sleep(150);
        mark(el, it.source);
      } else if (typeof it.value === "string") {
        if (el.value && el.value.trim()) {
          failed.push({ label: it.label, why: "Already had something in it: left as is." });
          continue;
        }
        setNative(el, el.maxLength > 0 ? it.value.slice(0, el.maxLength) : it.value);
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        mark(el, it.source);
      } else continue;
      done.push(it.label);
    } catch (e) {
      failed.push({ label: it.label, why: e instanceof Error ? e.message : "Couldn't fill it." });
    }
  }

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
  return { filled: done.length, failed };
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
export function clickNext() {
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
    const ok = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")].filter((b) => shown(b) && ALLOW.test(text(b)) && !DENY.test(text(b)));
    if (ok.length !== 1) return { clicked: false, why: ok.length ? "More than one Next button: go on yourself." : "No Next button on this page." };
    pick = ok[0];
  }
  const label = text(pick);
  if (DENY.test(label)) return { clicked: false, why: `Won't press "${label}".` };
  pick.click();
  return { clicked: true, label };
}
