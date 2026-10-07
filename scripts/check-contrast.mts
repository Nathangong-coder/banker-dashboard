/**
 * WCAG contrast check of the palette (src/app/globals.css) for the text/background pairs the UI actually uses.
 *   npm run check:contrast
 * Normal text needs 4.5:1 (AA); large text (≥18.66px bold / 24px) and icons need 3:1. Fails if any pair is below.
 */
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const tok = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const c = (name: string) => tok[name] ?? name;

// [text, background, what, minimum]
const pairs: [string, string, string, number][] = [
  ["ink", "paper", "body text on the page", 4.5],
  ["ink-2", "paper", "secondary text on the page", 4.5],
  ["muted", "paper", "muted text on the page", 4.5],
  ["muted", "panel", "muted text in cards", 4.5],
  ["muted", "#fbfaf6", "muted text in table headers / hover rows", 4.5],
  ["ink-2", "#ecebe4", "neutral badge", 4.5],
  ["navy", "panel", "links in cards", 4.5],
  ["navy", "paper", "links on the page", 4.5],
  ["green", "green-soft", "green badge", 4.5],
  ["red", "red-soft", "red badge", 4.5],
  ["blue", "blue-soft", "blue badge", 4.5],
  ["amber", "amber-soft", "amber badge", 4.5],
  ["red", "panel", "error text", 4.5],
  ["green", "panel", "green text", 4.5],
  ["amber", "panel", "amber text", 4.5],
  ["#ffffff", "navy", "white on navy (buttons, active tab)", 4.5],
  ["#c9d1de", "navy", "sidebar text", 4.5],
  ["#9aa6ba", "navy", "sidebar footer links", 4.5],
  ["#8793a8", "navy", "sidebar subtitle", 4.5],
  ["#7c89a0", "navy", "sidebar icons", 3],
  ["#ffffff", "brass-strong", "white on brass (count badge, brass button)", 4.5],
  ["brass-strong", "panel", "brass text", 4.5],
  ["muted", "#efede5", "muted text on hovered / grey chips", 4.5],
  ["brass", "panel", "brass icons and decorative accents", 3],
  ["#7d5d1f", "brass-soft", "brass-soft badge", 4.5],
];

let failed = 0;
for (const [fg, bg, what, min] of pairs) {
  const r = ratio(c(fg), c(bg));
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}:1 (need ${min}) ${what}  ${c(fg)} on ${c(bg)}`);
}
if (failed) {
  console.error(`\n${failed} contrast pair(s) below WCAG AA`);
  process.exit(1);
}
console.log("\ncontrast OK (WCAG AA)");
