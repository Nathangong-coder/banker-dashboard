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

console.log(failed ? `\n${failed} check(s) failed` : "\nall open-tracking checks passed");
process.exit(failed ? 1 : 0);
