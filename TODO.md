# TODO

## 1. Real 9am "what's due today" WhatsApp ping (Vercel Cron) — requested, not built yet

**Goal:** every morning around 9am (user's timezone) a WhatsApp message lists who to follow up with today, even if the
dashboard isn't open. Only the ping is wanted, not pre-scheduled "planned" messages (ntfy/Twilio scheduling can be
demoted in the UI once this ships).

**Why it needs new infra:** all data lives in the browser (IndexedDB), so the server doesn't know who's due. The
browser must push a small due-list snapshot to server storage, and a cron job reads it and sends.

**Plan**
1. Storage: provision a store from the Vercel Marketplace (Upstash Redis is simplest, or Vercel Blob with one JSON
   per user). Load the `marketplace` / `vercel-storage` skills first.
2. Identity: no accounts exist. Generate a random `pingId` (128-bit) in Settings, and use it as the storage key.
   The user's CallMeBot phone + apikey have to be stored server-side too (encrypt at rest with an env secret).
3. Sync: whenever contacts change (debounced) and on app load, POST `/api/ping/sync` with
   `{ pingId, tz, phone, apikey(enc), days: { "YYYY-MM-DD": ["Name (Bank NY): Follow-up #1", …] } }` for the next ~35 days
   (reuse `upcomingDigests` in `src/lib/reminders.ts`). Store no emails or notes, only names, banks and labels.
4. Cron: `vercel.ts` → `crons: [{ path: "/api/ping/cron", schedule: "0 * * * *" }]` (hourly). Hobby plans only allow
   daily crons, so either run at one fixed UTC hour or upgrade. Each run: for each user whose local time is 9:xx and who
   hasn't been pinged today, send `days[today]` via CallMeBot and record `lastSent`. Protect the route with `CRON_SECRET`.
5. UI: Settings → WhatsApp → toggle "Daily 9am ping" (shows last sent time). Keep "WhatsApp me today's list" as manual.
6. Privacy note in the UI: what gets stored server-side, plus a "Delete my ping data" button.

## 2. Smaller follow-ups
- Template editor: expose the `step` field for follow-up templates (import sets it; manual editing can't yet).
- Rate-limit `/api/keys/test` (it can be used as a key-checking oracle; low risk, but cheap to add).
- Browser click-through test of all pages with real keys (never done in-session: the browser tool was denied).
- Consider merging legacy `(NY)` tabs into the main bank tabs in the owner's workbook.
