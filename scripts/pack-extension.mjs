/**
 * Build the Coverage browser extension for the Chrome Web Store / Edge Add-ons:
 *   npm run pack:extension
 * 1. Renders extension/icons/{16,32,48,128}.png from the app icon (src/app/icon.svg).
 * 2. Checks the manifest, then zips extension/ into dist/coverage-extension-<version>.zip (the file you upload).
 * The same zip works for both stores. Bump "version" in extension/manifest.json before every upload.
 *
 * The store build leaves out the experimental agent test bench (owner, 2026-10-23: v1 ships LinkedIn → Coverage only):
 * no agent/ folder, no sidePanel permission, no optional all-sites access, no button in the popup. That keeps the
 * permissions to activeTab + scripting + storage, the fastest review. `npm run pack:extension -- --with-agent` makes
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
const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
if (!withAgent) {
  manifest.permissions = manifest.permissions.filter((p) => p !== "sidePanel");
  delete manifest.side_panel;
  delete manifest.optional_host_permissions;
}
const problems = [];
if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`version "${manifest.version}" must be 1-4 dot-separated numbers`);
if ((manifest.description ?? "").length > 132) problems.push("description must be 132 characters or fewer (store limit)");
if (manifest.host_permissions?.length) problems.push("host_permissions widen the store review; activeTab is enough so far");
if (!withAgent && (manifest.optional_host_permissions?.length || manifest.permissions.includes("sidePanel"))) problems.push("the store build must not ask for the agent's permissions");
if (problems.length) {
  console.error("Manifest problems:\n- " + problems.join("\n- "));
  process.exit(1);
}

const zip = new JSZip();
const add = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(src, full).split(path.sep).join("/");
    if (name.startsWith(".") || name === "README.md" || (!withAgent && rel === "agent")) continue;
    if (fs.statSync(full).isDirectory()) add(full);
    else if (rel === "manifest.json") zip.file(rel, JSON.stringify(manifest, null, 2) + "\n");
    else if (rel === "popup.html" && !withAgent) zip.file(rel, fs.readFileSync(full, "utf8").replace(/[ \t]*<!-- agent:start[\s\S]*?<!-- agent:end -->\r?\n?/, ""));
    else zip.file(rel, fs.readFileSync(full));
  }
};
add(src);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", `coverage-extension-${manifest.version}${withAgent ? "-agent" : ""}.zip`);
fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
const popup = await zip.file("popup.html").async("string");
if (!withAgent && (popup.includes('id="agent"') || Object.keys(zip.files).some((f) => f.startsWith("agent/")))) {
  console.error("The store build still contains the agent.");
  process.exit(1);
}
console.log(`Packed ${Object.keys(zip.files).length} files → ${path.relative(root, out)}${withAgent ? " (with the agent test bench)" : " (store build: LinkedIn → Coverage only)"}`);
console.log(`Permissions: ${manifest.permissions.join(", ")}${manifest.optional_host_permissions ? ` + optional ${manifest.optional_host_permissions.join(", ")}` : ""}`);
