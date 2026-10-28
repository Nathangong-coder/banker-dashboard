// Open tracking, extension side (the Gmail content script is Task 7; the dashboard side is src/lib/applyBridge.ts).
// - The dashboard hands over the account's pixel key; the worker mints pixel ids offline for emails written in Gmail.
// - Sends / "seen" times from Gmail wait in an outbox in chrome.storage.local until a dashboard tab can take them.
// No state lives in worker globals (the worker is stopped at will): everything is in chrome.storage.local.
// `ask` is background.js#askDashboard, passed in so this file stays free of the rest of the worker.
import { mintPixelId, pixelUrl, PIXEL_PATH_RE } from "./pixel.js";

export const GMAIL_ORIGIN = "https://mail.google.com";
export const TRACKING_TYPES = new Set(["pixelMint", "pixelSent", "pixelSeen", "pixelStatus"]);
const OUTBOX_MAX = 500;
const MARKS_MAX = 2000;
const ID_RE = /^[A-Za-z0-9_-]{1,60}\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{11}$/;
const iso = (v) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

// Read-modify-write on the outbox arrays must not interleave (it only orders calls inside one worker run).
let chain = Promise.resolve();
const locked = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

/** On each dashboard hello: copy the pixel key (or its absence) into storage. */
export async function syncPixelKey(ask) {
  const k = await ask("pixelKey", {});
  if (k && typeof k.key === "string" && typeof k.base === "string" && typeof k.accountId === "string" && /^https?:\/\//.test(k.base)) {
    await chrome.storage.local.set({ pixel: { key: k.key.slice(0, 200), base: k.base.slice(0, 300).replace(/\/+$/, ""), accountId: k.accountId.slice(0, 60) } });
  } else {
    await chrome.storage.local.remove("pixel");
  }
}

const push = (arr, item) => [...(Array.isArray(arr) ? arr : []), item].slice(-OUTBOX_MAX);

const MAX_AGE_MS = 30 * 24 * 3600_000;
const fresh = (at) => Date.now() - Date.parse(at) < MAX_AGE_MS;

/**
 * Hand queued sends / seen times to the dashboard. The lock is held only for storage reads and writes, never across
 * dashboard calls. Items leave the outbox only when the dashboard took them (by id, seen by id+at), or when they fail
 * the extension's own checks (bad id, older than 30 days). Any dashboard error keeps them for the next try.
 * The dashboard side is idempotent (registerTrackedIn merges by id, addSeen skips known times).
 */
export async function flushOutbox(ask) {
  const snap = await locked(async () => {
    const S = await chrome.storage.local.get(["pixelOutbox", "pixelSeenOutbox"]);
    const sends = (S.pixelOutbox ?? []).filter((m) => m && ID_RE.test(String(m.id)) && iso(m.at) && fresh(m.at));
    const seen = (S.pixelSeenOutbox ?? []).filter((x) => x && ID_RE.test(String(x.id)) && iso(x.at) && fresh(x.at));
    await chrome.storage.local.set({ pixelOutbox: sends, pixelSeenOutbox: seen });
    return { sends, seen };
  });
  const sentIds = new Set();
  const seenKeys = new Set();
  let down = false;
  for (const m of snap.sends) {
    try {
      await ask("pixelSent", m);
      sentIds.add(m.id);
    } catch (e) {
      if (/reach|answer|Reload/i.test(String(e?.message))) {
        down = true;
        break;
      }
    }
  }
  // The dashboard keeps a stub for a seen time whose send isn't registered yet, so one rejected send never blocks these.
  if (!down) {
    for (let i = 0; i < snap.seen.length; i += 200) {
      const batch = snap.seen.slice(i, i + 200);
      try {
        await ask("pixelSeen", { items: batch });
        for (const x of batch) seenKeys.add(x.id + "|" + x.at);
      } catch {
        break;
      }
    }
  }
  await locked(async () => {
    const S = await chrome.storage.local.get(["pixelOutbox", "pixelSeenOutbox"]);
    await chrome.storage.local.set({
      pixelOutbox: (S.pixelOutbox ?? []).filter((m) => !sentIds.has(m.id)),
      pixelSeenOutbox: (S.pixelSeenOutbox ?? []).filter((x) => !seenKeys.has(x.id + "|" + x.at)),
    });
  });
}

/** Messages from the Gmail content script. `ask` talks to the dashboard tab; sender is checked by the caller. */
export async function fromGmail(msg, ask) {
  const { pixel } = await chrome.storage.local.get("pixel");
  if (msg.type === "pixelMint") {
    if (!pixel) return { off: true };
    const id = await mintPixelId(pixel.accountId, pixel.key);
    return { url: pixelUrl(pixel.base, id), id };
  }
  if (msg.type === "pixelSent") {
    const to = (Array.isArray(msg.to) ? msg.to : []).filter((x) => typeof x === "string").map((x) => x.slice(0, 200));
    if (!ID_RE.test(String(msg.id)) || to.length > 20 || !iso(msg.at)) throw new Error("Bad message.");
    const item = { id: msg.id, to, subject: String(msg.subject ?? "").slice(0, 300), at: msg.at };
    if (iso(msg.scheduledFor)) item.scheduledFor = msg.scheduledFor;
    if (typeof msg.threadId === "string") item.threadId = msg.threadId.slice(0, 80);
    await locked(async () => {
      const { pixelOutbox } = await chrome.storage.local.get("pixelOutbox");
      await chrome.storage.local.set({ pixelOutbox: push(pixelOutbox, item) });
    });
    flushOutbox(ask).catch(() => {});
    return true;
  }
  if (msg.type === "pixelSeen") {
    const items = (Array.isArray(msg.items) ? msg.items : []).slice(0, 200).filter((x) => x && ID_RE.test(String(x.id)) && iso(x.at)).map((x) => ({ id: x.id, at: x.at }));
    if (!items.length) return true;
    await locked(async () => {
      const { pixelSeenOutbox = [] } = await chrome.storage.local.get("pixelSeenOutbox");
      await chrome.storage.local.set({ pixelSeenOutbox: [...pixelSeenOutbox, ...items].slice(-OUTBOX_MAX) });
    });
    flushOutbox(ask).catch(() => {});
    return true;
  }
  if (msg.type === "pixelStatus") {
    const ids = (Array.isArray(msg.ids) ? msg.ids : []).slice(0, 500).filter((x) => typeof x === "string" && ID_RE.test(x));
    const { pixelMarks = {} } = await chrome.storage.local.get("pixelMarks");
    let fresh;
    try {
      fresh = await ask("pixelStatus", { ids });
    } catch {
      // No dashboard tab open: answer from what we last heard.
    }
    if (fresh && typeof fresh === "object") {
      const merged = { ...pixelMarks, ...fresh };
      const keys = Object.keys(merged);
      for (const k of keys.slice(0, Math.max(0, keys.length - MARKS_MAX))) delete merged[k];
      await chrome.storage.local.set({ pixelMarks: merged });
    }
    const src = fresh && typeof fresh === "object" ? fresh : pixelMarks;
    return Object.fromEntries(ids.filter((i) => src[i]).map((i) => [i, src[i]]));
  }
  throw new Error("Unknown message.");
}

export { PIXEL_PATH_RE };
