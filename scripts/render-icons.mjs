/**
 * Every app icon from the one logo drawing (src/app/icon.svg):
 *   npm run render:icons
 * → src/app/favicon.ico (16/32/48), src/app/apple-icon.png (180), public/icon-192.png, public/icon-512.png.
 * The extension's icons come from the same file (npm run pack:extension).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const svg = fs.readFileSync(path.join(root, "src/app/icon.svg"));
const png = (size) => sharp(svg, { density: 512 }).resize(size, size).png().toBuffer();

await fs.promises.writeFile(path.join(root, "src/app/apple-icon.png"), await png(180));
for (const s of [192, 512]) await fs.promises.writeFile(path.join(root, `public/icon-${s}.png`), await png(s));

// .ico = a 6-byte header, a 16-byte entry per image, then the PNGs themselves (Vista+ reads PNG entries).
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0);
  e.writeUInt8(s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
await fs.promises.writeFile(path.join(root, "src/app/favicon.ico"), Buffer.concat([header, ...entries, ...images]));
console.log("favicon.ico, apple-icon.png, icon-192.png, icon-512.png");
