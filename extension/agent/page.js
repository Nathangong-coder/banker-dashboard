// The agent's eyes and hands on a page. Both functions are injected into the tab with chrome.scripting.executeScript,
// so each must be self-contained (no imports, no outer variables).
//
// observePage: numbers every visible interactive element ([0] button "Submit"…), tags it with data-cov-i so actPage can
// find it again, and returns that list plus the page's visible text. Models act by number, which works the same for
// text-only and screenshot modes and for every provider (no pixel coordinates).

export function observePage(maxElements, maxText) {
  for (const el of document.querySelectorAll("[data-cov-i]")) el.removeAttribute("data-cov-i");
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const sel =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=combobox], [role=switch], [contenteditable=""], [contenteditable=true]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
    // In the viewport or within one screen below it (so the model knows to scroll).
    return r.bottom > -50 && r.top < innerHeight * 2;
  };
  const labelOf = (el) => {
    const aria = el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(" ").map((id) => document.getElementById(id)?.innerText || "").join(" ");
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : "";
    const wrap = el.closest("label")?.innerText;
    return clean(aria || forLabel || wrap || el.getAttribute("placeholder") || el.innerText || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("name") || "");
  };
  const lines = [];
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (i >= maxElements) break;
    if (!visible(el) || el.closest("[aria-hidden=true]") || el.disabled) continue;
    el.setAttribute("data-cov-i", String(i));
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type");
    const role = el.getAttribute("role");
    let desc = role ? `${tag} role=${role}` : type ? `${tag} type=${type}` : tag;
    const label = cut(labelOf(el), 90);
    let extra = "";
    if (tag === "input" && (type === "checkbox" || type === "radio")) extra = el.checked ? " [checked]" : " [unchecked]";
    else if (tag === "select") extra = ` value="${cut(clean(el.selectedOptions[0]?.text), 40)}" options=[${[...el.options].slice(0, 15).map((o) => `"${cut(clean(o.text), 30)}"`).join(", ")}]`;
    else if ("value" in el && el.value && tag !== "button") extra = ` value="${cut(clean(String(el.value)), 60)}"`;
    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      if (href && !href.startsWith("javascript:")) extra += ` href="${cut(href, 80)}"`;
    }
    const r = el.getBoundingClientRect();
    const below = r.top > innerHeight ? " (below the fold)" : "";
    lines.push(`[${i}] ${desc} "${label}"${extra}${below}`);
    i++;
  }
  const text = clean(document.body?.innerText || "");
  return {
    url: location.href,
    title: document.title,
    elements: lines,
    text: cut(text, maxText),
    scroll: { y: Math.round(scrollY), max: Math.max(0, document.documentElement.scrollHeight - innerHeight) },
  };
}

/** Do one action. Returns { ok, note }. Typing sets the value the way React / Vue inputs expect (native setter + events). */
export function actPage(action) {
  const find = (i) => document.querySelector(`[data-cov-i="${Number(i)}"]`);
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    fire(el, "input");
    fire(el, "change");
  };
  try {
    if (action.type === "scroll") {
      window.scrollBy({ top: (action.direction === "up" ? -1 : 1) * innerHeight * 0.8, behavior: "instant" });
      return { ok: true, note: `scrolled ${action.direction === "up" ? "up" : "down"}` };
    }
    const el = find(action.index);
    if (!el) return { ok: false, note: `no element [${action.index}] (the page changed; look again)` };
    el.scrollIntoView({ block: "center", behavior: "instant" });
    if (action.type === "click") {
      el.focus?.();
      el.click();
      return { ok: true, note: "clicked" };
    }
    if (action.type === "type") {
      el.focus?.();
      const text = String(action.text ?? "");
      if (el.isContentEditable) {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, text);
      } else setValue(el, text);
      if (action.enter) {
        for (const t of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        el.form?.requestSubmit?.();
      }
      return { ok: true, note: `typed ${text.length} characters${action.enter ? " + Enter" : ""}` };
    }
    if (action.type === "select") {
      if (!(el instanceof HTMLSelectElement)) return { ok: false, note: "that element isn't a dropdown; click it instead" };
      const want = String(action.value ?? "").toLowerCase();
      const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) ?? [...el.options].find((o) => o.text.toLowerCase().includes(want));
      if (!opt) return { ok: false, note: `no option "${action.value}"` };
      setValue(el, opt.value);
      return { ok: true, note: `selected "${opt.text.trim()}"` };
    }
    return { ok: false, note: `unknown action "${action.type}"` };
  } catch (e) {
    return { ok: false, note: String(e?.message || e) };
  }
}

/** Short description of the element an action targets, for the step log and the confirmation prompt. */
export function describeTarget(index) {
  const el = document.querySelector(`[data-cov-i="${Number(index)}"]`);
  if (!el) return "";
  return (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 80);
}
