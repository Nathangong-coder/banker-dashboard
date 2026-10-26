// Injected into every page of the recording (context.addInitScript). Two jobs:
// 1. Privacy: blur every row that shows a real person (Coverage tables/lists, Gmail threads, Calendar events) unless it
//    is the demo's "Test Account" row.
// 2. A visible cursor + click ripple, since Playwright's video doesn't draw the mouse.
(() => {
  if (window.__demoOverlay) return;
  window.__demoOverlay = true;
  const KEEP = /test account|ngong7053/i;
  const ROWS = [
    "main tbody tr", // Coverage tables (contacts, drafts, follow-ups, firm sheet)
    "main ul > li", // Coverage lists (Tonight, calendar rows, firm summary)
    "[role=dialog] tbody tr",
    "tr.zA", // Gmail thread rows
    "[data-eventid]", // Calendar event chips
    "[data-eventchip]",
  ].join(",");
  const style = document.createElement("style");
  style.textContent = `
    .demo-blur { filter: blur(6px) !important; }
    #demo-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -2px 0 0 -2px; pointer-events: none;
      transition: transform .08s ease-out; }
    #demo-cursor.down { transform: scale(.82); }
    .demo-ripple { position: fixed; z-index: 2147483646; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
      border: 3px solid rgba(31,122,92,.85); pointer-events: none; animation: demo-ripple .55s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
    html { scroll-behavior: smooth; }`;

  const blurPass = () => {
    for (const el of document.querySelectorAll(ROWS)) {
      const keep = KEEP.test(el.textContent || "");
      el.classList.toggle("demo-blur", !keep);
    }
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      blurPass();
    });
  };

  const cursor = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cursor.id = "demo-cursor";
  cursor.setAttribute("viewBox", "0 0 24 24");
  cursor.innerHTML =
    '<path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#0e1a2b" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>';
  const mount = () => {
    if (!document.documentElement) return;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(cursor);
    const pos = window.__demoPos || { x: 960, y: 540 };
    cursor.style.left = pos.x + "px";
    cursor.style.top = pos.y + "px";
    new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    blurPass();
  };
  document.addEventListener("mousemove", (e) => {
    cursor.style.left = e.clientX + "px";
    cursor.style.top = e.clientY + "px";
  }, true);
  document.addEventListener("mousedown", (e) => {
    cursor.classList.add("down");
    const r = document.createElement("div");
    r.className = "demo-ripple";
    r.style.left = e.clientX + "px";
    r.style.top = e.clientY + "px";
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  document.addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
