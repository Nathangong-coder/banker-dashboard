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
npm run check:templates -- "file.docx" ["Sender Name"]  # template-doc importer output (PROFILE='{"school":"UCLA",...}' to generalize)
```

There is no unit test suite. `check:workbook` and `check:templates` are the regression checks for the two parsers.
Open work is tracked in **TODO.md**. The next big item is the real 9am WhatsApp ping (Vercel Cron + storage).
The owner's real workbook (`IB Recruiting - Master Spreadsheet vF.xlsx`) sits in the repo root locally but is **git-ignored and must
never be committed** (`*.xlsx`, `*.pdf`, `.env*` are ignored). The same goes for `Follow up Templates.docx` (the owner's template source; commit it only if asked).
`.env` holds the owner's Google CLIENT_ID/CLIENT_SECRET. The secret is **not used anywhere and must never be exposed**. `.env.local` sets
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` (not secret) as the deployment's default Gmail client.

## Architecture: where things live

- **All user data is client-side.** A Zustand store (`src/lib/store.ts`) is persisted to IndexedDB via `idb-keyval`. Large blobs (the
  original workbook ArrayBuffer, parsed sheet snapshots, the resume, the File System Access handle) are stored under separate
  `blob:*` keys through the `blobs` helper, not inside the JSON-persisted state. There is no database and no auth.
- **Bring your own keys, several per service.** `settings.vault.{apollo,hunter,serper,ai}` are ordered `ApiKeyEntry[]` lists.
  Every key is live-tested by `api/keys/test` **before** it's stored (`components/KeyVault.tsx`); single-value connections
  (Gmail, WhatsApp, ntfy, Twilio) are also saved only after a successful test. `lib/api.ts#callApi` sends all usable keys as
  JSON-array headers (`x-apollo-keys`, …) plus `x-ai` = `{provider, model, keys[], baseURL}`. On the server,
  `lib/server/keys.ts#withFallback` tries keys in order and falls through only on key problems (401/402/403/429/credits/quota).
  Server routes are **stateless proxies** that must never log or store keys. User-supplied base URLs go through
  `assertPublicHttps` (SSRF guard).
  - `api/enrich`: Apollo `people/bulk_match` (≤10 per call), then Hunter email-finder as a fallback.
  - `api/prospect/search`: Serper (Google search of `site:linkedin.com/in`), plus optional Apollo `mixed_people/api_search` → `bulk_match` by id.
    Apollo search returns obfuscated last names and no LinkedIn, so a match call (which costs credits) is needed to reveal them.
  - `api/prospect/filter`: AI screens candidates against the user's criteria text (structured output).
  - `api/draft`: `mode: "assign"` picks a template per contact; `mode: "fill"` rewrites `[[AI: …]]` slots.
  - `api/notify`: ntfy push (optional `At` delay, max 3 days on ntfy.sh), Twilio SMS (`ScheduleType=fixed` needs a MessagingServiceSid),
    or WhatsApp via CallMeBot (`GET api.callmebot.com/whatsapp.php`; self-only, send-now, no scheduling, free for personal use).
- **AI:** AI SDK 7 (`generateText` + `Output.object`; `generateObject` is gone). `lib/server/ai.ts#makeModel` supports anthropic,
  openai, google (Gemini), deepseek, glm (Z.ai via openai-compatible; China base `open.bigmodel.cn/api/paas/v4`), gateway, and custom
  OpenAI-compatible. Routes call `withAi(req, model => generateText(...))`. The provider is chosen explicitly in Settings, **never guessed from the key**:
  a Gemini key once got routed to the Gateway ("Unauthenticated… AI_GATEWAY_API_KEY"). The v1→v2 store migration guesses once from prefixes.
  `lib/keys.ts#pickDefaultModel` picks a default from the provider's model list (watch substring traps: "gemini" contains "mini").
- **Gmail is 100% browser-side** (`src/lib/gmail.ts`): Google Identity Services **token model** popup, which needs only a Client ID and no secret.
  The Client ID comes from `lib/keys.ts#googleClientId` (user's own, else `NEXT_PUBLIC_GOOGLE_CLIENT_ID`). The Google Cloud client must list the site under
  *Authorized JavaScript origins* (not redirect URIs). `connectGmail` rejects partial consent. Setup guide + error explainer: `components/GmailSetup.tsx`.
  Scopes: `gmail.compose` + `gmail.readonly`,
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

## Saving to the local .xlsx (`src/lib/files.ts`, `actions.ts#saveWorkbook`)

- The File System Access API (Chrome/Edge) keeps a handle in IndexedDB. After a reload, `ensureWritePermission` re-prompts.
- `readHandle` retries `NotReadableError` ("state cached in an interface object … changed since it was read from disk"),
  which OneDrive or Excel cause by touching the file mid-read. `friendlyFileError` maps DOMExceptions to fixes (close Excel, "Always keep on this device").
- Before an in-place save, if `file.lastModified` differs from `workbook.lastModified`, the disk version is re-imported as the new
  baseline (manual cell edits are kept) and dashboard patches are re-applied, so edits made in Excel aren't clobbered.

## Templates (`src/lib/template.ts`, `src/lib/templateImport.ts`, `src/lib/defaults.ts`)

- Placeholders `{{…}}` (list in `PLACEHOLDERS`). **Empty values are left visible** so the AI or the user fills them; `a/an {{x}}` gets the right
  article. `[[AI: instruction]]` slots are written per contact by `api/draft` (fill mode). Follow-ups use `step` (1, 2) via `followUpTemplate`.
- `DEFAULT_TEMPLATES` = 14 templates adapted verbatim from the owner's "Follow up Templates.docx", with sender details turned into `{{my_*}}`
  (profile fields: pitch, club, schoolNickname, schoolCity). Existing users get them via Drafts → "Add N starter templates".
- Import: `docxToBlocks` (jszip + regex over `word/document.xml`; Google Docs tabs export as `Title` paragraphs, and all-bold lines are sub-sections)
  → `parseTemplateBlocks` (greeting line = email start, the line above = subject, ALL-CAPS blanks → placeholders, NAME resolved by position,
  unknown caps → flagged `[[AI: …]]`) → optional `api/templates/organize` AI pass, whose edits are **discarded unless `sameWording` holds** →
  review modal (`components/TemplateImport.tsx`) → upsert by template name. Google Doc links: `api/templates/gdoc` (docs.google.com only).

## Finding people (`app/api/prospect/search`, `src/lib/linkedinCapture.ts`)

- Web search: `webSearch` tries the Serper keys, then falls back to Brave (`x-brave-keys`; free plan = 1 req/s, so queries run sequentially).
  Brave reports a bad key as **422 SUBSCRIPTION_TOKEN_INVALID**, which is mapped to 401 so key fallback works. Keep default queries ≤ ~30 words
  (`queryWordCount`), since Google truncates at 32. Store v3 migration swaps the old too-long defaults if untouched (`LEGACY_QUERIES_V1`).
- **LinkedIn policy decision:** no server-side or automated LinkedIn scraping (ToS §8.2 + account-ban risk from datacenter IPs). The owner
  asked for scraping; the agreed alternative is the user-clicked bookmarklet (`bookmarkletHref`), which reads only the current LinkedIn page's
  DOM and opens `/find#li=<json>`. `parseCapture` treats the payload as untrusted (caps sizes, sanitizes the slug). The bank comes from
  `guessBank` over known banks, else the AI filter's `employer`. React blocks `javascript:` hrefs in JSX, so the href is set via ref.
  The LinkedIn DOM changes often: the script keys on `a[href*="/in/"]` + nearest `li`, not on class names.

## Bank coverage (`src/lib/coverage.ts`, `src/lib/banks.ts`, `app/coverage`)

- `buildCoverage` merges banks by `canonBank()` (aliases + stop-words; test new aliases against the owner's names) from: contacts →
  bank tabs (`tables`, even with 0 contacts) → `targets` (target-list tabs, parsed by `workbook.ts#extractTargets`) → `coverage.added`
  → optional `STARTER_TARGETS`. Buckets: reached (any `sentAt` or sent/replied status) / ready (active contacts, none reached) / cold / hidden.
- Target lists: row style (header "Institution Name" [+ "Institution Type", "#"]; rows need a numeric # and a bank/PE-ish type) or
  column style (≥3 category headers; only `DEFAULT_TIERS` kept). `cleanBankName` strips "(MS) & MS NY)" noise.
- Workbooks imported before this existed get `targets` backfilled by re-parsing the stored blob on the coverage page.
- Deep links: `/find?banks=A|B` (pipe-separated), `/drafts?bank=Name`, `/sheet?view=contacts&filter=noemail&bank=Name`.

## Gmail sync (`src/lib/gmailSync.ts`, `components/GmailSyncWidget.tsx`)

- `syncAllWithGmail({interactive})` is single-flight. Contacts with an email → `gmail.ts#syncContact` (first sent, follow-ups counted
  up to the first reply, reply date, thread/Message-ID for in-thread follow-ups). Contacts without one → `findEmailByName` (Sent-mail
  search by name, accepted only if `addressMatches` the display name or mailbox), throttled by `gmailCheckedAt` (12h).
- `patchFrom` only moves status/follow-up counts forward. Non-interactive runs never open Google's popup; the widget re-syncs every
  20 min once a token exists this session (`onGmailConnected`). Token model = one click per session. True background sync needs the
  server-side refresh-token flow (client secret + DB), tracked in TODO.md with the 9am ping.

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
- **Not yet click-tested in a browser** (the browser tool was denied in-session). No live calls have been made with *real* keys.
  Every provider's key test *was* exercised with fake keys: each rejects cleanly, multi-key fallback reports "All N … keys failed", and the SSRF guard blocks private IPs.
  The owner's Google Client ID was confirmed to exist (auth endpoint answered `redirect_uri_mismatch`, not `invalid_client`).
  Things most likely to need fixes on first real use:
  - Apollo response field names (`matches`, `email_status`, placeholder `email_not_unlocked@…`).
  - Gmail OAuth origin setup.
  - Serper result title parsing (`parseLinkedInTitle`).
- ExcelJS can drop some exotic formatting (charts/pivots) on save. Check a saved copy before trusting in-place save on a new workbook.
- Legacy `(NY)` tabs in the owner's workbook (EVR (NY), LAZ (NY), MC (NY)) are still read. New people always go to the main tab.
  They could be merged into the main tab manually.
