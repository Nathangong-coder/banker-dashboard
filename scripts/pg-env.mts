/** Loads .env.local (Upstash) and .env.neon (`vercel env pull .env.neon`: DATABASE_URL) for the store scripts. */
import { existsSync, readFileSync } from "node:fs";
for (const f of [".env.local", ".env.neon"]) {
  if (!existsSync(f)) continue;
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
if (!process.env.DATABASE_URL) throw new Error("No DATABASE_URL: run `vercel env pull .env.neon --environment development`.");
