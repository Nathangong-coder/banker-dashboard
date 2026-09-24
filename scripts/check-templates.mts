/**
 * Run the template-document importer on a .docx / .txt outside the browser.
 *   npm run check:templates -- "Follow up Templates.docx" ["Your Name"]
 */
import fs from "node:fs";
import { docxToBlocks, parseTemplateBlocks, textToBlocks } from "../src/lib/templateImport";

const [file, sender = ""] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run check:templates -- "file.docx" ["Your Name"]');
  process.exit(1);
}
const buf = fs.readFileSync(file);
const blocks = /\.docx$/i.test(file) ? await docxToBlocks(buf) : textToBlocks(buf.toString("utf8"));
const generalize = process.env.PROFILE ? JSON.parse(process.env.PROFILE) : undefined;
const r = parseTemplateBlocks(blocks, { senderName: sender, generalize });
for (const c of r.candidates) {
  console.log(`\n=== ${c.name}  [${c.kind}${c.step ? ` #${c.step}` : ""}]  (${c.tab} → ${c.heading})`);
  console.log(`when: ${c.whenToUse}`);
  console.log(`subject: ${c.subject}`);
  console.log(c.body);
  console.log(`subs: ${c.substitutions.map((s) => `${s.from}→${s.to}`).join(" | ")}`);
  if (c.unknownBlanks.length) console.log(`UNKNOWN: ${c.unknownBlanks.join(", ")}`);
}
console.log("\nskipped:", r.skipped);
console.log("notes:", r.notes);
console.log(`\n${r.candidates.length} templates`);
