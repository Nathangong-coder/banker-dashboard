/**
 * Build the Claude plugin's local tracker server into one self-contained file (no npm install for users):
 *   npm run build:plugin
 * scripts/plugin/coverage-mcp.mts (+ src/lib, exceljs, jszip) → plugin/recruitify/server/coverage-mcp.mjs.
 * Rebuild and commit it after changing the server or the spreadsheet code it uses, and bump the version in
 * plugin/recruitify/.claude-plugin/plugin.json so installed copies update.
 * Not minified: the Claude directory's security scan holds code it can't read (the file is still over its 256 KiB
 * auto-pass size because exceljs is bundled, so a reviewer looks at it once per version).
 */
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "plugin/recruitify/server/coverage-mcp.mjs");
await build({
  entryPoints: [path.join(root, "scripts/plugin/coverage-mcp.mts")],
  outfile: out,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  minify: false,
  legalComments: "inline",
  alias: { "@": path.join(root, "src") },
  // exceljs / jszip are CommonJS and call require().
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "warning",
});
console.log(`Built ${path.relative(root, out)}`);
