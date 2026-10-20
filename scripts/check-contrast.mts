/**
 * WCAG contrast check of every color theme (src/app/globals.css: `:root` = slate, plus each `[data-theme]` block) for the
 * text/background pairs the UI actually uses.
 *   npm run check:contrast
 * Normal text needs 4.5:1 (AA); large text (≥18.66px bold / 24px) and icons need 3:1. Fails if any pair is below.
 */
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const themes = [...css.matchAll(/\[data-theme="(\w+)"\]\s*\{([^}]*)\}/g)].map((m) => ({
  name: m[1],
  tok: Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1], x[2]])) as Record<string, string>,
}));

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [text, background, what, minimum]
const pairs: [string, string, string, number][] = [
  ["ink", "paper", "body text on the page", 4.5],
  ["ink-2", "paper", "secondary text on the page", 4.5],
  ["muted", "paper", "muted text on the page", 4.5],
  ["muted", "panel", "muted text in cards", 4.5],
  ["muted", "subtle", "muted text in table headers / hover rows", 4.5],
  ["muted", "hover", "muted text on grey chips", 4.5],
  ["ink-2", "hover", "neutral badge / segmented control", 4.5],
  ["navy", "panel", "links in cards", 4.5],
  ["navy", "paper", "links on the page", 4.5],
  ["#ffffff", "navy", "white on navy (selected chips)", 4.5],
  ["green", "green-soft", "green badge", 4.5],
  ["red", "red-soft", "red badge", 4.5],
  ["blue", "blue-soft", "blue badge", 4.5],
  ["amber", "amber-soft", "amber badge", 4.5],
  ["red", "panel", "error text", 4.5],
  ["green", "panel", "green text", 4.5],
  ["amber", "panel", "amber text", 4.5],
  ["#ffffff", "brass-strong", "white on the accent (primary buttons, counts)", 4.5],
  ["#ffffff", "brass-hover", "white on the hovered accent", 4.5],
  ["brass-ink", "brass-soft", "accent badge / hovered outline button", 4.5],
  ["brass-ink", "panel", "accent outline button text", 4.5],
  ["brass-strong", "panel", "accent text", 4.5],
  ["top-ink", "top", "top bar: current section", 4.5],
  ["top-muted", "top", "top bar: other sections", 4.5],
  ["side-ink", "side", "sidebar links", 4.5],
  ["side-ink", "side-active", "sidebar: current page", 4.5],
  ["side-muted", "side", "sidebar labels / footer links", 4.5],
];

let failed = 0;
for (const t of themes) {
  console.log(`\n${t.name}`);
  const c = (name: string) => (name.startsWith("#") ? name : t.tok[name]);
  for (const [fg, bg, what, min] of pairs) {
    if (!c(fg) || !c(bg)) {
      failed++;
      console.log(`FAIL missing token ${fg} or ${bg}`);
      continue;
    }
    const r = ratio(c(fg), c(bg));
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}:1 (need ${min}) ${what}  ${c(fg)} on ${c(bg)}`);
  }
}
if (themes.length < 4) {
  console.error("expected 4 themes in globals.css");
  process.exit(1);
}
if (failed) {
  console.error(`\n${failed} contrast pair(s) below WCAG AA`);
  process.exit(1);
}
console.log("\ncontrast OK (WCAG AA) in every theme");
