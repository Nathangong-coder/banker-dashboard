@AGENTS.md
@docs/outreach-rules.md

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
npm run check:coverage -- "path/to/file.xlsx" # scoreboard for no desks / SF Tech / NY Generalist / both (must all differ)
npm run check:outreach                        # outreach rules: one rendered email per affinity, 80/20 + 70/30 shares, send window
npm run check:firms [-- "file.xlsx"]           # built-in firm facts: collisions, golden cases, guardrails, freshness, tab vs lists
npm run check:contrast                        # WCAG AA contrast of the palette pairs the UI uses (globals.css tokens)
npm run check:scheduling                      # availability → their time zone, calendar busy, phones, invite text
npm run check:selectors                       # no zustand selector returns a fresh object/array (React #185 "This page couldn't load")
npm run check:conversations                   # Conversation table: rows link to people (no duplicates), "• " lines only, idempotent writes
```

There is no unit test suite. `check:workbook` and `check:templates` are the regression checks for the two parsers.
Open work is tracked in **TODO.md**. The next big item is the real 9am WhatsApp ping (Vercel Cron + storage).
The owner's real workbook (`IB Recruiting - Master Spreadsheet vF.xlsx`) sits in the repo root locally but is **git-ignored and must
never be committed** (`*.xlsx`, `*.pdf`, `.env*` are ignored). The same goes for `Follow up Templates.docx` (the owner's template source; commit it only if asked).
`.env` holds the owner's Google CLIENT_ID/CLIENT_SECRET. The secret is used **only server-side** for automatic sending (Vercel env
`GOOGLE_CLIENT_SECRET`, sensitive, never sent to the browser) and **must never be printed, logged or committed**. `.env.local` sets
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` (not secret) as the deployment's default Gmail client.

## Architecture: where things live

- **All user data is client-side** (except the automatic-sending slice below). A Zustand store (`src/lib/store.ts`) is persisted to IndexedDB via `idb-keyval`. Large blobs (the
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
- **Resume** (`components/ResumeCard.tsx`, on Settings → Profile and /drafts): one file in `blob:resume`, `state.resumeAddedAt`. Attached
  only to first cold emails (`template.kind === "initial" && attachResume`); follow-ups and scheduling replies never attach it. Replacing it
  doesn't touch existing Gmail drafts; the card counts unsent ones made before the upload ("Update Gmail draft" re-attaches).

## Spreadsheet model (`src/lib/workbook.ts`): read this before touching it

- Parsed with ExcelJS **in the browser** (dynamic import). A contact table is any row whose headers include Name (or First+Last) **and**
  Email or LinkedIn. Header synonyms are in `HEADERS`. A tab titled "X Application Tracker" makes X the bank.
- The owner's bank tabs have two tables: a "Conversation" table (row 5) and a "Contact Information" table (row ~18, the one with LinkedIn
  and Status). The same person in both is merged by `dedupe`, which prefers the LinkedIn table as the write-back target.
- **Regions:** `Region = SF | LA | NY | CHI | Other` (`types.ts#REGIONS`). `detectRegion` checks NY, Chicago, LA (LA before SF: "Los Angeles,
  California" is LA), then Bay Area. An unmapped city is "Other". Only a blank location on a bank tab defaults to SF (it used to default
  everything, which put Chicago on the West Coast). Store v5 migration re-detects regions.
- **Titles:** `lib/titles.ts#currentTitle` takes the headline's first seniority word, skipping former/ex/incoming. Find uses
  `reconcileTitle(headline, aiPosition)`, since the AI screen sometimes returned an old role from the snippet. v5 migration fixes non-sheet
  contacts whose headline disagrees.
- **Region:** SF and NY people share **one bank tab**. The region is read from the Location (or legacy `Location/Team`) text (`detectRegion`),
  with legacy `(NY)` tabs as a fallback, and bank tabs otherwise default to SF. When the region is changed by hand, `locationForRegion` sets the
  location to the region code. `allocateRow` always prefers the main (non-"(NY)") bank tab.
- **Location vs team** (`src/lib/locationTeam.ts`): contacts have separate `location` ("SF", "Menlo Park") and `team` ("Tech", "RX").
  A combined `Location/Team` cell is read with `splitLocationTeam` and written back as `joinLocationTeam` ("SF · Tech"), compared by meaning
  so untouched cells are never rewritten. Sheet view's "Split Location/Team" (`splitLocationTeamPatches`) renames the header to Location and
  uses the table's first empty column (G on the owner's tabs) as Team, as reviewable manual patches. On save, `locationTeamDropdowns` adds
  Excel list validations with the error alert off (pick or type). Options = defaults + every value in use (`locationTeamOptions`), which is how
  "self-add" works. Store v4 migration splits old combined `location` values.
- **Write-back never mutates the original directly.** The grid shows `snapshot + patches`. Patches = `contactPatches(contacts, snapshots)`
  (derived: found emails, status changes, location/position edits, new people in blank numbered rows) merged with manual cell edits
  (`state.patches`). `buildWorkbook(originalBuffer, patches)` produces the file. After a save, the saved file becomes the new baseline
  (`saveWorkbook` re-parses it).
- **Grid edits are live:** `setCell` runs `syncGridEdits`, which parses the sheets (`parseSnapshots` over `applyPatches(snapshots, patches)`)
  before and after the edit and applies only the difference to contacts. A name typed into a contact table adds a contact, and later cell edits update it.
  Clearing the name removes the contact only if the dashboard holds no work for it. The list view's "Add contact" (`components/AddContact.tsx`
  → `actions.ts#addManualContact`) creates a `source: "manual"` contact in an `allocateRow` slot.
- **Formatting:** `readFormat` stores per tab `SheetSnapshot.format`: deduped cell styles (fill, font color, bold/italic/underline, size,
  alignment, wrap, borders; theme colors resolved from the workbook theme XML + tint), column widths / row heights in px, merges, and
  hidden rows/cols. SheetGrid renders it inline (merges as row/colSpan, off while "Contact rows only" is on). Unsaved cells keep the
  brass/green highlight on top. Snapshots from before this (`format.version !== FORMAT_VERSION`) are upgraded once in `Shell` from the
  stored workbook blob (`readFormats`).
- **Links between tabs** (`src/lib/sheetLinks.ts`): ExcelJS 4.4 drops `<hyperlink location="MS!A1">` on read and can't write them
  (it makes every link an external relationship), so every save used to strip OVERVIEW → bank tab and each title → OVERVIEW.
  They're read from the sheet XML with JSZip into snapshot cells as `link: "#MS!A1"`, and `buildWorkbook` writes them back into the
  saved XML (original links + patches; retyping keeps the link, clearing removes it). SheetGrid follows them (opens the tab, selects the
  cell). A link to a missing tab (the owner's ACTIVE BAY has `null!A1`) falls back to the tab whose bank matches the cell text.
  FORMAT_VERSION 2 re-reads links for older imports. Verified in real Excel via COM (Hyperlinks.SubAddress + Follow).
- **Ctrl/Cmd+S** (`WorkbookControls#useSaveShortcut`, mounted in Shell) blocks the browser's "Save page" and saves the workbook in place.
- Grid edits sync against `derived + manual` patches, so edits to a row that only exists as a pending dashboard write (Add contact /
  Find people) reach that contact. A non-sheet contact "owns" its row. Drafts shows `comment` (column J, Connection / Comment) as Notes.
- **Mass delete / reset** (store `deleteContacts`, `deleteRows`, `resetTracker`; `workbook.ts#blankTablesPatches`): All contacts →
  select → "Delete N" (optionally their rows, shifted up per table bottom-up; the row's old id is dropped from the match set
  because the person below inherits it). The grid's Delete row on a multi-table selection (Ctrl+A) deletes each table's part
  separately, keeping banners/headers. "Reset tracker" blanks every contact table (or one tab) as pending patches, or downloads
  a blank copy (`actions.ts#downloadBlankCopy`); headers, `#`, other tabs and formatting stay. All are one Ctrl+Z step.
  The "Not in the spreadsheet" filter lists dashboard-only contacts (`!ref`). `importWorkbook` merges by id only when
  `samePerson` (name / email / LinkedIn), so another workbook's row 19 doesn't inherit the old row 19's status, and a pending
  dashboard contact whose row is taken in the imported file loses its `ref` instead of overwriting someone.
- **Row → contact:** rows the parser can't see as people (no name in a table, or not in a table at all) get a "+" by the row number when
  `draftFromRow` reads a person from them. Outside a table it needs a LinkedIn or an email, since labels like "Bulge Bracket" look like names.
  Clicking opens AddContact pre-filled, with `ref` = that row (the table's columns, or the columns the values were found in). On the owner's
  workbook no existing row gets a "+", so keep it that way when loosening the heuristics. The tab bar search matches tab names and bank names (`canonBank`).
- **Grid (`components/SheetGrid.tsx`) is Excel-like:** click/drag/Shift selection, arrows/Tab/Enter, type-to-edit, a formula bar, Delete clears,
  copy/cut/paste as TSV (pastes from Excel; one value fills a block), Ctrl+Z (`state.gridUndo`, 50 steps, session-only, reset on import/save),
  and a right-click row menu. **Row delete/insert (`workbook.ts#shiftTableRows`, `store#shiftRows`) shift values only inside the contact table**
  (`tableBody` stops at section banners like "Contact | Information"). They leave the "#" column alone, and outside tables rows can only be
  cleared. The owner's tabs have merged banners but no formulas, and a whole-sheet value shift would break the merges. Moved contacts are
  renumbered (`s:<tab>:<row>` ids) so a re-import after saving matches. A deleted row's contact is dropped, or kept as `source: "manual"` if it
  has dashboard work. Cells a moved contact writes itself are removed from the shifted manual patches so derived values win.
- **Status mapping** (`statusFromSheet` / `STATUS_TO_SHEET`): "Sent" → `sent`. **"Pending" means queued, not sent yet** → `new`
  (confirmed by the owner). A dashboard status is written to the sheet only when it differs from what the sheet already implies. A bare **"Scheduled" = an email queued with Gmail's Schedule send** → `drafted` (checked against the owner's Gmail;
  "Call scheduled"/coffee/meeting → `call_scheduled`). "Removed"/"Bounced" → `ignored`. `followUpsFromSheet` reads "(2x)".
  On re-import (`store#importWorkbook`) a Status cell that changed since the last import (Excel edit, or a Gmail backfill) wins
  over the dashboard's status; `saveWorkbook` re-baselines `sheetStatus` so the dashboard's own writes don't count as edits.
- Re-import: an email that came from the sheet follows the sheet (clearing a wrong address in Excel clears it in the
  dashboard); emails the dashboard found (Apollo/Hunter/Gmail) are kept until saved.
- **Contacted column** (`src/lib/contacted.ts`): send dates live in the workbook. Contacted = the FIRST email only ("9/17/2026",
  "Scheduled 10/6/2026 9:00 AM"); the latest email or call goes to its own **"Last emailed/contacted"** column (owner, 2026-10-19;
  `LAST_CONTACTED_HEADERS`, added after the table, K on the owner's tabs). Legacy combined cells ("9/17/2026 · last 9/25/2026") are
  still read and get split on the next save. Read into `sentAt` / `lastTouchAt` (before a reply) or `lastEmailedAt` (after) / `scheduledAt`. `contactPatches` writes them, adding
  the header in the empty column left of Status (H on the owner's tabs; GS already had "Contacted") when missing, and
  compares by meaning so the owner's own formats aren't rewritten. Before this the sheet had no dates at all, so every
  "Sent" person showed as due ("sent date unknown").
- **Referral? column** (owner, 2026-10-20; `lib/checkboxes.ts`): every contact table gets a "Referral?" header after
  "Last emailed/contacted" (L on the owner's tabs; that header is added first so the order is the same everywhere), styled like
  the nearest real header. Saved as **native Excel cell checkboxes**: `buildWorkbook(…, checkboxes = referralColumns(tables))`
  turns yes/no/blank cells into booleans and `writeCheckboxes` re-adds the checkbox cell format + `featurePropertyBag.xml`
  (ExcelJS drops both on every save; XML copied from what Excel 365 writes, verified via COM `CellControl.Type = 2`). Free text
  in the column is left alone. Ticked = `contact.referral` (the same flag as /prep's "They referred me"); `sheetReferral` is the
  baseline, so a box ticked/unticked in Excel or the grid wins on re-import (`mergeReferral`; a brand-new column only adds).
  The grid shows the cells as clickable checkboxes. Older Excel shows TRUE/FALSE. A sheet tick is dated `referralDate` (the
  latest chat / call / reply / email, else now). Stats (home Referrals tile + funnel, Firms count + score) read `contact.referral`.
- **Excel edits are picked up live** (`actions.ts#pickUpExcelEdits`, `Shell#useExcelEdits`: on load, tab focus, every 60 s while
  visible): file on disk newer than `workbook.lastModified` → re-imported like a save's rebase (unsaved edits kept), toast
  "Picked up your edits from Excel". Only when read permission is already granted (`files.ts#canReadSilently`); after a
  browser restart that takes one Save click. `fileBusy` keeps it and `saveWorkbook` from running at the same time.
- Contact ids for sheet rows are `s:<sheet>:<row>`, stable across re-imports. `importWorkbook` merges by id (and by ref for people added
  from the dashboard that were already saved into the file) so workflow state (status, dates, drafts) survives a re-import.

## Automatic sending (server; `app/api/server/*`, `lib/server/{accounts,google,jobs}.ts`, `lib/serverSync.ts`)

- Provisioned on Vercel (team claude-hackathon, project banker-dashboard): **Upstash Redis** (`KV_REST_API_URL/TOKEN`) and
  **Upstash QStash** (`QSTASH_*`), both free plan, Redis auto-upgrade off. Env also has `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `SERVER_ENC_KEY` (32-byte base64, AES-256-GCM for the refresh token and CallMeBot key). QStash, not Vercel Cron: Hobby cron is daily only.
- **Accounts:** the browser makes `settings.server = {id, token}` (random) and calls with `Authorization: Bearer id.token`; the server keeps
  only sha256(token) (`authAccount`, created on first call). Redis: `acct:<id>` (tz, sealed Google refresh token + email, sealed WhatsApp,
  14-day digest plan), `sends:<id>` hash (one field per Gmail draft, so sync and jobs don't clobber each other), `digestday:<id>`, `accts` set.
- **Gmail:** "Turn on automatic sending" (/followups → Reminders) → `google/start` (state in Redis, 10 min) → Google consent (scope
  `gmail.compose` only, offline, prompt=consent) → `google/callback` stores the sealed refresh token → back to `/followups?tab=reminders&server=connected`.
  The Google client needs redirect URI `https://banker-dashboard-three.vercel.app/api/server/google/callback` (added 2026-10-06) and the
  consent screen **In production** (Testing = refresh tokens die after 7 days). Users never touch Google Cloud: they all use this client.
  Unverified app with a restricted Gmail scope: users click through Google's warning, and Google caps it at 100 users until verified.
- **Queue:** `contact.serverSend {draftId, step, sendAt}` (0 = first email, n = follow-up #n), set by "Draft & schedule all" / "Schedule N"
  (`queueSends`, slot = `followups.ts#nextSendSlot().at`). `syncServer` (Shell `useServerSync`: 4 s after changes + every 10 min) pushes the
  queue + `reminders.ts#digestPlan`; `sync` publishes one QStash job per send (`notBefore`, dedup id) and drops cancelled ones. `run-send`
  (signature-verified) sends the draft via `drafts.send` unless it was cancelled/rescheduled (sendAt mismatch); 404 = "missing". Results go back
  in the sync response, `applyFinished` moves the contact on (sent / followed_up, dates, threadId) and acks them. `nextAction` treats a
  future `serverSend.sendAt` like Gmail Schedule send (`queuedAt`).
- **Send mode** (`settings.sendMode`, switch above "Follow-ups due"): "Coverage sends them" (server queue) or "Gmail Schedule
  send (I click)" (drafts only; the user schedules each in Gmail, since the Gmail API has no Schedule send). Undefined = Coverage
  when connected. Switching modes doesn't cancel sends already queued (they keep their Cancel button under Scheduled).
- **9am text:** QStash hourly schedule → `tick`: accounts at local 9:00–20:59 without today's text get `digestMessages` (shared
  `lib/digestFormat.ts`) of the synced plan minus people the server followed up since, via CallMeBot. `getset` on `digestday` prevents doubles;
  failures roll back and show on the card. With the server on, the browser's own 9am send (`useDailyWhatsApp`) stands down.
- Tested 2026-10-06 against the real Redis with a local `next start` (create/auth/401/cancel/unsigned-job/disconnect) and Google's auth
  endpoint (prod redirect accepted, unregistered → redirect_uri_mismatch). The full send path needs the deployment.

## 9 PM text, firms, transcripts (2026-10-19)

- **The WhatsApp text is 9 PM Mon–Thu** (replaced the 9am one; `digestFormat.ts#TEXT_DAYS/TEXT_HOUR/nextTextDay`). It lists what's
  due by the end of the *next* text night (Thu covers Fri–Mon), so emails get scheduled the night before, never "day of".
  `reminders.ts#nightPlan` (pushed to the server as `digests`) = `relationshipItem` per person (thank-you for a call/logged chat today,
  thank-you still owed ≤14 days, reply owed when `lastHeardAt > lastEmailedAt`, check-in 7 days after your last email until
  `referral` is set or status done) + follow-ups. The server (`api/server/tick`) adds today's **Google Calendar** events
  (`google.ts#eventsOn`, optional scope `calendar.events.readonly` asked with Gmail; `account.google.calendar`), matched by
  `calendarMatch.ts#matchEvent` against `account.people` (attendee email → full name → unique first name; unmatched chat-like titles
  kept), and ends with the "update the tracker" line when there were calls. Old connections lack the scope: AutoSend shows "Reconnect".
  `npm run check:night` covers it. Gmail sync now records `lastEmailedAt` / `lastHeardAt` (replies after the first reply included).
- **Calendar page + after-call links (owner, 2026-10-20):** `/calendar` (Prep & reminders, first) lists coffee chats + info
  sessions (3 weeks back, ~6 ahead). "Sync Google Calendar" (also on open, ≤ every 5 min) = `components/CalendarActions.ts#syncCalendar`
  → `api/server/calendar` (all events, nothing stored) + `loadCalendarSessions`. `lib/calendarDay.ts#chatsIn`: a chat = the
  dashboard's own invite (`call.eventId`), a contact as attendee, or a chat-like title with ≤3 guests (name match only then);
  `callPatches` sets `contact.call` (next upcoming, else latest) and status up to call_scheduled, so the text and Follow-ups see
  it. Rows: Prep before; after = "Log how it went" (`/log?log=<id>&kind=coffee_chat&date=YYYY-MM-DD` opens the pre-filled form)
  + LinkedIn (profile, else a name + bank search). **Guest list wins over names (owner, 2026-10-20):** an event with guests only
  matches a contact whose email is a guest or who has no email on file (`calendarMatch.ts#couldBeWith`, also applied to
  events already on a contact). "Coffee w/ James" sent to a friend's Gmail had matched James Nichols by first name and
  kept matching via `call.eventId`; `calendarDay.ts#wrongCalls` removes such calls on the next sync (status back to what
  the emails say, unless a chat is logged) with a history note. The evening text adds `digestFormat.ts#afterCallLines` per person talked to
  today (log link + LinkedIn), skipped once that day's chat is logged (`CalPerson.loggedAt`); **Fri–Sun it goes out only when
  there were calls** (no follow-ups section). **No automatic LinkedIn connection requests:** LinkedIn has no API for it and
  automating it breaks its terms (same decision as scraping); the text links the profile for a one-tap Connect.
- **Follow-up spacing when scheduling:** `followups.ts#earliestSend` (last email + first/nextAfterDays) is passed as `notBefore` to
  `planSends` / `planBatch`, so a follow-up is never queued early (Will Yi's #2 was queued Tue, 5 days after #1). `planSends` records
  why someone isn't on the first open day (`why`, kept as `serverSend.why`). Follow-ups → Scheduled shows a "too soon" badge and "Move too-early sends" (`serverSync.ts#fixEarlySends`).
- **Spacing counts calendar days (owner, 2026-10-20):** "N days after" = any slot on that day in the recipient's zone
  (`sendWindow.ts#tooSoon`). It was to the minute, so Joseph Nichols (first email Thu 10/15, late morning) was queued for
  Tue 10/27. `serverSync.ts#lateSends` / `moveLateSends` = Follow-ups banner for queued follow-ups past the 6-8 day range.
- **Random days and minutes, no cap (owner, 2026-10-20, for reply data):** `planSends` gives each follow-up a random allowed
  day 6, 7 or 8 days after the last email (`earliestSend` = setting − `FOLLOW_UP_SPREAD`; never sooner than 6; past the range
  only if no send day falls in it) and each first email a random one of the next 3 send days (Tue/Wed/Thu). The minute is
  random in the window, never a multiple of 5 (round times look scheduled), ≥3 min from other sends in that zone/day; no
  per-day cap (the old 6-min grid + 20 cap is gone). `why` says the gap ("Wed, 6 days after your last email"). Server-sent
  follow-ups record `contact.followUpLog {step, at, gapDays}`; the lab's "Follow-up gap" / "Follow-up day" dimensions read it
  (`segments.ts`; Gmail Schedule-send follow-ups aren't logged). `check:outreach` + `check:night` cover it.
- **Date bug (Michael Bender):** a save re-imports the file from disk when OneDrive/Excel touched it; a Contacted cell saved before a
  follow-up ("10/1/2026") replaced the follow-up's `lastTouchAt`, so follow-up #2 was timed from the first email. Merges now take
  `util.ts#latestIso` (store import + workbook dedupe): the last touch never moves back.
- **/firms** (`lib/firmScore.ts`): per `canonBank` stats and a 0–100 score (replies 35, smoothed toward the overall rate; calls 25;
  referrals 25; avg chat grade 15) + your stars/notes in `coverage.ratings`.
- **Transcripts** (`components/ChatGrades.tsx` on /prep, `api/prep/grade`): upload .txt/.vtt/.srt/.md/.docx or paste → AI rubric grade,
  improvements, the banker's commitments, thank-you points; saved as `contact.chats[]`. "They referred me" sets `contact.referral`.
- **Grader rubric (owner, 2026-10-20):** 7 weighted areas with 5/3/1 anchors (`grade/route.ts#AREAS`: Connection & energy 25,
  Personal rapport 20, Listening 15, Questions & prep 15, Opening 10, Asks 10, Close 5); the overall score + letter are computed
  server-side from them (`lib/gradeRubric.ts`; all 3s = 71 C-, all 4s = 84 B), not by the model. **Admin:** Settings → Backup →
  Admin mode adds Activity log ⋯ → Grading rubric (`components/RubricEditor.tsx`: areas, weights, anchors → `settings.prep.rubric`,
  sent as `rubric`, `cleanRubric` falls back to `DEFAULT_RUBRIC`). Admin mode is a view switch, not a lock (no logins). Tone: transcripts (Granola, Zoom) drop laughter, so the
  grader reads cues (haha / [laughter], long stories, running over) and trusts `ChatLog.feel` ("How it felt", typed on /log and
  /prep); no signal = 3, never a penalty. `toneRead` explains it. Advice the banker gave goes to `theirAdvice`, never into
  `improvements` (they used to just echo it). **Your rules beat the rubric:** `settings.prep.gradingRules` (default
  `defaults.ts#DEFAULT_GRADING_RULES`: long personal chats are a strength, never cap them) are sent with every grade;
  "Disagree" on any rubric line / improvement (`components/GradingRules.tsx`) adds one; /log ⋯ → Grading rules edits them.
  This is the first step of the owner's idea of human feedback steering the grader; info sessions aren't graded yet.
- **Bank brief** (`components/BankBrief.tsx` on /prep, for the selected contact's bank or any bank typed in its picker; `api/prep/bank`):
  webSearch (≤6 queries: per sub-vertical, the sector, the bank's culture/program) → AI returns ≤6 recent deals the bank advised on in
  `settings.prep.interests` (sector → sub-verticals; default Tech → Software, Internet, Vertical software; edited in Settings → Profile
  and inline on /prep via `components/PrepInterests.tsx`) plus a 3–5 bullet + ~60-word "Why <Bank>". Each deal cites a result number;
  deals whose number isn't a real result are dropped server-side. "Why" is grounded in `BankBrief.tsx#bankNotes` (firm notes,
  BankMeta notes, contacts' comment / call notes / chat notes / grade summary + thank-you points), bullets marked `fromNotes` with who;
  no notes = flagged generic. No Serper/Brave key = 400 pointing to Settings → Data. Cached in `coverage.bankBriefs[canonBank]`
  (`BankBrief` type in coverage.ts) until Refresh; an amber badge shows when the interests changed since.

## Info sessions (server side, 2026-10-19)

- Pure helpers in `lib/infoSessions.ts` (title match/parse, `reminderDue`, `followUpTiming`, `CalendarSession`, `CaptureItem`).
  `google.ts#listEvents` (timed + all-day, cancelled/declined dropped, paginated) → `infoSessionsBetween` (title filter,
  `plainText` description ≤600, `meetingLink`) and `currentSession` (ongoing, else latest ended, optional hours limit).
- **Routes:** `server/infosessions` (authAccount, {from,to} ≤240 days → {calendar, sessions}; no Calendar scope = calendar:false);
  `server/capture/link` (authAccount, {rotate?} → {url: /capture#k=<id>.<captureToken>}); `server/capture` (authCapture,
  {text?, image? data:image/jpeg|png ≤2.5 MB, sessionId?}); `server/capture/sessions` (authCapture → −7d..+2d, {defaultId});
  `server/inbox` (authAccount, {ack?} → {items ≤30 and ≤~3.5 MB of images, oldest first, more}: Vercel caps responses at 4.5 MB, so
  the browser loops while `more`); `capture-share` (+ `/cookie`); `server/twilio/setup` ({sid,token,number,myPhone} | {remove} |
  {check}); `server/twilio/inbound` (signature-checked webhook, rate-limit exempt).
- **Capture token:** `account.capture = {hash, sealed}` (`accounts.ts#ensureCaptureToken/captureUrl/captureAccount/authCapture`).
  It only adds inbox items and lists sessions. Inbox = hash `inbox:<id>` + `capimg:<id>:<item>` (14-day TTL, max 200 items).
  `deleteAccount` removes them and `twnum:<number>`.
- **Phone page `/capture`** (PUBLIC_PATHS; a fixed full-screen overlay over Shell, no store): `#k=` → localStorage + cleared from
  the URL, sets the HttpOnly `coverage_capture` cookie (Path=/api/capture-share) for the manifest `share_target`, which has no
  service worker to add a header. Images are downscaled in the browser (≤1600 px JPEG q0.8) and sent one item each. The share route
  can't downscale (no sharp): >2.5 MB → a friendly page pointing to the capture page. Vercel's 4.5 MB request cap applies.
- **Twilio:** setup checks creds + number (IncomingPhoneNumbers), sets its SmsUrl to `/api/server/twilio/inbound`, stores sid/token
  sealed and `twnum:<E.164>` → account. Inbound: `To` lookup, AccountSid + X-Twilio-Signature (verified against Twilio's doc
  example), only `From === myPhone`, images ≤3 MB (not Twilio's 5: the inbox response cap), Body as a text item, session = ongoing
  or ended ≤6 h; replies with TwiML.
- **Tick:** every account with WhatsApp + `google.calendar` gets info-session texts on every hourly tick (any day): now±3h, timed
  only, `reminderDue`; claim `isr:<id>:<event>:<kind>` (NX, 3 days), deleted on a failed send. "after" links the capture page and
  `/info-sessions?id=<eventId>` (Mon–Thu "tonight", Fri–Sun "tonight or next week?"). CallMeBot is `lib/server/whatsapp.ts#sendWhatsApp`
  (the 9 PM text uses it too). AutoSend's "Info sessions" block: capture link (Copy / Text it to my WhatsApp / Rotate) + Twilio form.

## Info sessions (dashboard, 2026-10-19)

- **/info-sessions** (`app/info-sessions/page.tsx`; logic in `components/InfoSessionActions.tsx`, detail panel in
  `components/InfoSessionDetail.tsx`). Sessions live in `state.infoSessions` (`InfoSession`; calendar fields refresh via
  `upsertInfoSessions`, your fields stay). On open (with automatic sending connected) it reads 180 days back / 60 ahead from
  `api/server/infosessions` (via `serverSync.ts#serverCall`); all-day events come as "YYYY-MM-DD" with Google's exclusive end and
  are stored as local midnight → end of the last day (`allDayRange`), shown "time TBD". Not connected / no calendar scope → a banner
  pointing to Follow-ups → Reminders; "Add session" (id `man_…`) works without it. `?id=<session>` opens + scrolls to one.
  "Club" = firm not in `knownBanks` (starter list, workbook targets, coverage.added, contact banks, BANK_DOMAINS, by canonBank).
- **Phone captures:** `pullCaptures` (on open, every 2 min while visible, "Check phone captures"; single-flight) calls
  `api/server/inbox` with `ack` = the previous batch while `more`, reads each item with `api/infosessions/extract` (AI; the image is a
  `file` part with an image/* `mediaType`; emails kept only if literally written; no AI + text = one name per line, `namesFromText`),
  and adds the people to the session's `pending` (deduped by name, `captureIds`). Session = `item.sessionId`, else the latest session
  that started before the item and ended ≤ 12 h before it, else the "Unsorted captures" box (IndexedDB `infosessions:unsorted`, this
  browser), where you pick the session. Items are acked once stored.
- **Confirm** (`confirmPerson` / `confirmAll`): `addManualContact(…, toSheet=true)` with bank = person's firm || session firm,
  comment "Met at <title without (note)> M/D — note", `metAt` [{sessionId, at: start}]. A duplicate (same rules as addManualContact)
  is linked instead (metAt appended, comment line added). "Find emails" = `actions.ts#enrichContacts`.
- **Thank-yous** (`draftThankYous`): template `defaults.ts#INFO_SESSION_TEMPLATE` (`tpl_infosession`, added to your templates on
  first use, not a starter), `[[AI: …]]` slot removed when there's no note, AI fill via `api/draft`, `withSignature`, resume attached,
  `upsertDraft`, status drafted, `draftMeta.baseId = ""` (stays out of base A/B results). Only people never emailed with a verified
  address; VP+ without a tie skipped. With automatic sending (and sendMode ≠ gmail): tonight = `serverSend` now + 5 min, +3 min each
  (ignores the send window); next week = `planSends` with `notBefore` next Monday. Mon–Thu sessions show "Send tonight"; Fri–Sun
  (`followUpTiming` "choose") show "Send tonight" / "Next week", stored in `session.followUp`. Without it, drafts wait in Gmail.
- **Paste LinkedIn** (panel → People, `InfoSessionDetail#PasteLinkedIn`): their whole profile page (Ctrl+A, Ctrl+C) + "I
  especially liked your perspective on…" + optional URL → `readLinkedIn` (`api/infosessions/extract` with `profile`: name,
  current title/firm, location, school; no AI = first name-like line) → `addFromLinkedIn` confirms them straight into the
  tracker (no review), keeps the paste as `contact.profile`, then looks up their email. **Thank-you wording = the owner's
  (2026-10-20)**: `{{session}}` (`sessionName`: a bare "<Firm> Info Session" becomes "<Firm> Investment Banking Info Session")
  and `{{session_when}}` (`sessionWhenWord`, as of the send day: today / yesterday / on Monday / last week); the perspective
  clause is an AI slot rephrasing the note, inserted as typed without AI, removed with no note. Saved copies still on
  `INFO_SESSION_BODY_V1` are upgraded by `ensureTemplate`.
- **9 PM text:** `reminders.ts#relationshipItem` labels anyone met at a session that day, still new/drafted, nothing sent or queued,
  `LABELS.infoSession` ("Info session thank-you", ranked right after call thank-yous). `check:night` covers both cases.

## Email formatting & signature (`src/lib/emailFormat.ts`)

- Drafts are multipart/alternative. The HTML part is Gmail-native (`<div>` per line, `<div><br></div>` between paragraphs); text/plain alone
  gets hard-wrapped by Gmail at ~78 chars. `normalizeBody` removes indents and doubled blank lines, and glues the sign-off to the name
  (only when the next line looks like a name).
- **Every email ends** `Sincerely,` / `Nathan` / blank line / signature block (`Nathan Gong`, `UCLA Class of 2029`, `*major*` (italic),
  `phone | [LinkedIn](url) | email`) (owner, 2026-10-14). Sign-offs: first emails "Sincerely,", follow-up #1 "Regards,", #2 "Kind regards,"
  (`emailFormat.ts#signOffFor`). Templates and bases end `<sign-off>
{{my_first_name}}`; `withSignature` adds the blank line and
  `signatureBlock` (full name + `signatureLine`). It rebuilds whatever follows the sign-off only when that's a name or signature lines
  (older drafts, AI output), so a P.S. is left alone, and it's idempotent. Drafts runs it again after the AI fill step and when creating
  Gmail drafts. `signOffIssues` flags a missing first-name line / blank line / google redirect: drafts table badge, draft editor
  ("Fix sign-off"), TemplateEditor, `check:outreach` (every default template + base) and `check:templates`. Store v10 migrates saved
  templates/bases (`templateSignOff`). Sent mail is never rewritten.
- `[label](url)` and `*italic*` are the markup the app understands: `<a>` / `<i>` in HTML, "label: url" / bare text in plain text.
  Emails and bare URLs are auto-linked (blue in Gmail). In a custom signature the bare word "LinkedIn" is linked to the profile URL,
  and the full name is put on top unless it already starts with it.
  Phone numbers are deliberately NOT links: `unlinkPhones` puts `&zwnj;` between digit groups to defeat Gmail/Apple data detectors.
  The HTML wrapper gets `font-family` from `settings.emailStyle.font` (`EMAIL_FONTS`, Gmail's own stacks; default Garamond).
- **Signature logo** (Settings → Email → Writing, `components/SignatureLogo.tsx`): PNG/JPG/GIF ≤ 1 MB in `blob:logo`, meta
  (`name`, `width` 40–300, optional https `link`) in `settings.emailStyle.logo`. `upsertDraft` adds it to every Gmail draft
  (`logo: undefined` = saved one, via `setSignatureLogoSource`, registered in Shell so gmail.ts stays store-free for scripts):
  `buildMime` wraps the HTML in multipart/related with the image as `cid:signature-logo@coverage`, placed right under the
  signature's last line (`logoLineIndex`, so before a P.S.). A body without the signature (scheduling reply without one) gets no
  logo. Plain text is unchanged. Not a remote URL: it shows even when images from the web are blocked.

## AI model chain (`lib/keys.ts#modelChain`, `lib/server/ai.ts#withAi`)

- `x-ai` = `{chain: [{provider, model, keys[], ids[], baseURL}]}` (primary first). The server tries each model's keys, and on rate/quota/
  missing-model errors (`shouldTryNextModel`) moves to the next model. SDK retries are off (`maxRetries: 0`) except on the last option, so
  an exhausted model costs one round trip. `aiJson` sets an `x-ai-fallback` response header, which `callApi`
  turns into an `ai-fallback` window event, and Shell toasts it once per model.
- **Rotation (`withAi` + `classifyAiError`):** daily / rate / bad key → next key of the same model; busy (503, "high demand",
  overloaded, network) → rest that model on every key for 2 min and go to the next model. Any other provider error (unknown model, 400s
  like Gemma's "JSON mode is not enabled", unparseable output) → next model. Only our own `HttpError`s and aborts stop early: a
  "fatal" stop on a provider 400 once surfaced as a 500 on /api/draft. Auto backups exclude gemma/learnlm/aqa (no JSON mode or system
  instructions on the Gemini API). Every attempt is logged as `[ai] <route> <provider/model> key i/n → kind status: msg` (Vercel function
  logs), and error responses carry `attempts[]`, which `api.ts#reportFailure` prints as a console table with the `x-vercel-id`. Anything
  logged or returned goes through `redact()` so keys never appear. `unwrap` digs the provider error out of AI SDK RetryError/cause. The
  server reports skips in `x-ai-skipped` ([{model, reason}]), and Shell toasts "X busy (high demand). Answered by Y instead." If everything
  fails, the error lists every model and why. The key test in Settings treats busy/quota as "valid, resting" so backups can still be added.
- **Quota cooldowns:** on a 429/quota error, `cooldownUntil` picks when to retry that model+key (Gemini "PerDay" → next midnight PT, else the
  "retry in Ns" hint). The server echoes vault key ids (never keys) in `x-ai-exhausted` (also on errors, via `aiErrorResponse`). `callApi` stores
  them in `state.aiCooldowns`, and `keys.ts#aiHeader` leaves resting model+keys out of the chain (the full chain if everything is resting).
  Settings shows "out of quota · back 12:00 AM" badges and a reset link.
- `settings.ai.fallbacks` undefined = automatic (`autoFallbacks`: up to 5 other text models from the same provider, since Gemini quotas
  are per model, then each other provider's default). "Customize" in Settings freezes it into an editable, tested list.

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

## Email lab (`app/lab`, `lib/experiments.ts`, `api/templates/generate`)

- **Layout:** `/lab` = Setup (experiments, shared wording, generator) and `/lab?view=results` = Results (experiment tables, "What works
  for whom" explorer, wording/template results, sent-email tagging).
- **Segments & send time (`lib/segments.ts`):** `crossTab(contacts, dimension, segment)` over sent emails. Dimensions: font, send time
  (buckets in the recipient's time zone by region: NY Eastern, Chicago Central, SF/LA Pacific), day, hook, template, wording, each
  experiment. Segments: bank type (`tierIndex`: workbook targets → coverage.added → STARTER_TARGETS; the owner's 106 contacts all resolve),
  team, location. Past emails are auto-tagged where derivable: send time from `sentAt`, template/hook/wording from `draftMeta` or the
  draft text.
- **Time experiments** (`kind: "time"`, arms = hour windows) tag emails by when they actually went out (`experimentArmOf`), so emails
  sent before the experiment count too. A planned window is still assigned per Gmail draft and shown on /drafts ("send 7–9am their time").
- **Tagging sent emails** (`components/LabResults.tsx#SentEmails`): "Auto-tag fonts from Gmail" (`gmailSync.ts#autoTagFontsFromGmail` →
  `gmail.ts#detectSentFont` reads the first sent message's HTML `font-family`; Gmail stores quotes as `&quot;`; no font-family = Gmail
  default sans). Manual font / experiment-arm tags per row or in bulk. `trial.fontSource` = draft | gmail | manual.
- **Experiments (top of the lab, `components/SelfExperiments.tsx`):** `settings.experiments` (font or custom arms, `alternate` = least-used
  arm per draft, `wave` = `currentArm` until switched). `assignTrial` runs when a Gmail draft is made (drafts page bulk + editor), sets
  `contact.trial {font, arms}` and picks the font. It's kept on later updates, and follow-ups reuse `trial.font`. Results come from
  `experimentArms` / `resultsByFont`. "Use X from now on" sets `settings.emailStyle.font` and ends the test. In the UI the "base" is called
  "Shared wording" (versions); the code still says base.
- **Hooks (`lib/hooks.ts`, `components/Hooks.tsx`):** `{{my_pitch}}` = `hookFor(contact)`: the per-contact `hookId`, else the first hook whose
  team words match `contact.team`, else the fallback (Generic, empty). An empty hook removes the sentence cleanly (`fillPlaceholders`).
  Defaults: Tech (the owner's sentence), Energy (empty, the owner will write it), Generic. Store v7 turns `profile.pitch` into the Tech
  hook. Drafts has a Team · hook column; `draftMeta.hookId` records which hook a draft used.

- **Base** (`settings.emailBases`, `EmailBase`): opener / intro / ask / close shared by every first email via `{{base_opener}}`
  `{{base_intro}}` `{{base_ask}}` `{{base_close}}`, expanded first by `template.ts#expandBase` (empty piece = removed). `ORIGINAL_BASE` =
  the owner's wording (the control). `CONCISE_BASE` = a ~90-word challenger (15-min ask, time window, no "I know you value your time").
  Starter templates use the placeholders; `applyBaseToTemplates` converts older ones by whitespace-flexible match of the original text.
- **A/B:** with 2+ active bases, `drafts` gives each new draft the least-used base (`pickBase`). Templates sharing `variantGroup` rotate the
  same way (`pickVariant`; "Make an A/B variant" in TemplateEditor). Each draft records `contact.draftMeta {templateId, baseId}`.
  Results: reply rate (replied ÷ sent) per arm with a Wilson 95% range, and `verdict` refuses to call a winner below 30 sends per arm or
  at p ≥ 0.05 (two-proportion z-test).
- **Required facts / exact wording:** `Template.requires` (`their_school`, `position`) makes drafting stop and ask (NeedsModal on
  /drafts, pre-filled by `template.ts#guessSchool` from the captured profile's Education section or notes). The AI fill step used to "remove
  leftover placeholders gracefully", which rewrote the non-target template into something else. `Template.lockBase` keeps the Original
  base even during a base A/B test. The non-target starter has both and renders the owner's template word for word; store v6 migration
  applies them to any non-target copy and resets one that lost `{{their_school}}`.
- **Generator:** an angle → AI writes subject + hook + whenToUse on top of the active base (1–3 versions; several can be saved as one A/B
  group), saved as `experimental` templates.

## Coffee chat prep (`app/prep`, `app/api/prep`)

- Pick a contact (replied/call-scheduled first) → "Prep me" sends the record, their LinkedIn profile text (`contact.profile`), the
  owner's profile, their last draft, and optionally web results (`lib/server/search.ts#webSearch`, Serper→Brave, `-site:linkedin.com`)
  to the AI. It returns `CoffeePrep`: brief, career path, common ground, a 30-second intro, and 3–5 tailored questions, saved on the contact
  with tick-off state and call notes. General questions are `settings.prep.generalQuestions` (editable on the page, defaults in `defaults.ts`).
- **Profile source = the user's own view only.** The bookmarklet on a single `/in/` page opens `/prep#li=` (search pages still go to
  `/find`, and old bookmarks that send a profile to /find are forwarded). A paste box is the other option. The owner asked to automate a
  backup LinkedIn account. That was declined: logged-in automation is against LinkedIn's terms and gets accounts banned, and the official
  API doesn't expose other members' profiles.

## Finding people (`app/api/prospect/search`, `src/lib/linkedinCapture.ts`)

- **Serper free plan = 10 results per search.** `num` > 10 returns 404 "not available for free accounts"; `serperSearch`
  then asks for 10 a page (`page` 2, 3…, one credit each) and remembers that key (per server instance).
- Web search: `webSearch` tries the Serper keys, then falls back to Brave (`x-brave-keys`; free plan = 1 req/s, so queries run sequentially).
  Brave reports a bad key as **422 SUBSCRIPTION_TOKEN_INVALID**, which is mapped to 401 so key fallback works. Keep default queries ≤ ~30 words
  (`queryWordCount`), since Google truncates at 32. Store v3 migration swaps the old too-long defaults if untouched (`LEGACY_QUERIES_V1`).
- **LinkedIn policy decision:** no server-side or automated LinkedIn scraping (ToS §8.2 + account-ban risk from datacenter IPs). The owner
  asked for scraping; the agreed alternative is the user-clicked bookmarklet (`bookmarkletHref`), which reads only the current LinkedIn page's
  DOM and opens `/find#li=<json>`. `parseCapture` treats the payload as untrusted (caps sizes, sanitizes the slug). The bank comes from
  `guessBank` over known banks, else the AI filter's `employer`. React blocks `javascript:` hrefs in JSX, so the href is set via ref.
  The LinkedIn DOM changes often: the script keys on `a[href*="/in/"]` + nearest `li`, not on class names.

## Browser extension (`extension/`, owner, 2026-10-21)

- One MV3 extension for Chrome + Edge, plain JS (no build). Part 1 = LinkedIn → Coverage: the popup injects
  `sites/linkedin.js#captureLinkedIn` (same logic as the bookmarklet; keep them in step) via `chrome.scripting` with
  `activeTab` only (no host permissions), then opens `<dashboard>/prep|find#li=…`. Dashboard address in `settings.js`
  (https, or http://localhost). `npm run pack:extension` renders icons + checks the manifest + zips to `dist/` (git-ignored).
  `extension/README.md` = load unpacked, how it works, Chrome Web Store / Edge Add-ons steps and paste-ready answers.
  Verified loading in headless Edge 155 (popup + options render, no errors); not yet tried on a live LinkedIn page.
  Next parts: Granola note → Activity log, application autofill (user submits).
- **Agent test bench (owner, 2026-10-21, experimental):** popup → "Agent test bench" opens the side panel
  (`agent/panel.*`): pick a provider/model (own key, `agent/llm.js`), a task, Text or Screenshot mode; `agent/agent.js`
  loops observe (`page.js#observePage`, numbered elements + visible text) → one JSON action → act, logging tokens/time per
  step; results table compares models (finished %, your ✓/✗, steps, tokens, cost from prices you type). It **always** asks
  before submit/apply/send/connect/buy clicks (no switch, owner's call). LinkedIn is blocked unless "Allow LinkedIn" is ticked
  (owner accepted the ban risk). Needs the optional `<all_urls>` permission (asked in the panel). Practice target:
  `/agent-practice` (public, noindex, nothing sent; two steps, custom dropdown, checkbox → confirmation number).
  Side panels can't use `confirm()`: inline warnings / two-click buttons instead. Not yet run end to end with a real key.
  Before a store upload, decide whether the agent ships (all-sites access = stricter review); privacy page §7 doesn't cover it yet.
- **Chrome Web Store v1.0.0 (owner, 2026-10-23): no agent.** `npm run pack:extension` = the store build (strips `agent/`,
  `sidePanel`, optional `<all_urls>` and the popup button between `<!-- agent:start/end -->`; fails if any remain →
  activeTab + scripting + storage only); `-- --with-agent` = the full build for testing. Listing pages on the site:
  `/extension` (overview, install, permissions, FAQ), `/extension/privacy` (the listing's privacy URL; keep in step
  with the manifest), `/extension/support` (help, contact, "What's new"): `app/extension/layout.tsx` with
  LandingNav + `ExtensionTabs` + `LandingFooter`, public and bare in Shell. `SITE.extension.chromeUrl` (empty until
  approved) switches the install buttons from load-unpacked steps to "Add to Chrome". `npm run assets:extension`
  renders `dist/store/` screenshot 1280×800 + promo tile 440×280 with headless Chrome against a running build
  (Consent shows no banner when `navigator.webdriver`). Store steps + paste-ready answers: extension/README.md.

## Reply / thank-you / referral tracking (owner, 2026-10-22)

- **Why:** thank-yous showed as "not sent" because only the browser read Gmail (open tab + token), and runs missed
  people: the server's copy had Jack Brun's last email as 10/9 (thank-you went 10/20), Sherrick none. Keyword matching
  ("thanks" in the subject) was rejected: every email's signature says "Thanks, Nathan.", and thank-yous are often
  replies in the original chain.
- **Rules (`lib/replyTracking.ts`, pure, `npm run check:tracking`):** thanked = any SENT message with them in To/Cc/Bcc
  after the call. Their addresses are learned: same firm domain in a thread with them and (their first/last name in the
  display name or address, or answering your 1:1 thread to you alone, not someone already on the thread). Isaiah
  Estrella was emailed at iestrella@ and replies from IDeLaCruz@. Intro = their real reply adds someone new to To/Cc
  (role addresses ignored); `youWroteAt` = your first email to that person after it (Benjamin Hon cc'd Kevin Zhu 10/16).
- **Server (`lib/server/gmailTrack.ts`):** optional `gmail.readonly` on the automatic-sending Google connection
  (`account.google.read`; old connections → AutoSend "Reconnect Google"). The dashboard pushes `track` (trackList:
  everyone emailed / talked to with an address, `hot` = active ≤ 21 days, `knownLast`). Hourly tick (any account with
  read, not only WhatsApp) + each sync (20 s budget): threads.list `{from: to: cc: bcc:} after:` → threads.get metadata →
  analyzePerson; hot hourly, others 6 h. Stored in `track:<id>` (+ reply texts ≤1,500 chars until the dashboard acks
  them, ≤14 days). The 9 PM text drops "owed" items settled by a newer email (vs `knownLast`), uses tracked dates for
  calendar thank-yous, and adds fresh "They wrote back" items.
- **Dashboard (`lib/referrals.ts`):** `applyTracking` (dates forward, status up, aliases, intro → `contact.signals`),
  `readReplies` → `api/replies/classify` (AI: referral without a cc, promises, dates) → signals; acked on the next sync.
  Follow-ups → **Referrals** (`components/Referrals.tsx`): confirm / dismiss signals (`confirmSignal` creates or links
  the referred person with `referredBy`, sets their first email from `youWroteAt`, and the referrer's `referral {at, to,
  source:"gmail"}`), then `referralRows` (pure, `lib/referralRows.ts`): email them → follow up 7 days after → after the
  call "tell <referrer> how it went". Those steps go in the 9 PM text (`LABELS.referral`). Sheet-ticked referrals are
  `source: "sheet"` (date guessed). Browser Gmail sync also searches To/Cc/Bcc and aliases now.
- Not yet verified live: needs a deploy + reconnect (consent screen gains "View your email messages"; the Google Cloud
  OAuth consent config must list `gmail.readonly`). Privacy §2/§3 updated, `legalUpdated` 10/22.

## Landing page, off-sheet bankers, smart mentions (owner, 2026-10-23)

- **Landing `/welcome`** (`app/welcome/page.tsx`, server component, no store; pieces in `components/landing/`): shaped
  like the owner's quizlet-v2 landing (question headline, one button, horizontally scrolling tool slabs with drawn
  mocks, zig-zag stories, closing slab) with a HubSpot-style nav (`LandingNav.tsx`: utility strip, Products /
  Integrations / Resources mega menus, outline "Open dashboard" + filled "Get started free"). Tools are listed once in
  `landing/features.ts`. Mocks use made-up names only. Shell renders it bare (`BARE_PATHS`). `/` sends a visitor with
  no workbook, no contacts and no `localStorage["coverage:started"]` there (`app/page.tsx#useLandingRedirect`); every
  dashboard link on the landing sets the flag (`StartLink`). Checked on 127.0.0.1 at desktop width; phone width not
  click-tested (iframes are blocked by X-Frame-Options).
- **Not in tracker** (`lib/offSheet.ts`, pure, `npm run check:offsheet`; Follow-ups → "Not in tracker",
  `components/OffSheet.tsx`): bankers you emailed who have no row (Justin James, Morgan Stanley, thank-you 10/5 after
  the info session, no follow-up). `gmailSync.ts#scanOffSheet` (after each Gmail sync, ≤ every 6 h, or "Scan sent
  mail") reads To of sent mail from the last 120 days (`gmail.ts#sentRecipients`, only messages not seen before; ids
  and work-domain recipients kept in `state.offSheet`). A recipient is a banker when the domain is one a contact
  already uses, a `BANK_DOMAINS` one (or its subdomain), or reads as a known bank name (whole name / stem, never a
  substring: citizensbank ≠ Citi). Personal / .edu / own / role addresses never show; other company domains are
  listed apart. Already tracked = same address / alias, or the same name at that bank. "Add to tracker" =
  `addManualContact` (row on the bank tab, region Other) + `syncContact` for the dates; ✗ = ignore list.
- **Smart mentions** (`lib/smartMention.ts`, pure, `npm run check:mentions`; browser side `lib/mentionDrafts.ts`):
  a chat with someone ELSE at the same bank (`canonBank`) rated ≥ 6/10 (your rating: "rating: 8/10" or a line that is
  just "8/10", never a "9/10" date; else grade / 10) puts one sentence in first emails (start of the hook paragraph)
  and follow-ups (own paragraph, only if the chat came after your last email to them); `{{chat_mention}}` in a
  template places it. Not the person themselves or whoever referred them. With AI it's an `[[AI: …]]` slot carrying
  the chat's notes (+ the live text of its Google Doc via `api/templates/gdoc` `format: "txt"`, link-shared docs
  only) and a no-invention rule; `api/draft` treats a slot's notes as facts for that slot only. Without AI it only
  names the person. Settings → Email → Writing → Smart mentions (`emailStyle.smartMentions`, undefined = on, 6/10).
  `draftMeta.mention` records who was named. Plugin: `smart_mention` tool + `smart-outreach` skill (v0.2.0);
  follow-up-planner also looks for off-sheet bankers. On the owner's workbook, Mizuho contacts get Benjamin Hon
  (8.9/10), but his notes have no specifics, so the AI uses the plain sentence until richer notes are added.
- **Chats ↔ Google Docs** (`lib/docMatch.ts` pure, covered by `check:mentions`; `lib/chatDocs.ts` browser): a chat's
  `docUrl` comes from (1) a Docs link in its Conversation row (any cell's hyperlink or text, not the app's "• " lines;
  `docSource: "sheet"`), (2) a Drive search by the person's name (`docSource: "drive"`: a title naming them wins;
  else the only doc whose text has their full name, e.g. a running notes doc; ambiguous → `docChoices`, picked on
  /log), or (3) a pasted link (`manual`). `withSheetChat` keeps a drive/manual link across re-imports. Searches run
  from Shell (20 s after load, every 30 min, ≤25 people, each chat ≤ once a day), from /log ⋯ → "Link Google Docs",
  per chat in the expanded row, and from `addSmartMention` for the chat it names. Access: the automatic-sending
  Google connection's optional `documents.readonly` + `drive.metadata.readonly` (`account.google.docs`,
  `api/server/docs`, no popup, private docs) → else a browser GIS token (`lib/gdocs.ts`, one click per session) →
  else link-shared docs only (`api/templates/gdoc`). The Google Cloud project needs the **Docs API and Drive API**
  enabled and both scopes on the consent screen; old connections show "Reconnect Google" on the AutoSend card.

## Claude connector (`api/mcp`, owner, 2026-10-22)

- Remote MCP server (Streamable HTTP, JSON responses, stateless, hand-rolled JSON-RPC) over what the server already
  keeps: `account_status`, `due_tonight` (`lib/server/tonight.ts#planItems`, shared with the 9 PM text), `recent_replies`,
  `thank_yous`, `intros_found`, `scheduled_sends`, `cancel_send` (marks the send failed "Cancelled from Claude", so the
  dashboard clears it and sync doesn't requeue). Contacts / sheet / chats aren't on the server, so they aren't here.
- **OAuth 2.1, Coverage is its own AS (`lib/server/oauth.ts`):** `/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource` (+ `/api/mcp` suffix), DCR `api/oauth/register` (https or localhost redirects),
  approval page `/connect` (needs the browser's `settings.server` account + automatic sending on; posts to
  `api/oauth/authorize` with the account's Bearer id.token), `api/oauth/token` (code + PKCE S256, refresh rotation,
  RFC 6749 errors; tokens `cova_` 1 h / `covr_` 90 d, only sha256 stored, keys in `oauthtok:<acct>`), `api/oauth/revoke`.
  `deleteAccount` revokes them. 401 from `api/mcp` carries `WWW-Authenticate: Bearer resource_metadata=…`.
- Tested end to end against the real Redis with a local `next start` and a throwaway account (deleted after):
  register, check, deny, PKCE failure, one-time code, tokens, refresh rotation, all 7 tools, cancel. Not yet tried
  from claude.ai itself (needs the deploy). The plugin's `.mcp.json` lists it as `coverage` (type http).

## Claude plugin (`plugin/recruitify`, owner, 2026-10-21)

- Step 1 of "Coverage as a Claude connector": a Claude Code / Cowork plugin, installed from this repo
  (`.claude-plugin/marketplace.json` → `plugin/recruitify`; `/plugin marketplace add Nathangong-coder/banker-dashboard`).
  Skills: update-tracker, record-chat, tag-chatted-emails (Gmail labels `Chatted` + `Chatted/Follow-up - Good | OK |
  Bad - Ghost`, applied only after the user confirms), follow-up-planner. Gmail / Granola come from Claude's own connectors.
- Local stdio MCP server `coverage-sheet`: source `scripts/plugin/coverage-mcp.mts` (hand-rolled JSON-RPC, no SDK),
  bundled with esbuild by `npm run build:plugin` into `plugin/recruitify/server/coverage-mcp.mjs` (**commit the bundle**;
  rebuild + bump `plugin.json` version after changing it or the src/lib code it uses). Workbook path:
  `~/.coverage-plugin.json` or `COVERAGE_WORKBOOK`. Writes = `contactPatches` diff (only cells the change needs) or the
  Conversation row as owner-typed text (no "• " lines, so `sheetChat` reads it back and the dashboard's live pickup
  shows it); before saving, every other cell is compared with the parsed original (abort on any difference), Excel's
  lock is checked, 15 backups in `.coverage-backups/`. Tiers: Good = referral / rating ≥ 8 / grade ≥ 84; Bad = rating < 4
  / grade < 60; else OK (the skill moves people down to Ghost only from Gmail evidence: 2+ unanswered emails after the
  chat, the latest 10+ days old). `due_followups` sees only the sheet, not the dashboard's server queue.
- Tested over JSON-RPC on a copy of the live workbook and via `claude -p --plugin-dir`. `claude plugin validate` passes.
- Step 2 (later): a remote connector for the Connectors Directory needs server-side data + OAuth (data is browser-only today).

## Bank coverage (`src/lib/coverage.ts`, `src/lib/banks.ts`, `app/coverage`)

- **Ranked table (owner, 2026-10-23):** /coverage is a Firms-style table ranked by urgency (`lib/bankWork.ts`, pure, covered
  by `check:coverage`). `bankWork` counts over EVERY contact at the bank (`r.allContacts`): the old cards counted only
  contacts on a checked desk, and a contact with no team is on no desk, so 87 of 204 vanished (JPM showed 0 of 17).
  "Live" = emailed with no reply (`isLive`; drafts don't count, unlike `LIVE_STATUSES`, which is the cap). To-dos reuse
  `relationshipItem` (reply / thank-you / check-in), `nextAction` (follow-ups, drafts), `referralRows`, new signals and
  `nextUpByDesk`. `bankUrgency` = prestige 25 (tier, or your /firms stars) + applications 25 + coverage gap 30 + to-dos 20,
  plus timeline 20 once `BankTimeline` exists (the owner's planned feature; the score is normalized over known parts).
  Desks checked in the plan only pick which banks are listed; the plan lives in a collapsed "Recruiting plan" section.
- **Board (owner, 2026-10-23, default view; "Ranked list" = the table):** columns by `bankWork.ts#bankStage`:
  Referrals (any `referral`) → Chatted (`talkedTo`: reply, call booked/had, logged chat) → Outreach (emailed) → Cold.
  Office / group filter (quick chips from the plan's desks or `DESK_PRESETS`, plus office + group selects; remembered
  in localStorage `coverage:board`): `onDesk` picks the contacts on it (no-team people at that office are `unsorted`,
  shown on the card with a link to set their team), `offeredAt` drops banks that don't hire there, and every number,
  stage and urgency is recomputed from those people.
- **/firms tiles zoom (owner, 2026-10-23):** Firms emailed / replied / chatted with / with referrals are buttons;
  one opens `ZoomPanel` (which firms, a bar each, and the people behind it) and filters the table to those firms.
- **Drafts / Templates (owner, 2026-10-23):** templates, hooks and the resume moved to `/templates` (Outreach group).
  /drafts = contacts table (~70%) + `FirmContext.tsx#FirmSheet` (~30%): "At this firm" as a spreadsheet grid, one banner
  row per firm with live/cap per desk. `/drafts?status=drafted` pre-sets the status filter.
- `buildCoverage` merges banks by `canonBank()` (aliases + stop-words; test new aliases against the owner's names) from: contacts →
  bank tabs (`tables`, even with 0 contacts) → `targets` (target-list tabs, parsed by `workbook.ts#extractTargets`) → `coverage.added`
  → optional `STARTER_TARGETS`. Buckets: reached (any `sentAt` or sent/replied status) / ready (active contacts, none reached) / cold / hidden.
- Target lists: row style (header "Institution Name" [+ "Institution Type", "#"]; rows need a numeric # and a bank/PE-ish type) or
  column style (≥3 category headers; only `DEFAULT_TIERS` kept). `cleanBankName` strips "(MS) & MS NY)" noise.
- Workbooks imported before this existed get `targets` backfilled by re-parsing the stored blob on the coverage page.
- Deep links: `/find?banks=A|B` (pipe-separated, optional `&desk=NY|Tech` to steer the AI screen), `/drafts?bank=Name`,
  `/sheet?view=contacts&filter=noemail|noteam&bank=Name`.
- **Recruiting plan** (`coverage.plan`, `src/lib/desks.ts`, `components/RecruitingPlan.tsx`): a checklist of desks (office + team) with a scope of
  all banks, tiers, or picked firms. `buildCoverage` fills `CoverageRow.desks` via `deskStatus` (replied / emailed / ready / needs_email / empty).
  SF/NY match `region` and other offices match the location text. "Tech" also matches TMT/Technology. Contacts with no team count toward no desk,
  and the UI links to the no-team filter. Select the plan with `useStore((s) => s.coverage.plan)` and default outside the selector: `?? []`
  inside it returns a new array every call, which re-renders forever in zustand v5. This crashed /drafts and /followups on 2026-10-07 (`useStore((s) => windowOf(s.settings))`); `check:selectors` now catches it.

## Gmail sync (`src/lib/gmailSync.ts`, `components/GmailSyncWidget.tsx`)

- **Draft revert:** a linked `draft.gmailDraftId` that no longer exists (`gmail.ts#draftExists`, 404) is cleared on sync. If Gmail has mail
  sent after the draft was made, it was sent; otherwise the user deleted it and it's back as an editable dashboard draft (`draftsReverted`).
  Sending to Gmail uses `upsertDraft` (updates the existing draft, never duplicates). The draft editor has Update / Unlink / Delete Gmail draft.

- **Scheduled sends:** `syncContact` ignores messages without the SENT label or dated in the future, and reads
  `in:scheduled to:X` into `scheduledAt`. A contact marked sent with nothing sent and a scheduled email goes back to `drafted`
  (on 2026-10-04, 90 "Sent" rows were really Schedule-send emails for 10/6–10/9). If nothing went to the address on file,
  `findEmailByName` looks for another address they were emailed at (dates come from it; the sheet email isn't changed).
- `syncAllWithGmail({interactive})` is single-flight. Contacts with an email → `gmail.ts#syncContact` (first sent, follow-ups counted
  up to the first reply, reply date, thread/Message-ID for in-thread follow-ups). Contacts without one → `findEmailByName` (Sent-mail
  search by name, accepted only if `addressMatches` the display name or mailbox), throttled by `gmailCheckedAt` (12h).
- `patchFrom` only moves status/follow-up counts forward. Non-interactive runs never open Google's popup; the widget re-syncs every
  20 min once a token exists this session (`onGmailConnected`). Token model = one click per session. True background sync needs the
  server-side refresh-token flow (client secret + DB), tracked in TODO.md with the 9am ping.

## Drafts ↔ coverage (`components/FirmContext.tsx`)

- `FirmPanel` (collapsible right column on /drafts, xl screens; open/closed state in localStorage) shows `FirmSummary` for the banks
  of the selected contacts (or the bank filter): who has already been contacted and when, the live-cap warning, the not-yet list, and
  optional sheet rows. The draft preview modal shows a compact `FirmSummary`. Rows in the drafts table show "N already contacted here".

## Follow-up logic (`src/lib/followups.ts`)

- `nextAction(contact)`: `new` → reach out; `drafted` → send; `sent`/`followed_up` → follow-up #n after `firstAfterDays`/`nextAfterDays`
  from `lastTouchAt ?? sentAt`, until `maxFollowUps`, then "move on?" after `moveOnAfterDays`. `snoozeUntil` pushes the due date later.
  Banks with status paused/moved_on suppress reminders.
- **Live cap:** the owner keeps at most **2 live people per desk** = bank + region + team (`followUp.livePerBank`, name kept for storage;
  `desks.ts#liveByDesk/overCapDesks/nextUpByDesk`). SF Tech, NY Tech and NY Generalist at one bank each get their own 2 slots (owner's rule).
  "Live" = drafted/sent/followed_up with no reply. Drafts warn (but don't block) when a desk goes over.
- Reminders (`src/lib/reminders.ts`): one digest per day at 9am. Channels are browser Notification (only while the app is open), ntfy,
  Twilio, WhatsApp (CallMeBot, send-now), and .ics export. Server-side sending and the server's 9am text: see Automatic sending.
- `nextAction`: a future `scheduledAt` → kind `scheduled` (not due; listed under "Scheduled in Gmail" on /followups). No
  date at all → not due (`unknownDate`, banner asks for a Gmail sync), and it's left out of reminder digests.
- **/followups "Due now"** is two cards: "Follow-ups due" (follow_up / move_on) and "Drafted, not sent yet" (kind `send`,
  oldest draft first). "Draft all N in Gmail" runs `draftFollowUp` per person: the step-n template, AI fill if needed,
  `upsertDraft` in the original thread, recorded as `contact.followUpDraft {gmailDraftId, messageId, step}` (stale once
  `followUps >= step`; Gmail sync clears it). Rows then show "Draft #n ready · schedule <nextSendSlot>" (NY 5 PM PT, else
  7 PM PT, today or tomorrow). **The Gmail API has no Schedule send**, so scheduling is the user's click in Gmail; truly
  automatic sending needs the server + refresh-token work in TODO.md #1.
- **WhatsApp digest is automatic** (`Shell#useDailyWhatsApp`, `reminders.ts#whatsappDigest`): once a day the first time the
  dashboard is open at/after 9am (an open tab fires at 9), marked in `state.scheduled["whatsapp:<day>"]` + localStorage so
  tabs don't double-send. The text is sectioned by action ("*Move on?* (3)", "*Follow-up #2* (5)", one
  "• Name: email" line each, no bank/region) and split into numbered messages of ≤900 chars, sent 4 s apart
  (`sendWhatsAppDigest`; also used by the manual button). Toggle: `settings.alerts.whatsappDaily` (undefined = on) on /followups → Reminders. Before this,
  only the manual button sent anything, which is why the owner got no texts.

## Settings (`app/settings/page.tsx`) and send window

- **One Settings page, tabbed** (`?tab=profile|email|outreach|data|reminders|backup`, Email has `&sub=writing|sending|experiments`;
  the old `#alerts` hash opens Reminders). Email → Writing = hooks, font, signature. Sending = `SendWindowEditor`, `SendModeSwitch`,
  follow-up rules. Experiments = `components/LabSetup.tsx` (experiments, shared wording, generator, moved out of /lab, which now
  shows results only; `/lab?view=setup` forwards). Reminders = `AutoSendCard` (components/AutoSend.tsx) + alert channels.
- **Send window** (`settings.sendWindow`, `lib/sendWindow.ts`): default 9–11 AM in the recipient's zone (`recipientTz`: NY Eastern,
  Chicago/Texas Central, else Pacific), weekdays only. `planSends` picks random days/minutes (see "Random days and minutes" above) around sends already
  queued; `zonedDate` is DST-safe. `queueSends` uses it; `rescheduleQueued` ("Move N queued emails
  into this window") re-plans everything queued. check:outreach covers zones, weekends, spreading, overflow and DST.

## Firm facts: where they come from and the guardrails

- No live source exists (banks don't publish their summer-analyst desks via any API). Order of authority: anyone the owner has found
  on a desk > the owner's COVERAGE tab (`sheetOfficeInfo`) and applications (`coverage.ts#withEvidence`: a "Technology IB" program
  opens the Tech desk at a listed specialist) > the owner's per-firm override on /coverage > the hand-checked built-in lists
  (`offices.ts` BUILT_IN, `specialty.ts` BUILT_IN, both stamped `*_REVIEWED`).
- `npm run check:firms` fails on name collisions, non-standard teams, built-in contradictions, broken golden cases (Leerink SF Tech
  not offered, Qatalyst NY Generalist not offered, TPH Texas Energy offered…) or broken guardrails; warns when a list is >1 year
  since review; with a workbook, lists where the COVERAGE tab disagrees with the lists (compared by `inferTeam`, not text).

## Scheduling calls (`lib/availability.ts`, `lib/scheduling.ts`, `lib/gcal.ts`, `components/Scheduling.tsx`)

- **Availability** (`settings.scheduling.availability`, Settings → Email → Scheduling): your zone, weekly hours, per-date overrides
  ("A specific week"; blank = usual hours, "off" = unavailable), call length, notice, look-ahead. `freeWindows` turns it into instants
  (DST-safe via `sendWindow.ts#zonedDate`), subtracts Google Calendar busy times, snaps to :00/:30, drops gaps shorter than a call;
  `narrowTo` applies what the banker asked for **in their zone** (dates, weekdays, earliest/latest; weekends only if asked);
  `formatWindows` prints one line per day in their zone ("Monday, Oct 12: 10 AM – 1 PM ET").
- **Reading the reply:** `gmail.ts#latestFrom` (format=full, quoted history cut by `stripQuoted`) → `api/scheduling/parse` (AI:
  zone + evidence, dates/weekdays/times asked, times they proposed, phone; zone defaults to `sendWindow.ts#recipientTz`). Without AI:
  office zone, no narrowing, phone via `availability.ts#phonesIn` (skips your own number).
- **Follow-ups → "Replied: schedule calls"** (status replied / call_scheduled): **Reply with times** drafts the reply in the same Gmail
  thread (`upsertDraft` with threadId + In-Reply-To; template `replyTemplate`, `{{availability}}`); **Send invite** creates the event on
  your primary calendar (`gcal.ts#createCallEvent`, `sendUpdates=all` emails them, `none` = calendar only), title/description templates
  ("Nathan<>Elixa Coffee Chat", "Nathan (425-…) to call Elixa (415-…) at 10 AM PT", time in their zone), then sets `call_scheduled`,
  `contact.call {at, eventId, link, invited}` and `contact.phone`.
- **Calendar permission** is its own GIS token (`calendar.events` + `calendar.freebusy`), requested on first use so Gmail never breaks.
  The Google Cloud project must have the **Google Calendar API enabled**; `gcal.ts` explains that error. `npm run check:scheduling`
  covers zone conversion, busy subtraction, overrides, narrowing, notice, hour parsing, phones, quote stripping and the invite text.

## Seniority guard, failed contacts, per-email send times (10/2026)

- **VP and above** (`lib/seniority.ts#isVpPlus`: VP/SVP, Director, ED, Principal, MD, Head, Partner, Chair; current role only,
  "former/ex-" ignored, "MD&A" isn't MD). Owner's rule: don't email them. `vpPlusWarning` softens (amber) when a senior-exception tie
  applies but never hides. Enforced: Drafts skips VP+ without a tie when generating and creating Gmail drafts unless "Include VP+" is
  ticked (red row warning); `serverSync#queueSends` never auto-sends them; "VP+" badges in the contacts list and Follow-ups rows;
  `components/SeniorGmailCheck.tsx` scans Gmail drafts + `in:scheduled` (`gmail.ts#outgoingQueue`, recipients/subject only) against
  contact titles and can add a red "⚠ VP+ check" label (`labelInGmail`, separate `gmail.modify` token asked on click). Gmail has no API
  to cancel a Schedule-send message, so those are linked for the owner to unschedule.
- **Failed contacts** (`contact.outcome {kind: bounced | left | declined, confirmed, replaced}`): Gmail sync sets bounced / left
  (status ignored, confirmed). A reply matching `gmail.ts#looksLikeDecline` (narrow phrases; any positive signal like "happy to" or
  "next week works" vetoes it) is only *suggested*; the owner confirms on Follow-ups. `components/Replacements.tsx` ("Needs a new
  contact"): next person on the same desk (firm + region + team, status new, email first) → Drafts, else Find with `&desk=`; for a
  bounce, "Fix their email instead" clears the address and resets them to new. Confirmed outcomes write "Bounced" / "Left firm" /
  "Declined" to the sheet (`STATUS_TO_SHEET.ignored`); `statusFromSheet` reads declined/rejected/said no/not interested as ignored.
- **Send window days** (`SendWindow.days`, default Tue–Thu; older `weekdaysOnly` saves become Tue–Thu in `windowOf`); day toggles in
  `SendWindowEditor`. **Per-email time:** Follow-ups → Scheduled → "Change time" (`ScheduledRow`, `serverSync#rescheduleOne`; entered
  in your zone, shown in theirs). Gmail Schedule-send emails can only be changed in Gmail.

- **Follow-ups selection:** every row in Follow-ups due / Drafted / Scheduled has a checkbox (and "select all" per list). Bulk buttons
  ("Draft & schedule", "Draft … in Gmail", "Schedule") act on the ticked rows of that list, else the whole list. A sticky bar acts on
  the selection: cancel scheduled sends, discard drafts (deletes the Gmail draft, clears `draft`/`followUpDraft`/`serverSend`, a
  drafted first email goes back to `new`), snooze 3 days, stop following up (status ignored = "Moved on", persists to the sheet), delete
  (confirm; sheet contacts return on re-import unless their row is deleted). Rows also have single "Schedule" / "Draft & schedule" /
  "Discard" buttons.

- **Batch scheduling with overrides** (`components/BatchSchedule.tsx`, `sendWindow.ts#planBatch`, `serverSync.ts#applySchedule`):
  Day = keep each one's / all on one date / next allowed day; Time = keep / spread between two times / starting at a time; basis their
  zone or yours; N minutes apart per zone per day. A picked day is never moved (the automatic `planSends` rolls overflow to the next
  allowed day, which is why 29 sends split Thu/Tue); overflow past the end time, past times and days outside the send days are flagged
  in the preview. Opened from the selection bar ("Schedule / change day…"), Scheduled → "Change day / time…", Drafted → "Schedule",
  and after the header "Draft & schedule" finishes drafting. VP+ without a tie and people without a Gmail draft are left out.

## Launch hygiene (10/2026): legal, security, SEO, analytics

- **Legal:** `/privacy` and `/terms` (server components, `components/LegalPage.tsx`, facts in `lib/site.ts`: name, URL, contact email,
  `legalUpdated`). They describe the real data flows (browser storage; server only for automatic sending; Google Limited Use
  statement; BYO services). **Update them whenever data handling changes** (new scope, new stored field, new vendor), and bump
  `SITE.legalUpdated`. `Shell` renders `PUBLIC_PATHS` without waiting for the store (crawlers / Google's reviewers read them).
  The Google OAuth consent screen should list `/privacy` and `/terms` as its policy URLs.
- **Consent:** `components/Consent.tsx`. Storage is disclosed (the app needs it); analytics are opt-in: Vercel Web Analytics +
  Speed Insights load only after "OK" (`localStorage["coverage:consent"]`), changeable in Settings → Backup. No ad/tracking cookies.
  Analytics must also be enabled in the Vercel dashboard (Analytics + Speed Insights tabs) or the scripts 404 quietly.
- **Security:** `next.config.ts` headers (HSTS preload, nosniff, Referrer-Policy, X-Frame-Options DENY, COOP same-origin-allow-popups
  for the Google popup, Permissions-Policy); no CSP yet (GIS, bookmarklet hand-off and grid inline styles need a tested policy).
  Vercel already 308s HTTP → HTTPS. `src/proxy.ts` (Next 16's middleware) rate-limits `/api/*` per IP in Upstash: 120/min general,
  10/h for `server/google/start`, 30/10 min for `notify`; QStash job routes + the OAuth callback are exempt; fails open without Redis.
  There are no public forms, so rate limits (not CAPTCHA) are the spam protection. Secrets audit 2026-10-07: no server secret in
  `.next/static` or git history (the only hit was the public `QSTASH_URL` in vendored Upstash docs). **The GitHub repo is public.**
- **Validation:** `lib/validate.ts` (email, LinkedIn profile URL, phone, name, length) drives `Field error=` messages in AddContact
  (blocks save) and Settings → Profile (warns). Server routes keep zod.
- **SEO:** root `metadata` (title template "%s · Coverage", `metadataBase` from `SITE.url`, OG + Twitter cards) and a `layout.tsx`
  per client route with its own title/description/canonical. `opengraph-image.tsx` (+ `twitter-image.tsx`) is generated at build;
  `icon.svg`, `favicon.ico` (16/32/48, generated from the SVG with sharp), `apple-icon.png`, `public/icon-192/512.png`, `manifest.ts`,
  `robots.ts` (disallow /api), `sitemap.ts`. `not-found.tsx` = the 404 (links to the main pages).
- **Performance:** JSZip loads on demand (`sheetLinks.ts` / `templateImport.ts` `loadZip`), and `lib/actions` is imported lazily by
  `Shell` and `useSaveShortcut.ts`, so pages don't ship the spreadsheet code up front. Lighthouse (mobile, 2026-10-07): app pages
  Performance 83–84, legal pages 95, Accessibility / Best Practices / SEO 100. The rest is the store, which imports workbook.ts.
- **Mobile:** page grids use `grid-cols-[minmax(0,1fr)]` below their breakpoint (an implicit column grew to a wide table's width),
  `CardHeader` actions wrap, `Select` is `max-w-full`. Checked at 390 and 768 px on every page: no horizontal page scroll.

## Conventions

- Client pages are `"use client"` and render only after store hydration (`Shell` → `useHydrated`). Server routes import `server-only`.
- UI primitives are in `src/components/ui.tsx` (Button, Card, Badge, Modal, toast, Segmented, Menu, Donut, Kpi…). Match the existing density and tone.

## Conversations + activity log (owner, 2026-10-19)

- **Contact Information is the only list of people.** A bank tab's **Conversation** table (header row with a "Conversation"
  column and no LinkedIn/Status: `ContactTable.kind === "conversation"`, `convCols` = Date / Conversation / Notes / Comments)
  never creates contacts. Hand-typed rows are coffee chats unless the Conversation text names another kind
  (`conversations.ts#kindFromText`; "Other" only when it says so). A rating there ("8/10", the template's "x/10") is the
  owner's own score: kept as "Your rating: 8/10" in the notes and never overwritten by the kinds summary (owner, 2026-10-21). `workbook.ts#linkConversations` links each row (email → exact name → unique last name + first
  initial at that bank, `conversations.ts#matchRow`) as `contact.convRef`; no match (or a 2nd row for someone) = `orphans`,
  which /log asks about ("Same person as…" → `linkOrphan`, or "New person" → Contact Information + link).
- **One row per person.** `contact.chats[]` (`ChatLog` + `kind`, `docUrl`, `source`) is the record. Text typed into a row by
  hand becomes one `source: "spreadsheet"` chat (id `sheet:<tab>:<row>`, re-read on every import via `withSheetChat`, never
  written back). `contactPatches` → `conversationPatches` writes, only once the app has its own conversations for them: Name /
  Email / Position / Location copied from the person, Date = latest, Conversation = `kindsSummary` ("Coffee chat ×2"), Notes =
  the owner's text then one `• M/D Kind: notes · doc link` line each, Comments = `• M/D B+ (84): summary. Promised: …`. The app
  only ever replaces its own `• ` lines. Template rows ("(First Last)", "x/10", "(link)") are free slots; their placeholders are
  replaced or cleared. Rows are never inserted (that would shift Contact Information): a full table = dashboard only.
- **Every source goes through `conversationActions.ts`:** `logConversation` (the /log page; an email sets sentAt/lastEmailedAt,
  a call / coffee chat / in person moves status up to call_scheduled), `ensureConvRef` (first blank numbered row,
  `workbook.ts#allocateConversationRow`; also called by ChatGrades on /prep), `requestGrade` (api/prep/grade; notes are
  prefixed by `notesForGrading`, ≥200 chars). Google Docs import (TODO #7) should use the same path.
- **/log (Activity log,** Prep & reminders group): KPIs, one table of every conversation (kind filter, search, expand for notes /
  grade / promises, ⋯ = grade, prep, doc, delete), the orphans card, and the "Log activity" modal (person from a datalist or
  someone new, kind, date, notes, Doc link, grade with AI).

## UI design (owner, 2026-10-19; HubSpot-inspired, mock approved)

- **Navigation (`Shell.tsx#GROUPS`):** top bar = groups (Overview: Dashboard, Bank coverage, Firms, Spreadsheet · Outreach: Find
  people, Email drafts, Email lab · Prep & reminders: Follow-ups, Coffee chat prep, Info sessions); the sidebar lists the current
  group's pages (group follows the URL); Settings is the gear. Phones: the group's pages as a pill strip under the top bar.
- **Themes:** 5 color themes as `[data-theme]` token blocks in `globals.css` (`:root` = recruitly, the default since 2026-10-23:
  the logo's navy #0e1a2b / cream #f4f3ef / green #1f7a5c accent; slate = the previous default; cream, navy = the original,
  graphite = white/teal). **Logo** = `components/Logo.tsx` (same drawing as `src/app/icon.svg`, from the owner's "Recruitly
  square logo.png"); `npm run render:icons` makes favicon.ico / apple-icon / icon-192/512 from icon.svg, and
  `pack:extension` makes the extension icons from it. The link preview (`opengraph-image.tsx`) uses the same colors. Picked in Settings → Appearance (`components/ThemePicker.tsx`), per browser in localStorage `coverage:theme`,
  applied before paint by `layout.tsx#THEME_SCRIPT`. **Never hardcode hex colors in components**: use tokens (paper, panel, ink,
  ink-2, muted, line, line-2, subtle, hover, track, navy, brass = accent, brass-strong = accent that carries text / button fill,
  brass-hover, brass-ink = accent text on brass-soft, top-*, side-*, chart, chart-soft). `npm run check:contrast` checks every theme.
  The accent fills are deeper than HubSpot's #ff7a59 so white button text passes AA.
- **Font:** Lexend Deca everywhere, headings included (`--font-serif` maps to the sans; no serif). IBM Plex Mono only for code-ish text.
- **Page pattern:** PageHeader (title, one muted line, ≤1 primary Button + a `Menu` "⋯" for the rest) → a row of `Kpi` tiles →
  one table-style Card with a toolbar (Segmented tabs left, filter right), uppercase muted column headers on bg-subtle, Badge pills
  for status, row actions only on hover (`group-hover`), secondary actions in a row `Menu`. Notices are one line, not big cards.
  Button variants: primary = filled accent (one per view), brass = accent outline, secondary = neutral, ghost.
- **Info sessions** = table + side panel (`InfoSessionDetail`: People / To review / Notes tabs, one footer action; xl = sticky
  column, smaller = slide-over). **Follow-ups** = one Queue card (Due · Drafted · Scheduled · Replied [· Needs new contact]) with
  pieces in `components/FollowupsUi.tsx`. **Spreadsheet** = one toolbar row (file, Grid|Contacts, Find emails, Save, ⋯).
  Mocks of the redesign: a standalone HTML file outside the repo (not kept).
- Validate route bodies with zod and return errors via `errorResponse`. Error messages are shown to the user, so keep them actionable.
- Don't use `window.alert`. Toasts are the pattern. `window.confirm` is used only for bulk destructive actions.

## Outreach rules (`docs/outreach-rules.md`; `src/lib/outreach.ts`)

- The owner's rules (10/2026) are in `docs/outreach-rules.md`, loaded via `@docs/outreach-rules.md`. Most are enforced in `outreach.ts`.
- **First email = `tpl_outreach` + `base_3p`.** Base: opener + intro + `{{my_pitch}}` (the tech hook, Tech/TMT/software teams only),
  ask = `{{outreach_ask}}`, close = `{{outreach_close}}` + sign-off. The template: `{{outreach_subject}}`, and paragraph 2 =
  `{{outreach_hook}} {{base_ask}}`. `fillPlaceholders` expands `outreach_*` first via `composeOutreach` (they contain `{{position}}`).
  `ruleAssign` returns the outreach template for everyone when it exists. Store v8 adds it, makes `base_3p` the only active base,
  replaces the old tech hook text / Garamond font / criteria if never edited, and adds the E1–E4 experiments.
- **Affinity** (`affinityOf`): volunteer > Washington > Chinese > UCLA/Anderson > LA > UC > California > standard. "Chinese" comes only
  from the owner's Comment notes, never from a name. Schools come from school / comment / headline / the profile's Education section.
- **Tailored hooks** ("your path from X to Y") are `[[AI: …]]` slots, written only when a LinkedIn profile was captured (`contact.profile`,
  now sent to `api/draft` as `profile`). With no profile it's the template wording and E3 isn't tagged.
- **Experiments E1 ask / E2 close / E3 tailored 80-20 / E4 "shaped that journey" 70-30** are `settings.experiments` with arm `weight`s.
  Their arms are assigned when the draft TEXT is written (`assignOutreachArms` → `composeOutreach` corrects arms that couldn't apply,
  e.g. E1-A on a two-hook or senior email becomes B → `settleOutreachArms`), not at Gmail time (`assignTrial` skips them).
  `pickWeighted` (target share) replaces least-used for alternate experiments and weighted template variants.
- **Who / when:** `seniorSkipReason` (MD/Head/Partner without a UCLA/Anderson/WA tie) hides people on Find (collapsed "Senior (skipped)")
  and warns on Drafts. `emailVerified` (Apollo "verified", Hunter "valid", sheet/manual/Gmail addresses) gates drafting and Gmail drafts.
  `leftFirm` (headline employer ≠ bank) offers "Mark as left firm". Send times: `lib/sendWindow.ts` (below), not the old NY 5 PM / else 7 PM PT rule.
- **Enrichment** (`api/enrich`): a match is discarded (with the reason in the note) if its LinkedIn slug, last name, firm or city
  disagrees with ours. `detectRegion` moved to `lib/region.ts` so server routes can use it (workbook.ts re-exports it).
- **Gmail sync:** out-of-office auto-replies aren't replies. A bounce (mailer-daemon) or an auto-reply saying they left sets `ignored`.
- **Signature:** `Full Name / School Class of YYYY / *major* / phone | [LinkedIn](url) | email`, after the first-name line and a blank line. `unwrapRedirects` strips `google.com/url?q=` wrappers.

## Teams & coverage scope

- `locationTeam.ts#teamOf(c)` is the team to act on: the sheet's (`?`, `-`, `n/a`, `unknown` = blank), else a high-confidence
  `inferTeam` guess from title → comment → headline/profile that wasn't rejected (`teamRejected`). Desks, hooks, segments, the noteam
  filter and coverage all use `teamOf`. ContactsTable shows guesses in italic with ✓ (writes the Team cell via `updateContact`) / ✗.
- `buildCoverage` is scoped to the checked desks (`activeDesks/inScope/bankInScope`): banks no checked desk applies to drop out, and
  counts/bucket come from in-scope contacts (`r.contacts`; all of them in `r.allContacts`). FirmContext and the home page pass
  `plan: undefined` to stay unscoped. `scoreboard(rows, "banks" | "desks")` and `insights.ts#coverageInsights` feed the page.
- **Offices (`src/lib/offices.ts`):** the owner's COVERAGE tab (Bank | Tier | Office SF/LA/NY | SA seats here? | Teams / groups
  recruiting here | … | # offices/groups you can apply to) is read from the snapshots (`readOfficeMap`, any sheet with Bank + Office +
  "SA seats" headers) and registered by a store subscription (`setOfficeMap`; scripts call it after parsing). `BUILT_IN` fills what the
  tab lacks, incl. Texas (Houston energy banks; a bank not on that list = not offered in Texas). A desk is `not_offered` when the
  office doesn't hire ("No / unclear") or clearly recruits one other team (`officeTeam`: Moelis SF = Generalist, Qatalyst NY = Tech).
  `officeOf` maps Menlo Park / Palo Alto / Burlingame → SF, Santa Monica → LA, Houston / Dallas / Austin → TX.
- **Specialist firms (`src/lib/specialty.ts`):** `specialtyOf(bank, coverage.specialty)` = the owner's setting (canonBank key →
  [team], or null = full-service) else a conservative built-in list (Leerink / Cain / MTS = Healthcare; Qatalyst / Tidal /
  Union Square / FT Partners = Tech; LionTree / Allen / Raine = TMT; Ducera = RX; TPH = Energy). `deskStatus(…, specialty)` marks an
  empty desk outside those teams `not_offered` (someone already found on it still counts), so a firm with none of the checked desks
  is `notOffered` and leaves the counts, the columns and the "you applied to…" nudge. /recruitify: `SpecialtyPicker` on each card
  (hover on full-service banks) and a "Specialists outside your desks" list to change them back. TMT matches the Tech desk only.
- **Office cap:** you can usually apply to 2 offices per bank (`coverage.officesPerBank`). `desks.ts#pickOffices` picks offices
  already emailed, then with contacts, then plan order; `coverage.officePick[bankKey]` overrides (OfficePicker on the bank card).
  Desks elsewhere are `not_applying` and leave the scope and counts. Not-offered desks don't use a pick.
- **The owner's desks (`DESK_PRESETS`, "Add all my desks"):** Tech SF + LA, Generalist NY + LA, Energy Texas, over IB tiers only.
  `teamMatches`: Tech ⊇ TMT, Energy ⊇ power/utilities/oil & gas, Generalist ⊇ M&A. Team guesses fall back to the office's team
  (`teamSource: "office"`). Team cells with a URL or "?" are blank; "FIG?" is FIG. Credit Suisse = UBS, Mizuho Greenhill = Greenhill.
- **Bank tabs (`src/lib/bankTabs.ts` planners, `src/lib/tabChanges.ts#computeTabChanges` pure core, `actions.ts#ensureBankTabs`
  store wrapper; runs on every import and when a bank is added on /coverage):**
  1. `planTabFixes`: tabs the first version made with long names (tab = the title bank in capitals, no people; merged banner
     text doesn't count as people) are renamed to tickers; a small bank tab with no tracker title (the 9-30 "BNP": Oppenheimer
     title text, a person under the wrong headers) is rebuilt from the template, people read by content (`draftFromRow` with no
     table) into the Contact Information table, their contact re-id'd (`s:BNP:6` → `s:BNP:19`) and refreshed from the row, and
     the tab moved after the last bank tab.
  2. `planBankTabs`: every IB-tier bank on the coverage list (not the starter list, not PE, not hidden, not `coverage.skipTabs`)
     without a tab gets a copy of the emptiest bank tab, named by `tickerFor` (`TICKERS`: KEY, GLE, TFC, MQG, BBH, BNS…; else
     initials / first 4 letters), titled "X Application Tracker" → OVERVIEW, after the last bank tab.
  3. Every bank tab (not legacy "(NY)") is linked from OVERVIEW: by name if listed, else a row in the "MORE FIRMS (added by
     Coverage)" block below OVERVIEW's banners/formulas (rows are never shifted).
  Values are manual patches; structure is `state.sheetOps` (`lib/sheetOps.ts`: renames, replaces, clones, rowStyles), applied
  by `buildWorkbook` (rename → replace → clone → row styles → dropdowns → patches; `renameLinks` rewrites links to renamed tabs).
  Sheet toolbar: "23 new bank tabs · BNP rebuilt (unsaved) · Undo" (session undo restores the pre-change state and skips those
  banks; after a reload only new tabs can be removed), and "N banks without a tab" with the reasons (`bankTabsSkipped`).
  `check:workbook` runs the whole thing on a workbook and on a simulated first-version save, then checks a second run is a no-op.
  It runs when the dashboard loads (`Shell` → `refreshBankTabs`, which also re-reads the lists from the stored sheets), on import,
  **before every save** (`saveWorkbook`), and after applications-tab edits: an earlier version only ran it on import, so a save
  without a re-import wrote no tabs. There is no permanent skip list: Undo is for now; hiding a bank on /coverage leaves it out.
  `npm run fix:workbook -- "file.xlsx" [--dry-run]` applies it to a file directly (backup next to it; refuses if Excel has it open).
  The owner's live file is `~/Downloads/IB Recruiting - Master Spreadsheet (Claude 9-30)_3.xlsx` (saved in place by the dashboard).
- **Applications → tracked banks:** in an applications list (header with Institution Name + Program Type + Submitted Date /
  Application Status, e.g. "Apps (general)"), a row whose Program Type is a summer analyst / associate / intern program and that
  was submitted (a date that isn't "OOPS"/blank, or a status like pending / in process / rejected / accepted) is read by
  `workbook.ts#extractTargets` as a target with `applied: Application[]` (tier from the type; blank / "Bank?" = Investment Bank;
  PE/VC types = Private Equity). Applications are merged per firm, so firms already on OVERVIEW keep theirs. From there:
  the coverage list includes the firm → `computeTabChanges` gives it a tab + OVERVIEW row, and step 4
  (`bankTabs.ts#planCoverageRows`) adds SF / LA / NY rows to the COVERAGE tab (seats "Yes" for offices in the application's
  Target Location, else "Unclear"; contacts; GAP/Thin/OK; a note "Added by Coverage from your … application"). Rows with that
  note stay in step with the application (location typed after the date updates them). /coverage shows an "Applied" badge and a
  "You applied to … but haven't emailed anyone there yet" insight (also in the PE view). Runs on import, and on the grid
  (`SheetGrid` → `actions.ts#syncApplications`, 800 ms after edits stop on an applications tab; it re-reads targets and only
  acts when the firms or applications changed). The store's office-map subscription includes pending patches.
- **Outreach rules are settings** (`settings.outreach: OutreachRules`, Settings → Outreach rules, `components/OutreachRules.tsx`;
  defaults = the owner's in `outreach.ts#DEFAULT_OUTREACH_RULES`): your school / grad school / city / school system / state
  (comma lists, "a+b" = both), hometown (demonym + high schools / towns / area, e.g. "Orange County, Irvine"), heritage word
  (read only from the Comment column), volunteer hooks (match / yours / theirs), sports (match / subject label / yours; off
  while "yours" is empty, so no experience is ever claimed that the user didn't write), and which ties make an MD+ OK
  (`seniorExceptions`, incl. "sports"). `affinityOf(c, rules)` kinds are generic:
  volunteer > sports > hometown > heritage > grad / school > city > system > state > standard. A hometown hit on a place (not
  a school) says "your ties to X" and is flagged (it may be where they work now); no demonym → "UCLA Student from Irvine".
  Sports hooks are flagged for a check too. "Search for them on Find people" (`ruleQuery`) appends an editable
  `site:linkedin.com/in "{bank}" "investment banking" (A OR "B" …)` query (≤ 30 words) to `settings.prospect.queries`.
  `rulesOf` fills rules added later (sports) from the defaults. Subjects use `profile.schoolNickname`
  and the group labels ("Fellow Big Ten Student"); `check:outreach` also renders a Michigan / Chicago / Korean profile.
- **Bank coverage columns = `CoverageRow.stage`:** awaiting (emailed as many people as the cap allows on every desk being
  applied to; cap = `followUp.livePerBank` per desk, or for the bank with no desks), could_max (emailed someone, room left;
  card says "1 of 2 emailed. Email X"), not_reached (contacts, none emailed), cold. `slots = {emailed, max}`. `bucket`
  (reached / ready / cold) still drives the scoreboard.
- **Private equity** is its own segment: desks never apply to PE (`targetAppliesTo`), /coverage has an "Investment banks | Private
  equity" switch (PE view: no plan, coverage without desks), the sheet tab bar and the contacts list have a firm-type filter
  (`components/useFirmKinds.ts`, tier from the workbook's lists).
- **Restore tab links** (sheet toolbar, `sheetLinks.ts#tabLinkPatches`): rebuilds OVERVIEW ↔ bank-tab links an older save stripped,
  as manual patches (the 9-30 workbook had 0; 92 restorable = the original 45 + 47).

## Status / known gaps (as of 2026-09-24)

- Built and `npm run build` passes. The parser was verified on the owner's workbook (106 contacts, round-trip OK).
- Grid (select, delete/insert row, undo, type-to-contact, paste) and the recruiting plan were click-tested on 2026-09-28 against a synthetic
  workbook on a separate origin (127.0.0.1 + `next start`, so the owner's IndexedDB at localhost wasn't touched). Other pages have not been click-tested. No live calls have been made with *real* keys.
  Every provider's key test *was* exercised with fake keys: each rejects cleanly, multi-key fallback reports "All N … keys failed", and the SSRF guard blocks private IPs.
  The owner's Google Client ID was confirmed to exist (auth endpoint answered `redirect_uri_mismatch`, not `invalid_client`).
  Things most likely to need fixes on first real use:
  - Apollo response field names (`matches`, `email_status`, placeholder `email_not_unlocked@…`).
  - Gmail OAuth origin setup.
  - Serper result title parsing (`parseLinkedInTitle`).
- ExcelJS can drop some exotic formatting (charts/pivots) on save. Check a saved copy before trusting in-place save on a new workbook.
- Legacy `(NY)` tabs in the owner's workbook (EVR (NY), LAZ (NY), MC (NY)) are still read. New people always go to the main tab.
  They could be merged into the main tab manually.
