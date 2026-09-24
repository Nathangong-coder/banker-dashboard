@AGENTS.md

# Coverage: IB networking dashboard (agent handoff notes)

A Next.js 16 app (App Router, React 19, Tailwind v4, TypeScript) deployed on Vercel. It helps one student run IB recruiting outreach:
enrich emails in their .xlsx → find new bankers → draft emails → track follow-ups. See README.md for the user-facing overview.

## Commands

```bash
npm run dev                                   # localhost:3000
npm run build                                 # must pass before pushing (Vercel runs this)
npm run typecheck && npm run lint
npm run check:workbook -- "path/to/file.xlsx" # parser + write-back round-trip on a real workbook (no browser needed)
```

There is no unit test suite. `check:workbook` is the regression check for the spreadsheet logic, the riskiest part of the app.
The owner's real workbook (`IB Recruiting - Master Spreadsheet vF.xlsx`) sits in the repo root locally but is **git-ignored and must
never be committed** (`*.xlsx`, `*.pdf` are ignored).

## Architecture: where things live

- **All user data is client-side.** A Zustand store (`src/lib/store.ts`) is persisted to IndexedDB via `idb-keyval`. Large blobs (the
  original workbook ArrayBuffer, parsed sheet snapshots, the resume, the File System Access handle) are stored under separate
  `blob:*` keys through the `blobs` helper, not inside the JSON-persisted state. There is no database and no auth.
- **Bring your own keys.** API keys live in `settings.keys` (browser only). `src/lib/api.ts#callApi` attaches them as `x-*-key` headers.
  The server routes in `src/app/api/*` are **stateless proxies** that must never log or store keys.
  - `api/enrich`: Apollo `people/bulk_match` (≤10 per call), then Hunter email-finder as a fallback.
  - `api/prospect/search`: Serper (Google search of `site:linkedin.com/in`), plus optional Apollo `mixed_people/api_search` → `bulk_match` by id.
    Apollo search returns obfuscated last names and no LinkedIn, so a match call (which costs credits) is needed to reveal them.
  - `api/prospect/filter`: AI screens candidates against the user's criteria text (structured output).
  - `api/draft`: `mode: "assign"` picks a template per contact; `mode: "fill"` rewrites `[[AI: …]]` slots.
  - `api/notify`: ntfy push (optional `At` delay, max 3 days on ntfy.sh), Twilio SMS (`ScheduleType=fixed` needs a MessagingServiceSid),
    or WhatsApp via CallMeBot (`GET api.callmebot.com/whatsapp.php`; self-only, send-now, no scheduling, free for personal use).
- **AI:** AI SDK 7 (`generateText` + `Output.object`; `generateObject` is gone). `src/lib/server/ai.ts` picks the provider from the key:
  `sk-ant-…` uses `@ai-sdk/anthropic`, anything else is treated as a Vercel AI Gateway key. The model id comes from `x-ai-model` (default `claude-sonnet-5`).
- **Gmail is 100% browser-side** (`src/lib/gmail.ts`): Google Identity Services token client (scopes `gmail.compose` + `gmail.readonly`),
  then direct REST calls. `createDraft` builds MIME by hand (resume attachment, and `threadId`/`In-Reply-To` for follow-ups).
  `syncContact` reads `in:sent to:X` and `from:X` to backfill sentAt / followUps / repliedAt.

## Spreadsheet model (`src/lib/workbook.ts`): read this before touching it

- Parsed with ExcelJS **in the browser** (dynamic import). A contact table is any row whose headers include Name (or First+Last) **and**
  Email or LinkedIn. Header synonyms are in `HEADERS`. A tab titled "X Application Tracker" makes X the bank.
- The owner's bank tabs have two tables: a "Conversation" table (row 5) and a "Contact Information" table (row ~18, the one with LinkedIn
  and Status). The same person in both is merged by `dedupe`, which prefers the LinkedIn table as the write-back target.
- **Region:** SF and NY people share **one bank tab**. The region is read from the `Location/Team` column (`detectRegion`), with legacy
  `(NY)` tabs as a fallback, and bank tabs otherwise default to SF. When a region changes or a person is added, `withRegionTag` writes e.g.
  `NY · Technology` into Location/Team so it round-trips. `allocateRow` always prefers the main (non-"(NY)") bank tab.
- **Write-back never mutates the original directly.** The grid shows `snapshot + patches`. Patches = `contactPatches(contacts, snapshots)`
  (derived: found emails, status changes, location/position edits, new people in blank numbered rows) merged with manual cell edits
  (`state.patches`). `buildWorkbook(originalBuffer, patches)` produces the file. After a save, the saved file becomes the new baseline
  (`saveWorkbook` re-parses it).
- **Status mapping** (`statusFromSheet` / `STATUS_TO_SHEET`): "Sent" → `sent`. **"Pending" means queued, not sent yet** → `new`
  (confirmed by the owner). A dashboard status is written to the sheet only when it differs from what the sheet already implies.
- Contact ids for sheet rows are `s:<sheet>:<row>`, stable across re-imports. `importWorkbook` merges by id (and by ref for people added
  from the dashboard that were already saved into the file) so workflow state (status, dates, drafts) survives a re-import.

## Follow-up logic (`src/lib/followups.ts`)

- `nextAction(contact)`: `new` → reach out; `drafted` → send; `sent`/`followed_up` → follow-up #n after `firstAfterDays`/`nextAfterDays`
  from `lastTouchAt ?? sentAt`, until `maxFollowUps`, then "move on?" after `moveOnAfterDays`. `snoozeUntil` pushes the due date later.
  Banks with status paused/moved_on suppress reminders.
- **Live cap:** the owner keeps at most **2 live people per bank** (`followUp.livePerBank`). "Live" = drafted/sent/followed_up with no
  reply. The Bank board shows `x/2 live` and suggests the next `new` contact when a slot opens. Drafts warn (but don't block) when over the cap.
- Reminders (`src/lib/reminders.ts`): one digest per day at 9am. Channels are browser Notification (only while the app is open), ntfy,
  Twilio, WhatsApp (CallMeBot, send-now), and .ics export. There is **no server cron**, because the server has no data. A true server-side scheduler would need a DB.

## Conventions

- Client pages are `"use client"` and render only after store hydration (`Shell` → `useHydrated`). Server routes import `server-only`.
- UI primitives are in `src/components/ui.tsx` (Button, Card, Badge, Modal, toast…). Design tokens are in `src/app/globals.css`
  (paper / navy / brass palette, IBM Plex Sans/Mono, Instrument Serif headings). Match the existing density and tone.
- Validate route bodies with zod and return errors via `errorResponse`. Error messages are shown to the user, so keep them actionable.
- Don't use `window.alert`. Toasts are the pattern. `window.confirm` is used only for bulk destructive actions.

## Status / known gaps (as of 2026-09-24)

- Built and `npm run build` passes. The parser was verified on the owner's workbook (106 contacts, round-trip OK).
- **Not yet click-tested in a browser**, and no live calls have been made to Apollo/Serper/Anthropic/Gmail with real keys.
  Things most likely to need fixes on first real use:
  - Apollo response field names (`matches`, `email_status`, placeholder `email_not_unlocked@…`).
  - Gmail OAuth origin setup.
  - Serper result title parsing (`parseLinkedInTitle`).
- ExcelJS can drop some exotic formatting (charts/pivots) on save. Check a saved copy before trusting in-place save on a new workbook.
- Legacy `(NY)` tabs in the owner's workbook (EVR (NY), LAZ (NY), MC (NY)) are still read. New people always go to the main tab.
  They could be merged into the main tab manually.
