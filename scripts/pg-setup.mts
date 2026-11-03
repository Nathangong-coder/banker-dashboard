/**
 * Creates the Postgres tables the server's store uses (src/lib/server/store.ts). Safe to run again.
 *   npm run db:setup
 */
import "./pg-env.mts";
import { neon } from "@neondatabase/serverless";
const { SCHEMA } = await import("../src/lib/server/store");
const sql = neon(process.env.DATABASE_URL!);
for (const s of SCHEMA) await sql.query(s);
console.log(`ok: ${SCHEMA.length} statements`);
