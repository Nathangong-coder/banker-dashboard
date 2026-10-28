/**
 * Email open-tracking pixel ids (lib/pixel.ts and its extension twin):
 *   npm run check:opens
 */
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

console.log(failed ? `\n${failed} check(s) failed` : "\nall open-tracking checks passed");
process.exit(failed ? 1 : 0);
