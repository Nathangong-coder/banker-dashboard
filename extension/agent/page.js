// The agent's eyes and hands on a page. Both functions are injected into the tab with chrome.scripting.executeScript,
// so each must be self-contained (no imports, no outer variables).
//
// observePage: numbers every visible interactive element ([0] button "Submit"…), tags it with data-cov-i so actPage can
// find it again, and returns that list plus the page's visible text. Models act by number, which works the same for
// text-only and screenshot modes and for every provider (no pixel coordinates).

export function observePage(maxElements, maxText, formOnly = false) {
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
    // Filling: form fields and the buttons that move it on; not the site's menus, links and footer.
    if (formOnly) {
      if (el.closest("nav, header, footer, [role=navigation], [role=banner], [role=contentinfo]")) continue;
      if (el.tagName === "A" && !/apply|next|continue|start|add|upload|save|submit|review|back|sign in|log in/i.test(clean(el.innerText || el.getAttribute("aria-label") || ""))) continue;
    }
    el.setAttribute("data-cov-i", String(i));
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type");
    const role = el.getAttribute("role");
    let desc = role ? `${tag} role=${role}` : type ? `${tag} type=${type}` : tag;
    // Pick-from-a-list fields, so the model uses "choose" instead of typing into them.
    const kind =
      tag === "select" || el.getAttribute("aria-haspopup") === "listbox" || (role === "combobox" && tag !== "input") || (tag === "button" && /^(select( one)?|choose|--)/i.test(clean(el.innerText)))
        ? " [dropdown]"
        : tag === "input" && (role === "combobox" || el.getAttribute("aria-autocomplete") || el.getAttribute("list"))
          ? " [typeahead]"
          : "";
    desc += kind;
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
export async function actPage(action) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
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
        // Fill mode never submits a form with Enter (it only presses the key, for search boxes / typeaheads).
        if (!action.noSubmit) el.form?.requestSubmit?.();
      }
      return { ok: true, note: `typed ${text.length} characters${action.enter ? " + Enter" : ""}` };
    }
    if (action.type === "choose") {
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
      const want = clean(String(action.value ?? "")).toLowerCase();
      if (!want) return { ok: false, note: "say which option (value)" };
      const norm = (s) => clean(s).toLowerCase();
      const pick = (opts) =>
        opts.find((o) => norm(o.innerText || o.text) === want) ||
        opts.find((o) => norm(o.innerText || o.text).startsWith(want)) ||
        opts.find((o) => norm(o.innerText || o.text).includes(want)) ||
        opts.find((o) => want.split(" ").filter((w) => w.length > 2).every((w) => norm(o.innerText || o.text).includes(w)));
      if (el instanceof HTMLSelectElement) {
        const opt = pick([...el.options]);
        if (!opt) return { ok: false, options: [...el.options].slice(0, 60).map((o) => clean(o.text)).filter(Boolean), note: `no option like "${action.value}"; options: ${[...el.options].slice(0, 12).map((o) => clean(o.text)).join(" | ")}` };
        setValue(el, opt.value);
        return { ok: true, note: `selected "${clean(opt.text)}"` };
      }
      const shown = (o) => {
        const r = o.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && getComputedStyle(o).visibility !== "hidden";
      };
      // react-select (Greenhouse) options have no role: ids like react-select-3-option-0.
      const options = () => [...document.querySelectorAll('[role="option"], [role="menuitem"], [id*="-option-"], [class*="__option"], li[id*="option" i], [data-automation-id="promptOption"]')].filter(shown);
      const press = (o) => {
        for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) o.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        o.click();
      };
      // Close an open list (after a miss) so the next try starts clean.
      const escape = () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      el.focus?.();
      if (el instanceof HTMLInputElement) {
        // A typeahead: type a few words to filter, then pick from the suggestions.
        setValue(el, String(action.value).slice(0, 40));
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      } else press(el);
      // react-select opens on mousedown of its control / ArrowDown.
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
      let opt;
      for (let i = 0; i < 15 && !opt; i++) {
        await sleep(200);
        opt = pick(options());
      }
      if (!opt && el instanceof HTMLInputElement) {
        // Some boxes search on Enter.
        for (const t of ["keydown", "keyup"]) el.dispatchEvent(new KeyboardEvent(t, { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        for (let i = 0; i < 10 && !opt; i++) {
          await sleep(250);
          opt = pick(options());
        }
      }
      if (!opt) {
        const seen = options().slice(0, 60).map((o) => clean(o.innerText)).filter(Boolean);
        escape();
        return { ok: false, options: seen, note: seen.length ? `no option like "${action.value}"; options shown: ${seen.slice(0, 15).join(" | ")}` : `no list opened for "${action.value}" (try click, then look)` };
      }
      press(opt);
      return { ok: true, note: `chose "${clean(opt.innerText).slice(0, 60)}"` };
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
