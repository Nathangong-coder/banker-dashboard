/**
 * Build the Coverage browser extension for the Chrome Web Store / Edge Add-ons:
 *   npm run pack:extension
 * 1. Renders extension/icons/{16,32,48,128}.png from the app icon (src/app/icon.svg).
 * 2. Checks the manifest, then zips extension/ into dist/coverage-extension-<version>.zip (the file you upload).
 * The same zip works for both stores. Bump "version" in extension/manifest.json before every upload.
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

const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
const problems = [];
if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`version "${manifest.version}" must be 1-4 dot-separated numbers`);
if ((manifest.description ?? "").length > 132) problems.push("description must be 132 characters or fewer (store limit)");
if (manifest.host_permissions?.length) problems.push("host_permissions widen the store review; activeTab is enough so far");
if (problems.length) {
  console.error("Manifest problems:\n- " + problems.join("\n- "));
  process.exit(1);
}

const zip = new JSZip();
const add = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name.startsWith(".") || name === "README.md") continue;
    if (fs.statSync(full).isDirectory()) add(full);
    else zip.file(path.relative(src, full).split(path.sep).join("/"), fs.readFileSync(full));
  }
};
add(src);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", `coverage-extension-${manifest.version}.zip`);
fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`Packed ${Object.keys(zip.files).length} files → ${path.relative(root, out)}`);
