/**
 * Email open-tracking pixel ids (lib/pixel.ts and its extension twin):
 *   npm run check:opens
 */
import { netOf, labelHits, openSummary, openRate, readingHeatmap, type TrackedMessage, type RawHit } from "../src/lib/opens";
import { mintPixelId, verifyPixelId, pixelKeyFor, pixelUrl, PIXEL_PATH_RE } from "../src/lib/pixel";

let failed = 0;
const check = (what: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok ? `\n       got: ${JSON.stringify(detail)}` : ""}`);
};

const SECRET = "test-server-secret";
const ACCT = "acct_ABCDEFGHIJKLMNOP";
const keyFor = (a: string) => pixelKeyFor(SECRET, a);
const key = await keyFor(ACCT);

const id = await mintPixelId(ACCT, key);
const ok = await verifyPixelId(id, keyFor);
check("mint -> verify round trip", ok?.accountId === ACCT, ok);
check("ids are unique", id !== (await mintPixelId(ACCT, key)));

const parts = id.split(".");
const flipped = id.slice(0, -1) + (id.endsWith("A") ? "B" : "A");
const otherKey = await pixelKeyFor(SECRET, "acct_ZZZZZZZZZZZZZZZZ");
const forged = await mintPixelId(ACCT, otherKey);
check("verify rejects changed last char", (await verifyPixelId(flipped, keyFor)) === null);
check("verify rejects another account's key", (await verifyPixelId(forged, keyFor)) === null);
check("verify rejects missing parts", (await verifyPixelId(parts.slice(0, 2).join("."), keyFor)) === null);
check("verify rejects 500-char garbage", (await verifyPixelId("x".repeat(500), keyFor)) === null);

const twin = await import("../extension/pixel.js");
const tid = await twin.mintPixelId(ACCT, key);
check("extension twin id verifies in TS", (await verifyPixelId(tid, keyFor))?.accountId === ACCT, tid);
const proxied = (i: string) => `https://ci3.googleusercontent.com/meips/AbC=s0-d-e1-ft#https://x.app/api/o/${i}.gif`;
check("both regexes find the id in a Gmail proxy URL", PIXEL_PATH_RE.exec(proxied(id))?.[1] === id && twin.PIXEL_PATH_RE.exec(proxied(id))?.[1] === id);
check("pixelUrl agrees", pixelUrl("https://x.app", id) === twin.pixelUrl("https://x.app", id) && pixelUrl("https://x.app", id) === `https://x.app/api/o/${id}.gif`);

// The mint day (60-day window) and ids from before it existed.
{
  const { pixelExpired, OPEN_DAYS } = await import("../src/lib/pixel");
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 9, 28, 12);
  const today = await mintPixelId(ACCT, key, now);
  const v = await verifyPixelId(today, keyFor);
  check("id carries the mint day", today.split(".").length === 4 && v?.day === Math.floor(now / DAY), v);
  const d = today.split(".")[1];
  const moved = today.replace(`.${d}.`, `.${(parseInt(d, 36) + 30).toString(36)}.`);
  check("verify rejects a moved day", (await verifyPixelId(moved, keyFor)) === null);
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b64 = (b: ArrayBuffer) => Buffer.from(b).toString("base64url");
  const rand = "AbCdEfGhIjKl";
  const legacy = `${ACCT}.${rand}.${b64(await crypto.subtle.sign("HMAC", k, enc.encode(`${ACCT}.${rand}`))).slice(0, 11)}`;
  const lv = await verifyPixelId(legacy, keyFor);
  check("a first-version id (no day) still verifies, never expires", lv?.accountId === ACCT && lv.day === undefined && !pixelExpired(lv.day, now));
  check("regexes find old and new ids", PIXEL_PATH_RE.exec(proxied(legacy))?.[1] === legacy && twin.PIXEL_PATH_RE.exec(proxied(today))?.[1] === today);
  const old = await verifyPixelId(await mintPixelId(ACCT, key, now - (OPEN_DAYS + 1) * DAY), keyFor);
  const edge = await verifyPixelId(await mintPixelId(ACCT, key, now - OPEN_DAYS * DAY), keyFor);
  check("opens stop after 60 days", pixelExpired(old?.day, now) && !pixelExpired(edge?.day, now) && !pixelExpired(v?.day, now));
  const tday = (await verifyPixelId(await twin.mintPixelId(ACCT, key, now), keyFor))?.day;
  check("extension twin mints the same day", tday === Math.floor(now / DAY), tday);
}

// The same reader reopening within 30 minutes is one open; a scanner's burst still passes.
{
  const { repeatGate } = await import("../src/lib/opens");
  const gate = repeatGate(30 * 60_000, 10_000, 3);
  const t0 = 5_000_000;
  check("repeat: first open recorded", gate("e|r1", t0));
  check("repeat: a burst within 10 s passes (scanner signal kept)", gate("e|r1", t0 + 1500) && gate("e|r1", t0 + 9000));
  check("repeat: a reopen 2 min later is collapsed", !gate("e|r1", t0 + 120_000) && !gate("e|r1", t0 + 29 * 60_000));
  check("repeat: another reader or email still counts", gate("e|r2", t0 + 120_000) && gate("f|r1", t0 + 120_000));
  check("repeat: after 30 min it's a new open", gate("e|r1", t0 + 31 * 60_000));
}

// ---- classification (lib/opens.ts) ----
const T = (s: string) => `2026-10-27T${s}.000Z`;
const UA_OLK_WIN = "Mozilla/5.0 (Windows NT 10.0; Microsoft Outlook 16.0.17928)";
const UA_OLK_IOS = "Outlook-iOS/4.2431.0 (iPhone; iOS 18.0)";
const UA_GMAIL = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
let hn = 0;
const hit = (at: string, o: Partial<RawHit> = {}): RawHit => ({ id: `h${hn++}`, at, ua: UA_OLK_WIN, ipHash: "ip1", net: "other", ...o });
const msg = (o: Partial<TrackedMessage> = {}): TrackedMessage => ({
  id: "m", to: ["a@gs.com"], subject: "s", kind: "first", createdAt: T("09:00:00"), sentAt: T("10:00:00"),
  source: "coverage", hits: [], seen: [], ...o,
});
const labels = (m: TrackedMessage, mx: Record<string, "google" | "other"> = {}) => labelHits(m, mx).map((l) => l.label);

check("self-seen window", labels(msg({ seen: [T("11:00:00")], hits: [hit(T("11:00:30"))] })).join() === "you");
check("before sentAt", labels(msg({ hits: [hit(T("09:55:00"))] })).join() === "you");
check("proxy + non-Google MX is you", labels(msg({ hits: [hit(T("12:00:00"), { net: "google-proxy", ua: UA_GMAIL })] }), { "gs.com": "other" }).join() === "you");
check("proxy + Google MX is person", labels(msg({ to: ["a@startup.com"], hits: [hit(T("12:00:00"), { net: "google-proxy", ua: UA_GMAIL })] }), { "startup.com": "google" }).join() === "person");
const burst = msg({ hits: [hit(T("10:00:20"), { ipHash: "a" }), hit(T("10:00:21"), { ipHash: "b" }), hit(T("10:00:22"), { ipHash: "c" })] });
check("scanner burst is one scanner", labels(burst).join() === "scanner" && openSummary(burst, {}).opens === 0, labels(burst));
check("apple IP", netOf("17.58.1.2", "Mozilla/5.0") === "apple" && openSummary(msg({ hits: [hit(T("12:00:00"), { net: netOf("17.58.1.2", "Mozilla/5.0") })] }), {}).opens === 0);
check("netOf other kinds", netOf("40.95.1.1", "Mozilla/5.0") === "microsoft" && netOf("148.163.130.5", "Mozilla/5.0") === "scanner" && netOf("1.2.3.4", "python-requests/2.3") === "scanner" && netOf("1.2.3.4", "Mozilla/5.0 GoogleImageProxy") === "google-proxy" && netOf("1.2.3.4", UA_OLK_IOS) === "other");
const reread = msg({ hits: [hit(T("14:00:00"), { city: "New York", country: "US" }), hit("2026-10-28T14:00:00.000Z", { ua: UA_OLK_IOS, city: "New York", country: "US" })] });
const rs = openSummary(reread, {});
check("re-reads are one person", rs.opens === 2 && rs.forwarded === false, rs);
const fwd = msg({ hits: [hit(T("14:00:00"), { city: "New York", country: "US" }), hit("2026-10-28T09:00:00.000Z", { ua: UA_GMAIL, net: "google-proxy", city: "London", country: "GB" })] });
check("forward hint", openSummary(fwd, { "gs.com": "google" }).forwarded === true);
const many = Array.from({ length: 10 }, (_, i) => msg({ id: `m${i}`, hits: i < 3 ? [hit(T("14:00:00"))] : [] }));
const rate = openRate(many, {});
check("open rate", rate.sent === 10 && rate.opened === 3 && rate.low < 0.3 && rate.high > 0.3, rate);
const heat = readingHeatmap([msg({ hits: [hit("2026-10-27T13:14:00.000Z")] })], {}, () => "America/New_York");
check("heatmap", heat[2][9] === 1, heat[2]);

const mixed = msg({ hits: [hit("2026-10-27T12:00:00.000Z", { net: "scanner", ipHash: "s" }), hit("2026-10-27T12:00:01.000Z", { ipHash: "p" })] });
check("person next to a scanner hit survives", openSummary(mixed, {}).opens === 1, labels(mixed));
check("open rate ignores unsent stubs", openRate([msg(), msg({ id: "b" }), msg({ id: "c", sentAt: undefined })], {}).sent === 2);
check("garbage time is not an open", openSummary(msg({ hits: [hit("garbage")] }), {}).opens === 0);
let threw = false;
try { readingHeatmap([msg({ hits: [hit("2026-10-27T13:14:00.000Z"), hit("garbage")] })], {}, () => "Not/AZone"); } catch { threw = true; }
check("bad zone / time do not throw heatmap", !threw);

// Pixel in Coverage-built drafts: exactly once, in the HTML part (after everything, logo included), never in text/plain.
const { buildMime } = await import("../src/lib/gmail");
const mimeParts = (mime: string) =>
  mime.split(/\r\n--[A-Za-z0-9_]+(?:--)?\r\n?/).flatMap((chunk) => {
    const m = /Content-Type: (text\/(?:html|plain));[^]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+)/.exec(chunk);
    return m ? [{ type: m[1], text: Buffer.from(m[2].replace(/\r\n/g, ""), "base64").toString("utf8") }] : [];
  });
const pix = pixelUrl("https://x.app", id);
const signed = "Hi Sam,\n\nThanks!\n\nSincerely,\nAlex\n\nAlex Rivera\nState U Class of 2029";
const logo = { type: "image/png", data: new Uint8Array([1, 2, 3]).buffer, width: 80, after: "State U Class of 2029" };
const mimeHtml = (mime: string) => mimeParts(mime).find((p) => p.type === "text/html")?.text ?? "";
const mimePlain = (mime: string) => mimeParts(mime).find((p) => p.type === "text/plain")?.text ?? "";
const withLogo = buildMime({ to: "sam@gs.com", subject: "Hi", body: signed, pixel: pix, logo });
const htmlPart = mimeHtml(withLogo);
check("pixel: exactly one /api/o/ in the HTML part", (htmlPart.match(/\/api\/o\//g) ?? []).length === 1, htmlPart.slice(-300));
check("pixel: none in text/plain", mimePlain(withLogo).length > 0 && !mimePlain(withLogo).includes("/api/o/"), mimePlain(withLogo));
check("pixel: after the logo", htmlPart.indexOf("cid:") >= 0 && htmlPart.indexOf("/api/o/") > htmlPart.indexOf("cid:"), htmlPart.slice(-300));
check("pixel: 1x1 hidden image", /<img src="[^"]*\/api\/o\/[^"]+" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">/.test(htmlPart), htmlPart.slice(-300));
const plainOnlyPixel = buildMime({ to: "sam@gs.com", subject: "Hi", body: "Hi Sam,\n\nThanks!", pixel: pix, logo: null, attachment: { name: "r.pdf", type: "application/pdf", data: new Uint8Array([1]).buffer } });
check("pixel: with an attachment and no logo, still once in HTML only", (mimeHtml(plainOnlyPixel).match(/\/api\/o\//g) ?? []).length === 1 && !mimePlain(plainOnlyPixel).includes("/api/o/"));
const noPixel = mimeParts(buildMime({ to: "sam@gs.com", subject: "Hi", body: signed, logo: null }));
check("no pixel asked: none added", noPixel.length === 2 && noPixel.every((p) => !p.text.includes("/api/o/")), noPixel.length);

// Store helpers: hits merge by id + time; a hit for an unknown id makes a stub that a later registration fills in.
const { addHitsIn, registerTrackedIn, addSeenIn } = await import("../src/lib/store");
const h1: RawHit = { id: "x", at: "2026-10-28T12:00:00.000Z", ua: UA_OLK_WIN, ipHash: "i", net: "other" };
const h2: RawHit = { ...h1, at: "2026-10-28T13:00:00.000Z" };
let ts = addHitsIn({ messages: [], mx: {} }, [h2, h1, h1]);
check("stub from hits: deduped, sorted, createdAt = first hit", ts.messages.length === 1 && ts.messages[0].hits.length === 2 && ts.messages[0].createdAt === h1.at && ts.messages[0].kind === "gmail", ts.messages);
check("same hits again: no change", addHitsIn(ts, [h1, h2]) === ts);
ts = registerTrackedIn({ ...ts, messages: [{ ...ts.messages[0], seen: ["2026-10-28T12:30:00.000Z"] }] }, msg({ id: "x", createdAt: "2026-10-28T11:00:00.000Z", sentAt: undefined, contactId: "c1" }));
check("registering over a stub keeps hits + seen and fills fields", ts.messages.length === 1 && ts.messages[0].hits.length === 2 && ts.messages[0].seen.length === 1 && ts.messages[0].kind === "first" && ts.messages[0].contactId === "c1" && ts.messages[0].source === "coverage" && ts.messages[0].createdAt === "2026-10-28T11:00:00.000Z", ts.messages[0]);

// Sent dates for tracked emails from the contact's dates (pure part of trackingActions).
const { sentMatches, pixelFor, notePixelDraft } = await import("../src/lib/trackingActions");
const sentOf = (...a: Parameters<typeof sentMatches>) => sentMatches(...a).sent;
const contact = (o: Record<string, unknown>) => ({ id: "c1", followUps: 0, ...o }) as unknown as import("../src/lib/types").Contact;
const tFirst = msg({ id: "f", contactId: "c1", sentAt: undefined, createdAt: "2026-10-20T10:00:00.000Z" });
check("first email: contact.sentAt after the draft", sentOf([tFirst], [contact({ sentAt: "2026-10-21T16:00:00.000Z", threadId: "th" })])[0]?.threadId === "th");
check("first email: a sentAt from before the draft isn't this email", sentOf([tFirst], [contact({ sentAt: "2026-10-01T16:00:00.000Z" })]).length === 0);
const tFu = msg({ id: "u", kind: "follow-up", step: 2, contactId: "c1", sentAt: undefined, createdAt: "2026-10-20T10:00:00.000Z" });
check("follow-up #2: from followUpLog", sentOf([tFu], [contact({ followUps: 2, followUpLog: [{ step: 2, at: "2026-10-22T16:00:00.000Z", gapDays: 7 }] })])[0]?.sentAt === "2026-10-22T16:00:00.000Z");
check("follow-up #2: not before it went out", sentOf([tFu], [contact({ followUps: 1, lastTouchAt: "2026-10-22T16:00:00.000Z" })]).length === 0);
check("follow-up #2: lastTouchAt when it's the latest", sentOf([tFu], [contact({ followUps: 2, lastTouchAt: "2026-10-23T16:00:00.000Z" })])[0]?.sentAt === "2026-10-23T16:00:00.000Z");
check("reply: lastEmailedAt", sentOf([msg({ id: "r", kind: "reply", contactId: "c1", sentAt: undefined, createdAt: "2026-10-20T10:00:00.000Z" })], [contact({ lastEmailedAt: "2026-10-20T11:00:00.000Z" })]).length === 1);
check("already sent / no contact: skipped", sentOf([msg({ contactId: "c1" }), msg({ id: "n", sentAt: undefined })], [contact({ sentAt: "2026-10-28T16:00:00.000Z" })]).length === 0);

// One send = one tracked email: an older entry for the same contact/step (draft call failed, or Gmail dropped the draft
// and it was re-made) must not also be stamped sent.
const older = msg({ id: "old", kind: "follow-up", step: 1, contactId: "c1", sentAt: undefined, createdAt: "2026-10-20T10:00:00.000Z" });
const newer = msg({ id: "new", kind: "follow-up", step: 1, contactId: "c1", sentAt: undefined, createdAt: "2026-10-21T10:00:00.000Z", gmailDraftId: "d2" });
const oneSend = sentMatches([older, newer], [contact({ followUps: 1, lastTouchAt: "2026-10-22T16:00:00.000Z" })]);
check("two entries, one send: only the newest gets sentAt", oneSend.sent.length === 1 && oneSend.sent[0].id === "new", oneSend);
check("two entries, one send: the older one without hits is dropped", JSON.stringify(oneSend.drop) === '["old"]', oneSend.drop);
const olderHit = sentMatches([{ ...older, hits: [h1] }, newer], [contact({ followUps: 1, lastTouchAt: "2026-10-22T16:00:00.000Z" })]);
check("an older entry with hits stays (unsent), not dropped", olderHit.sent.length === 1 && olderHit.drop.length === 0, olderHit);
const otherSteps = sentMatches([tFirst, newer], [contact({ sentAt: "2026-10-20T16:00:00.000Z", followUps: 1, lastTouchAt: "2026-10-22T16:00:00.000Z" })]);
check("different steps are separate sends", otherSteps.sent.length === 2 && otherSteps.drop.length === 0, otherSteps);

// pixelFor registers nothing until the Gmail draft exists (a failed draft call leaves no entry).
const { useStore } = await import("../src/lib/store");
const acctId = "acctTEST";
useStore.setState({ settings: { ...useStore.getState().settings, tracking: { on: true }, server: { id: acctId, token: "t" } }, tracking: { key: await keyFor(acctId), base: "https://x.app", account: acctId, messages: [], mx: {} } });
const px = await pixelFor({ to: "Sam <sam@gs.com>", subject: "Hi", kind: "first", step: 0, contactId: "c1" });
check("pixelFor returns a pixel URL", !!px && PIXEL_PATH_RE.test(px), px);
check("pixelFor alone registers nothing", useStore.getState().tracking.messages.length === 0);
notePixelDraft(px, { id: "draft1", message: { threadId: "th1" } });
const reg = useStore.getState().tracking.messages;
check("after the draft: one entry with the draft + thread + recipient", reg.length === 1 && reg[0].gmailDraftId === "draft1" && reg[0].threadId === "th1" && reg[0].to[0] === "sam@gs.com", reg);
const px2 = await pixelFor({ to: "sam@gs.com", subject: "Hi again", kind: "first", step: 0, contactId: "c1", gmailDraftId: "draft1" });
check("re-making the same Gmail draft reuses its pixel", px2 === px);
notePixelDraft(px2, { id: "draft1" });
check("…and updates it in place", useStore.getState().tracking.messages.length === 1 && useStore.getState().tracking.messages[0].subject === "Hi again");

// Opens without automatic sending: a stale queued send must not block reading opens when the server has no Google.
// Reading opens never posts a send queue (so it can't cancel anything), and the route requires one otherwise.
const { opensOnlyBody } = await import("../src/lib/serverSync");
const { SyncBody } = await import("../src/lib/serverSyncBody");
const ob = opensOnlyBody("America/New_York");
check("opens-only body: no sends list, opensOnly set", !("sends" in ob) && ob.opensOnly === true && ob.opens === true, ob);
check("opens-only body parses without sends", SyncBody.safeParse({ ...ob, opensAck: [] }).success);
check("a normal body without sends is refused", !SyncBody.safeParse({ tz: "America/New_York", opens: true }).success);
check("a normal body with sends parses", SyncBody.safeParse({ tz: "America/New_York", sends: [] }).success);
const longAcct = "a".repeat(64);
const longAck = `${await mintPixelId(longAcct, await keyFor(longAcct))}|2026-10-28T12:00:00.000Z`;
check("opensAck: a 64-char account's id|at fits", longAck.length > 80 && SyncBody.safeParse({ ...ob, opensAck: [longAck] }).success, longAck.length);

// Pixel route throttle + per-email hit cap (a replayed URL can't run up Redis or grow the synced doc).
{
  const { hitThrottle, capHits, HITS_FIRST, HITS_LAST } = await import("../src/lib/opens");
  const allow = hitThrottle(20, 600_000, 3);
  const t0 = 1_000_000;
  const first = Array.from({ length: 25 }, (_, i) => allow("a", t0 + i));
  check("throttle: 20 stored per id per window", first.filter(Boolean).length === 20 && !first[20] && !first[24]);
  check("throttle: other ids unaffected", allow("b", t0));
  check("throttle: a new window allows again", allow("a", t0 + 600_000));
  allow("c", t0); allow("d", t0 + 1); allow("e", t0 + 2);
  check("throttle: memory stays bounded (oldest id forgotten)", allow("e", t0 + 3));
  const many = Array.from({ length: 500 }, (_, i): RawHit => ({ id: "z", at: new Date(Date.UTC(2026, 9, 28) + i * 1000).toISOString(), ua: UA_OLK_WIN, ipHash: "i", net: "other" }));
  const capped = capHits(many);
  check("capHits: first 50 + last 150", capped.length === HITS_FIRST + HITS_LAST && capped[0] === many[0] && capped[49] === many[49] && capped[50] === many[350] && capped.at(-1) === many[499]);
  check("capHits: short lists unchanged", capHits(many.slice(0, 10)).length === 10);
  let ct = addHitsIn({ messages: [], mx: {} }, many.slice(0, 300));
  check("addHits: a stub is capped", ct.messages[0].hits.length === 200, ct.messages[0].hits.length);
  ct = addHitsIn(ct, many.slice(300));
  check("addHits: more hits keep the cap, newest kept", ct.messages[0].hits.length === 200 && ct.messages[0].hits.at(-1)?.at === many[499].at && ct.messages[0].hits[0].at === many[0].at);
  ct = registerTrackedIn(ct, msg({ id: "z", hits: many.slice(0, 5) }));
  check("registerTracked: merge keeps the cap", ct.messages[0].hits.length === 200);
}

// Only your own pixel ids count (someone else's tracked email opened in your Gmail).
{
  const { ownPixelId } = await import("../src/lib/pixel");
  check("ownPixelId: own id", ownPixelId(id, ACCT) && twin.ownPixelId(id, ACCT));
  check("ownPixelId: another account / a prefix of it / no account", !ownPixelId(id, "acct_OTHER") && !ownPixelId(id, "acct_ABC") && !ownPixelId(id, undefined) && !twin.ownPixelId(id, "acct_ABC") && !twin.ownPixelId(id, undefined));
  const ext = await import("../extension/tracking.js");
  const now = Date.now();
  check("extension key: fresh within a day", ext.keyFresh({ key: "k", keyAt: now - 3600_000 }, now));
  check("extension key: stale after a day, or with no time (from before keyAt)", !ext.keyFresh({ key: "k", keyAt: now - 25 * 3600_000 }, now) && !ext.keyFresh({ key: "k" }, now) && !ext.keyFresh(undefined, now));
}

// Email tracking page helpers (lib/trackingView.ts) and the thread reader's pixel stripping (lib/gmail.ts).
{
  const tv = await import("../src/lib/trackingView");
  const { stripPixels } = await import("../src/lib/gmail");
  const pxUrl = pixelUrl("https://x.test", id);
  const html = `<div>Hi</div><img src="${pxUrl}" width="1"><img src="https://cdn.test/logo.png"><div>Bye</div>`;
  const stripped = stripPixels(html);
  check("thread HTML: our pixel removed, other images kept", !PIXEL_PATH_RE.test(stripped) && stripped.includes("logo.png") && stripped.includes("Bye"), stripped);
  check("thread HTML: an &amp;-escaped pixel src is removed too", !PIXEL_PATH_RE.test(stripPixels(`<img src="${pxUrl}?a=1&amp;b=2">`)));
  check("whenIn: 'Tue 9:14 AM ET' style", tv.whenIn("2026-10-27T13:14:00Z", "America/New_York") === "Tue 9:14 AM ET", tv.whenIn("2026-10-27T13:14:00Z", "America/New_York"));
  check("whenIn: a bad zone falls back instead of throwing", typeof tv.whenIn("2026-10-27T13:14:00Z", "Not/AZone") === "string");
  check("kind labels", tv.kindLabel({ kind: "follow-up", step: 2 }) === "Follow-up #2" && tv.kindLabel({ kind: "gmail" }) === "Sent from Gmail");

  const person = (at: string): RawHit => ({ id: "x", at, ua: "Mozilla/5.0 (Windows NT 10.0) Outlook", ipHash: "h1", net: "other", city: "New York", country: "US" });
  const msg = (over: Partial<TrackedMessage>): TrackedMessage => ({ id: "m", to: ["sam@gs.com"], subject: "s", kind: "first", createdAt: "2026-10-26T00:00:00Z", source: "coverage", hits: [], seen: [], ...over });
  const c = { id: "c1", name: "Sam", bank: "GS", region: "NY", location: "NY", sentAt: "2026-10-26T14:00:00Z", followUps: 0, status: "sent", history: [] } as unknown as import("../src/lib/types").Contact;
  const opened = msg({ id: "a", contactId: "c1", sentAt: "2026-10-26T14:00:00Z", hits: [person("2026-10-27T13:14:00Z"), person("2026-10-27T18:00:00Z")] });
  const b = tv.contactOpenBadge(c, [opened], {});
  check("badge: opened 2x with the first open in their zone", b?.text === "Opened 2× · Tue 9:14 AM ET" && b.opened, b);
  const later = { ...c, lastEmailedAt: "2026-11-03T14:00:00Z", followUps: 1 } as typeof c;
  check("badge: none when a later untracked email went out", tv.contactOpenBadge(later, [opened], {}) === undefined);
  const quiet = msg({ id: "q", contactId: "c1", sentAt: "2026-10-26T14:00:00Z" });
  check("badge: 'Not opened yet' for a tracked email with no opens", tv.contactOpenBadge(c, [quiet], {})?.text === "Not opened yet");
  check("badge: unsent tracked emails don't count", tv.contactOpenBadge(c, [msg({ contactId: "c1" })], {}) === undefined);

  const replied = { ...c, repliedAt: "2026-10-28T00:00:00Z" } as typeof c;
  const rows = tv.trackedRows([opened, msg({ id: "u", to: ["x@ms.com"], sentAt: "2026-10-26T15:00:00Z" }), msg({ id: "d" })], [replied], {});
  const k = tv.trackingKpis(rows, {});
  check("kpis: sent / opened / replied (unsent left out)", k.sent === 2 && k.opened === 1 && k.replied === 1, k);
  check("kpis: median time to first open", k.medianToOpen === Date.parse("2026-10-27T13:14:00Z") - Date.parse("2026-10-26T14:00:00Z"), k.medianToOpen);
  check("rows: firm = bank, else the domain", rows.find((r) => r.m.id === "u")?.firm === "ms.com" && rows.find((r) => r.m.id === "a")?.firm === "GS");
  const three = [1, 2, 3].map((i) => msg({ id: `s${i}`, to: [`p${i}@blocky.com`], sentAt: "2026-10-26T15:00:00Z" }));
  check("firms with 0 opens out of 3+ listed", JSON.stringify(tv.silentFirms(tv.trackedRows(three, [], {}))) === JSON.stringify([{ firm: "blocky.com", sent: 3 }]));
  check("firms with fewer than 3 not listed", tv.silentFirms(tv.trackedRows(three.slice(0, 2), [], {})).length === 0);
  const byFirm = tv.openRateBy(rows, {}, (r) => ({ key: r.firm, label: r.firm }));
  check("open rate by group", byFirm.find((g) => g.key === "GS")?.opened === 1 && byFirm.find((g) => g.key === "ms.com")?.opened === 0, byFirm);
  const fo = tv.firstEmailOpens([opened, msg({ id: "f", kind: "follow-up", step: 1, contactId: "c2", sentAt: "2026-10-26T15:00:00Z" })], {});
  check("lab: first emails only, opened flag per contact", fo.get("c1") === true && !fo.has("c2"), [...fo]);
  check("durations read naturally", tv.durationLabel(5 * 60_000) === "5 min" && tv.durationLabel(3 * 3_600_000) === "3.0 h" && tv.durationLabel(3 * 86_400_000) === "3 days");
}

// Review fixes: the email allowlist keeps text of non-listed structure; late thread answers for another row are dropped.
{
  const { EMAIL_SANITIZER: z } = await import("../src/lib/safeHtml");
  const kept = new Set([...z.elements, ...z.replaceWithChildrenElements]);
  const textTags = ["h1", "h2", "h3", "h4", "h5", "h6", "thead", "tfoot", "caption", "section", "article", "header", "footer", "main", "pre", "code", "small", "sup", "sub", "s", "strike", "dl", "dt", "dd", "address", "center", "font"];
  const lost = textTags.filter((t) => !kept.has(t));
  check("sanitizer: headings / table parts / sections / code / small print keep their text", lost.length === 0, lost);
  check("sanitizer: no images, no attributes but href", !kept.has("img") && !kept.has("picture") && JSON.stringify(z.attributes) === JSON.stringify(["href"]));
  const { settleFor } = await import("../src/lib/trackingView");
  const shown = { for: "B", state: "idle" };
  check("panel: a late thread for row A is dropped while B is shown", settleFor(shown, { for: "A", state: "done" }) === shown);
  check("panel: the thread for the shown row is applied", settleFor(shown, { for: "B", state: "done" }).state === "done");
}

{
  const SEEN = "2026-10-28T12:00:00.000Z";
  let t = addSeenIn({ messages: [], mx: {} }, "q", SEEN);
  t = addSeenIn(t, "q", SEEN);
  t = registerTrackedIn(t, msg({ id: "q", to: ["a@gs.com"], createdAt: "2026-10-28T11:00:00.000Z" }));
  check("addSeen before registerTracked: one entry with the seen time and recipients", t.messages.length === 1 && t.messages[0].seen.join() === SEEN && t.messages[0].to.join() === "a@gs.com", t.messages);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall open-tracking checks passed");
process.exit(failed ? 1 : 0);

