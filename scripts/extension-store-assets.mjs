/**
 * Images for the Chrome Web Store listing (extension/README.md → Publish):
 *   npm run start -- -p 3100 -H 127.0.0.1   (a production build, in another terminal)
 *   npm run assets:extension [-- http://127.0.0.1:3100]
 * Writes dist/store/: screenshot-1280x800.png (the /extension page: what it does + the popup) and
 * promo-440x280.png (the small promo tile). Rendered with headless Chrome (or Edge); colors come from the default
 * theme in src/app/globals.css. The 128 px store icon is extension/icons/128.png (npm run pack:extension).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const base = (process.argv[2] ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const out = path.join(root, "dist", "store");
fs.mkdirSync(out, { recursive: true });

const browser = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => fs.existsSync(p));
if (!browser) {
  console.error("No Chrome or Edge found.");
  process.exit(1);
}

// The default theme = the first token block in globals.css (:root).
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const token = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`, "i"))?.[1];
const c = { paper: token("paper"), panel: token("panel"), ink: token("ink"), ink2: token("ink-2"), soft: token("brass-soft"), strong: token("brass-strong") };

function shot(url, file, w, h) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "store-shot-"));
  execFileSync(browser, ["--headless=new", "--enable-automation", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`, `--window-size=${w},${h}`, "--force-device-scale-factor=1", "--virtual-time-budget=4000", `--screenshot=${file}`, url], { stdio: "ignore" });
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`${path.relative(root, file)} (${w}×${h})`);
}

const res = await fetch(`${base}/extension`).catch(() => null);
if (!res?.ok) {
  console.error(`${base}/extension didn't answer. Build and start the site first (npm run build, then npx next start -p 3100 -H 127.0.0.1).`);
  process.exit(1);
}
shot(`${base}/extension`, path.join(out, "screenshot-1280x800.png"), 1280, 800);

const tile = path.join(out, "promo-440x280.html");
fs.writeFileSync(
  tile,
  `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:440px;height:280px;overflow:hidden}
  body{font-family:"Lexend Deca",system-ui,sans-serif;background:${c.soft};color:${c.ink};display:flex;flex-direction:column;justify-content:center;padding:0 32px;box-sizing:border-box}
  .brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:500}
  .logo{width:34px;height:34px;border-radius:8px;background:${c.strong};color:#fff;display:grid;place-items:center;font-weight:600;font-size:17px}
  h1{font-size:27px;line-height:1.15;font-weight:500;letter-spacing:-.01em;margin:18px 0 10px}
  p{margin:0;font-size:14px;color:${c.ink2}}
  .btn{margin-top:16px;align-self:flex-start;background:${c.strong};color:#fff;border-radius:999px;padding:8px 16px;font-size:13px;font-weight:500}
</style></head><body>
  <div class="brand"><span class="logo">C</span>Coverage</div>
  <h1>LinkedIn → your networking tracker, in one click</h1>
  <p>For students recruiting for investment banking.</p>
  <span class="btn">Send profile to Coverage</span>
</body></html>`,
);
shot(`file:///${tile.split(path.sep).join("/")}`, path.join(out, "promo-440x280.png"), 440, 280);
fs.rmSync(tile);
