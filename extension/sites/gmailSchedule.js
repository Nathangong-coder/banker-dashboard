// Schedule a Gmail draft with Gmail's own Schedule send (test build; owner, 2026-11-23). Google's API can't create a
// Schedule-send email, so the worker (background.js#scheduleInGmail) opens the draft in your Gmail tab
// (#drafts?compose=<message id>) and runs this in the page: check the recipient (and subject when given), open
// More send options → Schedule send → Pick date & time, type the date and time, press Schedule send, wait for Gmail's
// "Send scheduled". It never presses Send. Clicks and typing go through the worker as real input (cov-click /
// cov-type), which also draws the cursor you see.
// Self-contained (passed to chrome.scripting.executeScript as `func`): no imports, no outer variables.

export async function scheduleDraftInPage(item, when) {
  // Every Gmail selector / word in one place. Written 2026-11-23 from Gmail's markup; check on live Gmail first.
  const SEL = {
    moreSend: '[role="button"][aria-label="More send options"], [role="button"][data-tooltip="More send options"]',
    send: '[role="button"][data-tooltip^="Send"]',
    subject: 'input[name="subjectbox"]',
    recipients: "[data-hovercard-id], span[email], input[name='to']",
    menuItem: '[role="menuitem"], [role="button"], button, [role="menuitemradio"]',
    dateInput: 'input[aria-label="Date"], input[type="date"]',
    timeInput: 'input[aria-label="Time"], input[type="time"]',
  };
  const sleep = (ms) => chrome.runtime.sendMessage({ type: "cov-sleep", ms }).catch(() => new Promise((r) => setTimeout(r, ms)));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden";
  };
  const waitFor = async (find, ms = 12_000) => {
    for (let t = 0; t < ms; t += 300) {
      const el = find();
      if (el) return el;
      await sleep(300);
    }
    return null;
  };
  const textOf = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
  // Never "Send" by itself: only controls whose words say schedule / pick / date.
  const isPlainSend = (el) => /^send(\s*\(.*\))?$/i.test(textOf(el)) || (el.matches(SEL.send) && !/schedule/i.test(textOf(el)));
  const click = async (el) => {
    if (isPlainSend(el)) throw new Error("refused to press Send");
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const real = window.top === window && (await chrome.runtime.sendMessage({ type: "cov-click", x: r.left + r.width / 2, y: r.top + r.height / 2 }).catch(() => false)) === true;
    if (!real) for (const type of ["mousedown", "mouseup", "click"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    await sleep(500);
  };
  const type = async (input, text) => {
    input.focus();
    input.select?.();
    const real = window.top === window && (await chrome.runtime.sendMessage({ type: "cov-type", text }).catch(() => false)) === true;
    if (!real) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(250);
  };
  const byWords = (re, root = document) => [...root.querySelectorAll(SEL.menuItem)].filter(visible).find((el) => re.test(textOf(el)) && !isPlainSend(el));

  // 1. The draft's compose window (the newest one with a send-options arrow).
  const more = await waitFor(() => [...document.querySelectorAll(SEL.moreSend)].filter(visible).pop());
  if (!more) return { ok: false, error: "the draft didn't open (deleted or already sent?)" };
  const compose = more.closest('[role="dialog"], form, .M9, table') || document;
  // 2. Is it the right email?
  const to = item.to.toLowerCase();
  const chips = [...compose.querySelectorAll(SEL.recipients)].map((el) => (el.getAttribute("email") || el.getAttribute("data-hovercard-id") || el.value || el.textContent || "").toLowerCase());
  if (!chips.some((c) => c.includes(to))) return { ok: false, error: `draft changed (it isn't to ${item.to})` };
  if (item.subject) {
    const subj = compose.querySelector(SEL.subject)?.value ?? "";
    if (!subj.toLowerCase().includes(item.subject.toLowerCase().replace(/^re:\s*/, ""))) return { ok: false, error: "draft changed (different subject)" };
  }
  // 3. More send options → Schedule send → Pick date & time.
  await click(more);
  const sched = await waitFor(() => byWords(/^schedule send$/i), 5_000);
  if (!sched) return { ok: false, error: "Gmail's Schedule send option wasn't there" };
  await click(sched);
  const pick = await waitFor(() => byWords(/pick date (&|and) time/i), 5_000);
  if (!pick) return { ok: false, error: "Gmail's \"Pick date & time\" wasn't there" };
  await click(pick);
  // 4. Date and time, then the dialog's Schedule send.
  const date = await waitFor(() => [...document.querySelectorAll(SEL.dateInput)].filter(visible).pop(), 5_000);
  const time = [...document.querySelectorAll(SEL.timeInput)].filter(visible).pop();
  if (!date || !time) return { ok: false, error: "the date / time boxes weren't there" };
  await type(date, when.date);
  await type(time, when.time);
  const dialog = date.closest('[role="dialog"], [role="alertdialog"]') || document;
  const go = byWords(/^schedule send$/i, dialog);
  if (!go) return { ok: false, error: "the dialog's Schedule send button wasn't there" };
  await click(go);
  // 5. Gmail confirms ("Send scheduled for …"); the compose window closes.
  const done = await waitFor(() => /send scheduled|scheduled for/i.test(document.body.innerText.slice(-4000) + ([...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join(" "))), 10_000);
  return done ? { ok: true } : { ok: false, error: "no \"Send scheduled\" from Gmail (check the draft)" };
}
