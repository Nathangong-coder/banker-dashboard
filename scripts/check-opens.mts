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
const { addHitsIn, registerTrackedIn } = await import("../src/lib/store");
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
const { opensOnlySends } = await import("../src/lib/serverSync");
const q = [{ draftId: "d1" }];
check("no Google on the server: post an empty queue", opensOnlySends(q, false).length === 0);
check("Google unknown / connected: post the real queue", opensOnlySends(q, undefined) === q && opensOnlySends(q, true) === q);

console.log(failed ? `\n${failed} check(s) failed` : "\nall open-tracking checks passed");
process.exit(failed ? 1 : 0);
