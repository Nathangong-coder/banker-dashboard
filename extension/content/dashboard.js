// Runs on the Coverage dashboard's own pages only (see "content_scripts" in manifest.json), never on other sites.
// It is the bridge between the extension and the dashboard tab: the extension asks the dashboard to plan an
// autofill (your application info lives in the dashboard, not in the extension), and the answer comes back here.
// The dashboard side is src/lib/applyBridge.ts. Messages are only exchanged with this same window.
(() => {
  const CHANNEL = "coverage-ext";
  const ALLOWED = new Set(["plan", "submitted"]);
  const pending = new Map();
  const hello = () => window.postMessage({ channel: CHANNEL, kind: "hello", version: chrome.runtime.getManifest().version }, location.origin);

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.channel !== CHANNEL) return;
    if (m.kind === "ping") hello();
    if (m.kind === "response" && typeof m.id === "string" && pending.has(m.id)) {
      const done = pending.get(m.id);
      pending.delete(m.id);
      done(m);
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Only this extension's background worker talks to us.
    if (sender.id !== chrome.runtime.id || !msg || msg.to !== "dashboard") return false;
    if (msg.type === "ping") {
      // The origin lets the worker check this is the dashboard you set (Options), not another local server.
      sendResponse({ ok: true, origin: location.origin });
      return false;
    }
    if (!ALLOWED.has(msg.type)) return false;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      sendResponse({ ok: false, error: "The Coverage tab didn't answer. Reload it and try again." });
    }, 150_000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      sendResponse({ ok: !!m.ok, result: m.result, error: typeof m.error === "string" ? m.error : undefined });
    });
    window.postMessage({ channel: CHANNEL, kind: "request", id, type: msg.type, payload: msg.payload }, location.origin);
    return true; // answered asynchronously
  });

  hello();
})();
