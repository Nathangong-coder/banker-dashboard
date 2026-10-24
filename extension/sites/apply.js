// Job application autofill: the two functions injected into the job page (with chrome.scripting.executeScript, only
// after you click "Autofill this page" in the popup). Both must be self-contained: no imports, no outer variables.
//
// scanForm reads the form (labels, types, options) and tags each field with data-coverage-field. It never reads
// passwords. fillForm types the values the Coverage tab decided into those tagged fields only. Neither function
// clicks a button, submits, or navigates: you review the form and press Submit yourself.

/** Hosts autofill never runs on (LinkedIn automation breaks its User Agreement). */
export const isBlockedSite = (url) => /^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(url ?? "");

export function scanForm() {
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
        if (lab.contains(el) || (stopAt && lab.contains(stopAt)) || lab.querySelector("input,select,textarea")) continue;
        if (lab.htmlFor && document.getElementById(lab.htmlFor) && document.getElementById(lab.htmlFor) !== el) continue;
        const t = clean(lab.innerText);
        if (t) return t;
      }
    }
    return "";
  };

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
    // Typeahead dropdowns (react-select, Workday) don't take typed values reliably: left for you, counted below.
    if (el.getAttribute("role") === "combobox" && el.tagName === "INPUT") continue;

    if (type === "radio" || type === "checkbox") {
      const name = el.name || "";
      const lab = ownLabel(el) || clean(el.value);
      const visibleBox = shown(el) || shown(el.closest("label")) || (el.id && shown(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)));
      if (!visibleBox) continue;
      const key = `${type}:${el.form ? [...document.forms].indexOf(el.form) : -1}:${name || `solo${n}`}`;
      let g = groups.get(key);
      if (!g) {
        const id = `cf${n++}`;
        g = { id, type, els: [], labels: [] };
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
  const combos = document.querySelectorAll('[role="combobox"]').length;
  const main = document.querySelector("main") || document.body;
  return { fields, frames, combos, text: (main.innerText || "").replace(/\s+/g, " ").slice(0, 6000), url: location.href, title: document.title.slice(0, 200) };
}

/**
 * Types the planned values into the tagged fields, highlights them (green = your info, amber = AI draft) and shows a
 * small review box in the corner. `items` come from the Coverage tab; anything that doesn't match a tagged field of
 * the right kind is ignored.
 */
export function fillForm(items, review) {
  const NEVER = /\b(password|passcode|ssn|social security|social insurance|national insurance|tax id|taxpayer|itin|bank account|routing|account number|iban|swift|credit card|card number|cvv|cvc|security code|driver'?s? licen[cs]e|passport number|mother'?s maiden|date of birth|birth ?date|dob)\b/i;
  const setNative = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };
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
        mark(el, it.source);
      } else if (el.type === "radio" || el.type === "checkbox") {
        const target = it.value !== undefined && it.value !== null ? els.find((x) => x.dataset.coverageOption === String(it.value)) : el;
        if (!target || (target.type !== "radio" && target.type !== "checkbox")) throw new Error("Option not found.");
        const want = target.type === "radio" ? true : it.checked ?? true;
        // A click on a radio / checkbox only ticks it (never submits); frameworks listen for the click.
        if (target.checked !== want) target.click();
        mark(target, it.source);
      } else if (typeof it.value === "string") {
        if (el.value && el.value.trim()) {
          failed.push({ label: it.label, why: "Already had something in it: left as is." });
          continue;
        }
        setNative(el, el.maxLength > 0 ? it.value.slice(0, el.maxLength) : it.value);
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
  if (review?.combos) line(`${review.combos} typeahead dropdown${review.combos === 1 ? "" : "s"} on this page: pick those yourself.`, "color:#5d6b7a;font-size:12px;margin-top:4px;");
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
