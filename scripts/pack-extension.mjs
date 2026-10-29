/**
 * Build the Coverage browser extension for the Chrome Web Store / Edge Add-ons:
 *   npm run pack:extension
 * 1. Renders extension/icons/{16,32,48,128}.png from the app icon (src/app/icon.svg).
 * 2. Checks the manifest, then zips extension/ into dist/coverage-extension-<version>.zip (the file you upload).
 * The same zip works for both stores. Bump "version" in extension/manifest.json before every upload.
 *
 * The store build leaves out the experimental agent test bench (owner, 2026-10-23: v1 ships LinkedIn → Coverage only):
 * no agent/ folder, no sidePanel permission, no optional all-sites access, no button in the popup. That keeps the
 * permissions to activeTab + scripting + storage (plus a content script on the dashboard's own pages, the autofill
 * bridge), the fastest review. `npm run pack:extension -- --with-agent` makes
 * the full build (dist/coverage-extension-<version>-agent.zip) for loading unpacked / testing.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import JSZip from "jszip";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "extension");
const svg = fs.readFileSync(path.join(root, "src/app/icon.svg"));

fs.mkdirSync(path.join(src, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path.join(src, "icons", `${size}.png`));
}

const withAgent = process.argv.includes("--with-agent");
const LINKEDIN = "https://www.linkedin.com/*";
const HANDSHAKE = "https://*.joinhandshake.com/*";
// Gmail open tracking (sites/gmail.js, registered at run time by tracking.js): test build only (owner, 2026-10-28).
const GMAIL = "https://mail.google.com/*";
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
// The application sites autofill may be allowed on, one at a time (extension/sites/apply.js is the source).
const APPLICATION_SITES = [...fs.readFileSync(path.join(src, "sites/apply.js"), "utf8").match(/export const APPLICATION_SITES = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => `https://*.${m[1]}/*`);
if (!withAgent) {
  // The test build's real clicks (chrome.debugger) stay out of the store build too.
  manifest.permissions = manifest.permissions.filter((p) => p !== "sidePanel" && p !== "debugger");
  delete manifest.side_panel;
  // The agent's all-sites access stays out; the per-site application permissions stay in.
  // So does LinkedIn: the opt-in LinkedIn job search is for the test build only (owner, 2026-10-24).
  // Handshake too (owner, 2026-10-26: same opt-in reader, same test-build-only rule).
  manifest.optional_host_permissions = (manifest.optional_host_permissions ?? []).filter((p) => p !== "<all_urls>" && p !== LINKEDIN && p !== HANDSHAKE && p !== GMAIL);
  // Local development addresses only matter for an unpacked copy.
  for (const cs of manifest.content_scripts ?? []) cs.matches = cs.matches.filter((m) => !/^http:\/\/(localhost|127\.0\.0\.1)\//.test(m));
}
const problems = [];
if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`version "${manifest.version}" must be 1-4 dot-separated numbers`);
if ((manifest.description ?? "").length > 132) problems.push("description must be 132 characters or fewer (store limit)");
if (manifest.host_permissions?.length) problems.push("host_permissions widen the store review; activeTab is enough so far");
// The only content script is the dashboard bridge (content/dashboard.js): it must never run on any other site.
const DASHBOARD_MATCHES = new Set(withAgent ? ["https://banker-dashboard-three.vercel.app/*", "http://localhost/*", "http://127.0.0.1/*"] : ["https://banker-dashboard-three.vercel.app/*"]);
for (const cs of manifest.content_scripts ?? []) {
  for (const m of cs.matches ?? []) if (!DASHBOARD_MATCHES.has(m)) problems.push(`content script matches ${m}: only the dashboard's own addresses are allowed`);
  if (cs.js?.some((f) => f !== "content/dashboard.js")) problems.push("only content/dashboard.js may run as a content script");
}
if (!withAgent && (manifest.permissions.includes("sidePanel") || manifest.permissions.includes("debugger"))) problems.push("the store build must not ask for the agent's permissions");
for (const p of manifest.optional_host_permissions ?? [])
  if (!APPLICATION_SITES.includes(p) && !(withAgent && (p === "<all_urls>" || p === LINKEDIN || p === HANDSHAKE || p === GMAIL))) problems.push(`optional host permission ${p} isn't one of APPLICATION_SITES (extension/sites/apply.js)`);
for (const p of APPLICATION_SITES) if (!manifest.optional_host_permissions?.includes(p)) problems.push(`APPLICATION_SITES has ${p} but the manifest doesn't ask for it`);
// sites/gmail.js is a classic content script (no imports): its copy of the pixel regex must match pixel.js's.
const pixelRe = fs.readFileSync(path.join(src, "pixel.js"), "utf8").match(/export const PIXEL_PATH_RE = (\/.*\/);/)?.[1];
if (!pixelRe || !fs.readFileSync(path.join(src, "sites/gmail.js"), "utf8").includes(`const PIXEL_PATH_RE = ${pixelRe};`)) problems.push("sites/gmail.js's PIXEL_PATH_RE must be the same as pixel.js's");
if (problems.length) {
  console.error("Manifest problems:\n- " + problems.join("\n- "));
  process.exit(1);
}

const zip = new JSZip();
const add = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(src, full).split(path.sep).join("/");
    if (name.startsWith(".") || name === "README.md" || (!withAgent && (rel === "agent" || rel === "sites/gmail.js"))) continue;
    if (fs.statSync(full).isDirectory()) add(full);
    else if (rel === "manifest.json") zip.file(rel, JSON.stringify(manifest, null, 2) + "\n");
    else if ((rel === "popup.html" || rel === "options.html") && !withAgent) zip.file(rel, fs.readFileSync(full, "utf8").replace(/[ \t]*<!-- agent:start[\s\S]*?<!-- agent:end -->\r?\n?/, "").replace(/[ \t]*<!-- gmail:start[\s\S]*?<!-- gmail:end -->\r?\n?/, ""));
    else zip.file(rel, fs.readFileSync(full));
  }
};
add(src);
// The worker imports agent/agent.js (the AI agent that finishes applications); the store build gets a stand-in that
// turns it off, so the store build still has no agent code.
const AGENT_STUB = "// Store build: no AI agent (the test build has extension/agent/).\nexport const runAgent = null;\nexport const runFill = null;\n";
if (!withAgent) zip.file("agent/agent.js", AGENT_STUB);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", `coverage-extension-${manifest.version}${withAgent ? "-agent" : ""}.zip`);
fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
const popup = await zip.file("popup.html").async("string");
const options = await zip.file("options.html").async("string");
if (!withAgent && (popup.includes('id="agent"') || options.includes('id="liOn"') || options.includes('id="hsOn"') || manifest.optional_host_permissions.includes(LINKEDIN) || manifest.optional_host_permissions.includes(HANDSHAKE) || Object.keys(zip.files).some((f) => f.startsWith("agent/") && f !== "agent/" && f !== "agent/agent.js") || (await zip.file("agent/agent.js").async("string")) !== AGENT_STUB)) {
  console.error("The store build still contains the agent.");
  process.exit(1);
}
if (!withAgent && (options.includes('id="gmOn"') || options.includes("gmail:start") || manifest.optional_host_permissions.includes(GMAIL) || zip.file("sites/gmail.js"))) {
  console.error("The store build still contains Gmail tracking.");
  process.exit(1);
}
console.log(`Packed ${Object.keys(zip.files).length} files → ${path.relative(root, out)}${withAgent ? " (with the agent test bench)" : " (store build: no agent test bench)"}`);
console.log(`Permissions: ${manifest.permissions.join(", ")}${manifest.optional_host_permissions ? ` + optional ${manifest.optional_host_permissions.join(", ")}` : ""}`);
