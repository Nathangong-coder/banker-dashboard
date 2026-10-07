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
- **Contacted column** (`src/lib/contacted.ts`): send dates live in the workbook ("9/17/2026 · last 9/25/2026",
  "Scheduled 10/6/2026 9:00 AM"), read into `sentAt` / `lastTouchAt` / `scheduledAt`. `contactPatches` writes them, adding
  the header in the empty column left of Status (H on the owner's tabs; GS already had "Contacted") when missing, and
  compares by meaning so the owner's own formats aren't rewritten. Before this the sheet had no dates at all, so every
  "Sent" person showed as due ("sent date unknown").
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

## Email formatting & signature (`src/lib/emailFormat.ts`)

- Drafts are multipart/alternative. The HTML part is Gmail-native (`<div>` per line, `<div><br></div>` between paragraphs); text/plain alone
  gets hard-wrapped by Gmail at ~78 chars. `normalizeBody` removes indents and doubled blank lines, and glues the sign-off to the name
  (only when the next line looks like a name).
- `withSignature` appends `email | [LinkedIn](url)` under the name (or the custom signature from Settings). `[label](url)` is the one
  markup the app understands: an `<a>` in HTML, "label: url" in plain text. Emails and bare URLs are auto-linked (blue in Gmail).
  In a custom signature the bare word "LinkedIn" is linked to the profile URL, and a leading name that duplicates the sign-off is dropped.
  Phone numbers are deliberately NOT links: `unlinkPhones` puts `&zwnj;` between digit groups to defeat Gmail/Apple data detectors.
  The HTML wrapper gets `font-family` from `settings.emailStyle.font` (`EMAIL_FONTS`, Gmail's own stacks; default Garamond).

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
- Deep links: `/find?banks=A|B` (pipe-separated, optional `&desk=NY|Tech` to steer the AI screen), `/drafts?bank=Name`,
  `/sheet?view=contacts&filter=noemail|noteam&bank=Name`.
- **Recruiting plan** (`coverage.plan`, `src/lib/desks.ts`, `components/RecruitingPlan.tsx`): a checklist of desks (office + team) with a scope of
  all banks, tiers, or picked firms. `buildCoverage` fills `CoverageRow.desks` via `deskStatus` (replied / emailed / ready / needs_email / empty).
  SF/NY match `region` and other offices match the location text. "Tech" also matches TMT/Technology. Contacts with no team count toward no desk,
  and the UI links to the no-team filter. Select the plan with `useStore((s) => s.coverage.plan)` and default outside the selector: `?? []`
  inside it returns a new array every call, which re-renders forever in zustand v5.

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
  Chicago/Texas Central, else Pacific), weekdays only. `planSends` gives a batch spots 6 min apart (+0–2 min jitter) around sends already
  queued, overflowing to the next weekday; `zonedDate` is DST-safe. `queueSends` uses it; `rescheduleQueued` ("Move N queued emails
  into this window") re-plans everything queued. check:outreach covers zones, weekends, spreading, overflow and DST.

## Firm facts: where they come from and the guardrails

- No live source exists (banks don't publish their summer-analyst desks via any API). Order of authority: anyone the owner has found
  on a desk > the owner's COVERAGE tab (`sheetOfficeInfo`) and applications (`coverage.ts#withEvidence`: a "Technology IB" program
  opens the Tech desk at a listed specialist) > the owner's per-firm override on /coverage > the hand-checked built-in lists
  (`offices.ts` BUILT_IN, `specialty.ts` BUILT_IN, both stamped `*_REVIEWED`).
- `npm run check:firms` fails on name collisions, non-standard teams, built-in contradictions, broken golden cases (Leerink SF Tech
  not offered, Qatalyst NY Generalist not offered, TPH Texas Energy offered…) or broken guardrails; warns when a list is >1 year
  since review; with a workbook, lists where the COVERAGE tab disagrees with the lists (compared by `inferTeam`, not text).

## Conventions

- Client pages are `"use client"` and render only after store hydration (`Shell` → `useHydrated`). Server routes import `server-only`.
- UI primitives are in `src/components/ui.tsx` (Button, Card, Badge, Modal, toast…). Design tokens are in `src/app/globals.css`
  (paper / navy / brass palette, IBM Plex Sans/Mono, Instrument Serif headings). Match the existing density and tone.
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
- **Signature:** `School Class of YYYY / major / phone | [LinkedIn](url) | email`. `unwrapRedirects` strips `google.com/url?q=` wrappers.

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
  is `notOffered` and leaves the counts, the columns and the "you applied to…" nudge. /coverage: `SpecialtyPicker` on each card
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
  (comma lists, "a+b" = both), hometown (demonym + places), heritage word (read only from the Comment column), volunteer hooks
  (match / yours / theirs), and which ties make an MD+ OK (`seniorExceptions`). `affinityOf(c, rules)` kinds are generic:
  volunteer > hometown > heritage > grad / school > city > system > state > standard. Subjects use `profile.schoolNickname`
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
