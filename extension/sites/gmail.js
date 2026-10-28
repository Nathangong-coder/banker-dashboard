// Gmail open tracking (test build, opt-in): registered on https://mail.google.com/* by tracking.js#ensureGmailScript
// only when Options → "Track opens of emails I send from Gmail" is on and the site access was granted.
// A classic content script in the isolated world (no imports): the worker mints ids, keeps the outbox and talks to the
// dashboard (extension/tracking.js#fromGmail). This file only:
//  1. mints a pixel id for each compose window as it opens (so nothing has to be awaited at send time),
//  2. puts the image in at Send / Ctrl+Enter / Schedule send, synchronously before Gmail handles the click, and reports
//     the send (pixelSent) plus your own immediate view of it (pixelSeen: the compose itself loads the image),
//  3. reports your own views of tracked emails (an <img> with a pixel address in what you read) as pixelSeen,
//  4. marks tracked rows in Sent / Scheduled: ✓ tracked, ✓✓ opened.
// Nothing is added to drafts you close without sending: the image goes in only at send time.
(() => {
  if (window.__coverageGmail) return;
  window.__coverageGmail = true;

  // Every Gmail selector in one place. Written 2026-10-28 from Gmail's known markup; checked on live Gmail: pending
  // (the owner's live check, task 7 step 3). If Gmail changes, fix them here.
  const SEL = {
    body: 'div[contenteditable="true"][role="textbox"]', // compose / reply / forward body
    dialog: '[role="dialog"]', // a pop-out compose, or the Schedule send dialog
    send: '[role="button"][data-tooltip^="Send"]', // "Send ‪(Ctrl-Enter)‬"
    moreSend: '[role="button"][aria-label="More send options"], [role="button"][data-tooltip="More send options"]',
    choice: '[role="menuitem"], [role="button"], button', // Schedule send presets / the picker's "Schedule send" button
    recipients: "[data-hovercard-id], span[email]", // To / Cc / Bcc chips
    subject: 'input[name="subjectbox"]',
    subjectHidden: 'input[name="subject"]',
    threadSubject: "h2.hP", // the open conversation's subject (inline replies)
    threadId: "h2[data-legacy-thread-id]",
    row: "tr.zA", // a row in a mail list
    rowSubject: "span.bog",
    rowRecipients: "[email]",
  };
  // Same as extension/pixel.js (pack-extension checks they match). Matches a direct address and Gmail's image proxy
  // (…googleusercontent.com/…#https://<site>/api/o/<id>.gif).
  const PIXEL_PATH_RE = /\/api\/o\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{11})\.gif/;
  const MARK = "data-cov-mark";

  /* ---- talking to the worker ---- */
  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };
  const ask = (type, extra = {}) => {
    if (!alive()) return Promise.reject(new Error("The Coverage extension was reloaded: reload Gmail."));
    return chrome.runtime.sendMessage({ type, ...extra }).then((r) => {
      if (!r?.ok) throw new Error(r?.error || "No answer.");
      return r.result;
    });
  };

  /* ---- 1. one pixel id per compose body, minted when it opens ---- */
  /** @type {WeakMap<Element, {id?: string, url?: string, off?: boolean, pending?: boolean, sentAt?: number}>} */
  const composes = new WeakMap();

  function mintFor(body) {
    if (composes.has(body)) return;
    const st = { pending: true };
    composes.set(body, st);
    ask("pixelMint").then(
      (r) => {
        st.pending = false;
        if (r?.off) st.off = true;
        else if (r && typeof r.id === "string" && typeof r.url === "string") Object.assign(st, { id: r.id, url: r.url });
      },
      () => composes.delete(body), // try again on the next change around it
    );
  }

  /** The compose a body / button belongs to: its pop-out dialog, else the nearest block holding both a body and Send. */
  function composeRoot(el) {
    const dlg = el.closest(SEL.dialog);
    if (dlg && dlg.querySelector(SEL.send) && dlg.querySelector(SEL.body)) return dlg;
    for (let n = el.parentElement, i = 0; n && i < 30; n = n.parentElement, i++) if (n.querySelector(SEL.send) && n.querySelector(SEL.body)) return n;
    return null;
  }
  const bodyIn = (root) => root?.querySelector(SEL.body) ?? null;

  function recipientsOf(root) {
    const out = new Set();
    for (const el of root.querySelectorAll(SEL.recipients)) {
      if (el.closest('[contenteditable="true"]')) continue; // addresses quoted inside the message
      const v = (el.getAttribute("data-hovercard-id") || el.getAttribute("email") || "").trim().toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) out.add(v);
    }
    return [...out].slice(0, 20);
  }

  function subjectOf(root) {
    const v = root.querySelector(SEL.subject)?.value || root.querySelector(SEL.subjectHidden)?.value || "";
    return (v || document.querySelector(SEL.threadSubject)?.textContent || "").trim().slice(0, 300);
  }

  /* ---- 2. at send ---- */
  function pixelIdOf(img) {
    return PIXEL_PATH_RE.exec(img.getAttribute("src") || "")?.[1] ?? null;
  }

  function onSend(body, scheduledFor) {
    const st = composes.get(body);
    if (!st?.id || !st.url) return; // tracking off (no key from the dashboard yet) or the id isn't back yet
    if (st.sentAt && Date.now() - st.sentAt < 3000) return; // mouseup + click of the same press
    const root = composeRoot(body);
    if (!root) return;
    const to = recipientsOf(root);
    if (!to.length) return; // Gmail will refuse it ("specify at least one recipient"); try again on the next Send
    // Tracking images from earlier emails (a forward's or reply's quoted copy) would report this email's readers as
    // opens of the old one: take them out. Only Coverage's own images are touched.
    for (const img of body.querySelectorAll("img")) {
      const id = pixelIdOf(img);
      if (id && id !== st.id) img.remove();
    }
    if (![...body.querySelectorAll("img")].some((img) => pixelIdOf(img) === st.id)) {
      const img = document.createElement("img");
      img.src = st.url;
      img.width = 1;
      img.height = 1;
      img.alt = "";
      img.setAttribute("style", "width:1px;height:1px;border:0;");
      body.appendChild(img);
    }
    st.sentAt = Date.now();
    const at = new Date().toISOString();
    const inPopout = Boolean(body.closest(SEL.dialog));
    const threadId = inPopout ? undefined : document.querySelector(SEL.threadId)?.getAttribute("data-legacy-thread-id") || undefined;
    const msg = { id: st.id, to, subject: subjectOf(root), at };
    if (scheduledFor) msg.scheduledFor = scheduledFor;
    if (threadId) msg.threadId = threadId;
    ask("pixelSent", msg).catch(() => {});
    // The image you just put in loads from your own browser: tell the dashboard that hit is you.
    lastSeen.set(st.id, Date.now());
    ask("pixelSeen", { items: [{ id: st.id, at }] }).catch(() => {});
    // An inline reply box can stay on the page: give it a fresh id for a next email.
    setTimeout(() => {
      if (body.isConnected) {
        composes.delete(body);
        mintFor(body);
      }
    }, 5000);
  }

  /** "Tomorrow morning  Oct 29, 8:00 AM" / the picker's date + time fields → ISO, or undefined. */
  function parseWhen(text) {
    const m = /([A-Z][a-z]{2,8}\.? \d{1,2})(?:, (\d{4}))?,? (\d{1,2}:\d{2}\s?[AP]M)/.exec(text);
    if (!m) return undefined;
    const now = new Date();
    let t = Date.parse(`${m[1].replace(".", "")} ${m[2] ?? now.getFullYear()} ${m[3]}`);
    if (Number.isNaN(t)) return undefined;
    if (!m[2] && t < now.getTime() - 86_400_000) t = new Date(new Date(t).setFullYear(now.getFullYear() + 1)).getTime();
    return new Date(t).toISOString();
  }

  // The compose whose "More send options" arrow was pressed last: the Schedule send dialog that follows belongs to it.
  let scheduling = null; // { body, at }

  function onPress(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !alive()) return;
    const send = t.closest(SEL.send);
    if (send) {
      const body = bodyIn(composeRoot(send));
      if (body) onSend(body);
      return;
    }
    const more = t.closest(SEL.moreSend);
    if (more) {
      const body = bodyIn(composeRoot(more));
      if (body) scheduling = { body, at: Date.now() };
      return;
    }
    if (!scheduling || Date.now() - scheduling.at > 5 * 60_000 || !scheduling.body.isConnected) return;
    const choice = t.closest(SEL.choice);
    const dlg = t.closest(SEL.dialog);
    if (!choice || !dlg || dlg.contains(scheduling.body)) return;
    // A preset ("Tomorrow morning … Oct 29, 8:00 AM"), or the picker's own "Schedule send" button with its fields.
    let when = parseWhen(choice.textContent || "");
    if (!when && /schedule send/i.test(choice.textContent || "") && dlg.querySelector("input")) {
      when = parseWhen([...dlg.querySelectorAll("input")].map((i) => i.value).join(", "));
      if (!when) when = ""; // a time we couldn't read: still a send
    }
    if (when === undefined) return; // "Pick date & time", Cancel, … : not a send
    onSend(scheduling.body, when || undefined);
    scheduling = null;
  }

  // Capture phase on the document, so this runs before Gmail's own handlers. mouseup too: some Gmail buttons act on it.
  document.addEventListener("mouseup", onPress, true);
  document.addEventListener("click", onPress, true);
  document.addEventListener(
    "keydown",
    (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !alive()) return;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const body = t.closest(SEL.body);
        if (body) onSend(body);
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && t.closest(`${SEL.send}, ${SEL.choice}`)) onPress(e);
    },
    true,
  );

  /* ---- 3. your own views of tracked emails ---- */
  const lastSeen = new Map(); // id → ms (one report per id per minute)
  let seenQueue = [];
  let seenTimer = 0;

  function noteImage(img) {
    if (img.closest('[contenteditable="true"]')) return; // a compose (its own image is reported at send)
    const id = pixelIdOf(img);
    if (!id) return;
    const last = lastSeen.get(id);
    if (last && Date.now() - last < 60_000) return;
    lastSeen.set(id, Date.now());
    seenQueue.push({ id, at: new Date().toISOString() });
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
      const items = seenQueue.slice(0, 200);
      seenQueue = [];
      if (items.length) ask("pixelSeen", { items }).catch(() => {});
    }, 2000);
  }

  /* ---- 4. ✓ / ✓✓ in Sent and Scheduled ---- */
  const isListRoute = () => /^#(sent|scheduled)(\/p\d+)?$/.test(location.hash);
  const normSubject = (s) =>
    String(s || "")
      .replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  let index = { at: 0, list: [] };
  const statusCache = new Map(); // id → { at, s }
  let marksTimer = 0;
  let drawing = false;

  const clearMarks = () => document.querySelectorAll(`[${MARK}]`).forEach((m) => m.remove());

  function scheduleMarks() {
    clearTimeout(marksTimer);
    marksTimer = setTimeout(() => drawMarks().catch(() => {}), 800);
  }

  const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  function titleFor(s) {
    if (!s?.opens) return "Tracked · not opened yet";
    const last = s.lastAt && !Number.isNaN(Date.parse(s.lastAt)) ? ` · last ${DAY.format(new Date(s.lastAt))}` : "";
    return `Opened ${s.opens}×${last}${s.forwarded ? " · may have been forwarded" : ""}`;
  }

  async function drawMarks() {
    if (!alive()) return;
    if (!isListRoute()) return clearMarks();
    if (drawing) return scheduleMarks();
    drawing = true;
    try {
      if (Date.now() - index.at > 30_000) index = { at: Date.now(), list: await ask("pixelIndex") };
      const bySubject = new Map();
      for (const e of index.list) {
        const k = normSubject(e.subject);
        if (!bySubject.has(k)) bySubject.set(k, []);
        bySubject.get(k).push(e);
      }
      const rows = [];
      for (const row of document.querySelectorAll(SEL.row)) {
        if (!row.offsetParent) continue; // lists of other views Gmail keeps hidden
        const subjEl = row.querySelector(SEL.rowSubject);
        const cands = subjEl && bySubject.get(normSubject(subjEl.textContent));
        if (!cands) continue;
        const emails = new Set([...row.querySelectorAll(SEL.rowRecipients)].map((el) => (el.getAttribute("email") || "").toLowerCase()));
        const hit = cands.filter((e) => e.to.some((x) => emails.has(x))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
        if (hit) rows.push({ row, subjEl, id: hit.id });
      }
      const need = [...new Set(rows.map((r) => r.id))].filter((id) => !(Date.now() - (statusCache.get(id)?.at ?? 0) < 60_000));
      if (need.length) {
        const res = await ask("pixelStatus", { ids: need.slice(0, 500) }).catch(() => ({}));
        for (const id of need) statusCache.set(id, { at: Date.now(), s: res?.[id] ?? null });
      }
      requestAnimationFrame(() => {
        for (const { row, subjEl, id } of rows) {
          const s = statusCache.get(id)?.s;
          const text = s?.opens ? "✓✓" : "✓";
          const title = titleFor(s);
          const old = row.querySelector(`[${MARK}]`);
          if (old && old.getAttribute(MARK) === id && old.textContent === text && old.title === title) continue;
          old?.remove();
          const mark = document.createElement("span");
          mark.setAttribute(MARK, id);
          mark.textContent = text;
          mark.title = title;
          mark.setAttribute("style", `display:inline;margin-right:4px;font-size:12px;font-weight:700;color:${s?.opens ? "#1a73e8" : "#80868b"};`);
          subjEl.parentElement?.insertBefore(mark, subjEl);
        }
      });
    } finally {
      drawing = false;
    }
  }

  window.addEventListener("hashchange", () => {
    clearMarks();
    scheduleMarks();
  });

  /* ---- watching the page (batched per frame) ---- */
  let added = [];
  let frame = 0;
  function scan(nodes) {
    let rowsChanged = false;
    for (const n of nodes) {
      if (!(n instanceof Element) || !n.isConnected || n.hasAttribute(MARK)) continue;
      if (n.matches(SEL.body)) mintFor(n);
      else for (const b of n.querySelectorAll(SEL.body)) mintFor(b);
      if (n.tagName === "IMG") noteImage(n);
      else for (const img of n.querySelectorAll("img")) noteImage(img);
      if (!rowsChanged && (n.matches(SEL.row) || n.closest(SEL.row) || n.querySelector(SEL.row))) rowsChanged = true;
    }
    if (rowsChanged && isListRoute()) scheduleMarks();
  }
  const observer = new MutationObserver((records) => {
    if (!alive()) return observer.disconnect();
    for (const r of records) {
      if (r.type === "attributes") added.push(r.target);
      else for (const n of r.addedNodes) added.push(n);
    }
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        const nodes = added;
        added = [];
        scan(nodes);
      });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  scan([document.body]);
  scheduleMarks();
})();
