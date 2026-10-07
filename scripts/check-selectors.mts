/**
 * Zustand v5 re-renders forever (React error #185, "This page couldn't load") when a store selector returns a new
 * object or array on every call: `useStore((s) => windowOf(s.settings))`, `(s) => s.x ?? []`, `(s) => s.list.filter(…)`.
 * Select the stored value and derive outside the hook instead. This scans src/ for selectors that build values.
 *   npm run check:selectors
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "src");
const files: string[] = [];
(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(e.name)) files.push(p);
  }
})(root);

// Builders that return a fresh object/array each call.
const FRESH = /\b(windowOf|schedulingOf|rulesOf|activeDesks|digestPlan|buildCoverage)\(|\?\?\s*\[\]|\?\?\s*\{\}|\.(filter|map|slice|concat|flatMap)\(|\[\.\.\.|\{\s*\.\.\./;
// Ending in a primitive is fine: `.filter(...).length`, `.some(...)`, `!!…`, comparisons.
const PRIMITIVE = /(\.length|\.size|\.some\([^)]*\)|\.every\([^)]*\)|\.includes\([^)]*\)|===?[^=].*|!==?.*)\s*$/;

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/useStore\(\s*\(s\)\s*=>\s*([^;]*?)\)\s*;/g)) {
    const body = m[1].trim();
    if (FRESH.test(body) && !PRIMITIVE.test(body) && !body.startsWith("!!")) {
      bad++;
      const line = src.slice(0, m.index).split("\n").length;
      console.log(`FAIL ${path.relative(path.join(root, ".."), f)}:${line}  useStore((s) => ${body.slice(0, 90)})`);
    }
  }
}
if (bad) {
  console.error(`\n${bad} selector(s) build a new value each call: select the stored value, derive it outside useStore.`);
  process.exit(1);
}
console.log(`selectors OK (${files.length} files)`);
