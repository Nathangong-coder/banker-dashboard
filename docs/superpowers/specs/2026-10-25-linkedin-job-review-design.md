# LinkedIn job review: AI reads LinkedIn jobs and adds the right ones (design)

Owner request, 2026-10-25. Step 1 of two: **finding** jobs. Step 2 (mass applying: real-site testing of Fill selected,
the agent-bench practice task) gets its own design later. Roadmap position: right after accounts/login, before the
mobile app design.

## Why

The owner's recruiting goal is peace of mind: a tracker that fills itself with the jobs they should apply to, so they
can see what's out there per firm without scrolling LinkedIn by hand. Today's LinkedIn search (extension 1.3, test
build) uses no AI and stalls after a few jobs. The owner wants the extension to click through LinkedIn Jobs the way a
person does, read each description in the right-hand pane ("extremely necessary"), have the AI judge it, and add the
good ones to the tracker by itself. Reads are stored so a job is never re-read or re-judged (saves tokens for people on
limited AI plans). The same "read once, store, judge" pattern is meant to apply to contacts later (not in this design).

## How the owner judges a posting (the review rules; these are the defaults)

1. **Firm.** Well-known names rank above firms nobody has heard of. The owner named Edward Jones and Capital One as
   firms that should rank higher, i.e. "prestige" = a recognizable name, not elite-IB only. Firm rank uses what
   Coverage already knows (workbook target tiers, `/firms` stars, `STARTER_TARGETS`, banks on the tracker); the AI
   rates only firms none of those know (known name vs unknown).
2. **Role.** The AI puts each posting in one **role type** from a list; each role type has a verdict the user sets
   (**Apply / Maybe / Skip**) and the list order is the priority (owner, 2026-10-26: "everything but sales & trading
   and quant", S&T = maybe, quant = filtered out). Defaults, in priority order:

   | Role type | Default | Covers |
   |---|---|---|
   | Investment banking | Apply | M&A, coverage groups, ECM / DCM, leveraged finance, restructuring |
   | Project finance | Apply | project / infrastructure / energy finance |
   | Investing / buy-side | Apply | PE, growth, VC, private credit, hedge-fund-style investing |
   | Corporate banking | Apply | corporate / commercial banking analyst programs |
   | Equity research | Apply | sell-side research |
   | Corporate development / strategy | Apply | corp dev, strategic finance |
   | Financial advisory / valuation | Apply | transaction services, valuation, Big 4 deal advisory |
   | Risk / credit | Apply | credit analysis, risk management |
   | General finance | Apply | FP&A, treasury, corporate finance, finance rotational / back-office finance |
   | Sales & trading | Maybe | sales, trading, markets |
   | Quant | Skip | quant research / trading / developer roles |
   | Wealth management | Skip | private wealth, financial advisor (owner confirmed 2026-10-25) |
   | Asset management | Skip | AM, even though it's buy-side (owner confirmed 2026-10-25) |
   | Not finance | Skip | software, marketing, operations, anything else |

   **Customizable per user** (Applications → Find jobs → "What jobs I want"): change any role type's verdict with an
   Apply / Maybe / Skip switch, drag to reorder (priority sorts the lists), add a custom role type (name + a short
   "covers" line, e.g. "Real estate investing"), or delete one. The AI gets the list (name + covers) and must answer
   with one of its ids (server-checked); "Not finance" always exists as the catch-all and can't be deleted. Changing a
   verdict re-sorts stored reviews instantly with no AI call (the verdict is computed by code from the stored role
   type); only adding / editing a role type's "covers" text offers "Re-check N jobs".
3. **Class year.** The posting must be open to the owner's class years: **class of 2028 or 2029**. Postings rarely say
   "class of"; the AI converts what they do say ("graduating Dec 2027 – Jun 2028", "rising junior", "Summer 2027
   Analyst" = class of 2028, "Summer 2028" = class of 2029). If it can't tell: "year unclear", never a guess.
   - **Class of 2028 postings use the owner's "junior" resume** (uploaded under Applications → Resumes and marked for
     class of 2028). Class of 2029 uses the main resume.

Each reviewed job gets: verdict **apply / maybe / skip**, a one-line reason, firm rank, role type, class years it's
open to (or unclear), and the resume it would use.

These rules are editable settings with the owner's as defaults (house rule: change defaults, keep them editable).
For other users the class years default from their profile's graduation date: that class and the one before it
(my call, mirroring the owner, who applies to both).

## What happens after a run (owner-decided)

- **Apply jobs are added to the tracker automatically**, no button. They land in an **"Added by AI"** section of
  Applications → Jobs, with the reason, class years and resume (`resumeId` set to the junior resume for class-of-2028
  jobs).
- The tracker has two parts: **My list** (jobs you're going after; jobs you add yourself go here) and **Added by AI**
  (the inbox you prune). Per job: **Keep** → moves to My list; **Remove** → asks "why?" in one line, and the answer
  becomes a review rule (like the grader's "Disagree" → grading rules). Fill selected works on either part.
- **Maybe** jobs stay in Find jobs for you to look at (with their reason). **Skip** jobs are hidden but kept, under a
  collapsed "Skipped by AI (N)" so you can check what it threw out; overruling one ("this should be Apply") also asks
  why and adds a rule.
- A job already tracked (by link, LinkedIn id, or firm + title: `jobFinder.ts#freshJobs` rules) is never added twice.
- End-of-run line: "Read 30 · 7 added · 9 maybe · 14 skipped".

## Starting a run + the reminder text (owner, 2026-10-26)

- **A run starts only when you press the button**: "Search LinkedIn jobs" on Applications → Find jobs. No automatic or
  scheduled runs (LinkedIn is read in your own logged-in Chrome, so you're there when it happens). Shows "N runs left
  today" against the daily cap.
- **Reminder text:** the 9 PM WhatsApp text (Mon–Thu, `digestFormat.ts`) gets a line "Find jobs: press Search
  LinkedIn jobs (last run 2 days ago)" with a link to `/applications?find=1`, which opens the Find jobs card with the
  button in view. It's left out once a run happened that day. Server side: the dashboard pushes `lastJobRunAt` with the
  digest plan, so the server's text knows. Settings (Applications → Find jobs, next to the role types): reminder on /
  off (default on) and "remind me if I haven't run it in N days" (default 1 = every text night). Fri–Sun texts keep
  their rule (only when there were calls), so the reminder doesn't create a weekend text on its own.

## A run (owner-approved approach)

- **30 jobs per run** (owner: "a good session"). Daily cap raised from 60 to **90** (three runs), editable in the
  extension's Options (my call; the owner accepted LinkedIn's ban risk for this opt-in feature).
- The extension opens the LinkedIn Jobs search in a tab and **clicks each job card in the list**, waits for the
  right-hand pane to show that job, reads its title / company / location / posted / description / apply link from the
  pane, then moves to the next card, scrolling the list and going on to page 2, 3… (`&start=25`, 50…) until 30 new jobs
  are read or the results run out. Person's pace, randomized waits (today's 6–14 s per job is the reference).
- **Every wait has a time limit.** A card whose pane doesn't change in time is skipped; a page that doesn't load is
  skipped. It never sits forever (today's `loaded()` has no timeout: the "just sits there" the owner saw).
- **Jobs already known are skipped without reading** and don't count toward the 30: the dashboard sends the LinkedIn
  ids it already has (found, tracked, skipped) with the command, so a second run carries on with new jobs.
- **Text first, screenshot as fallback:** if the pane's text is nearly empty, take a screenshot of the pane and send
  that to the AI instead. Screenshots only work while the tab is visible ("Watch it work"); in a background run a job
  that can't be read as text is marked "couldn't read" and left for the next watched run (my call).
- Stops at any LinkedIn sign-in / checkpoint / security page, as today. Never clicks Apply / Easy Apply / Save / anything
  but job cards and pagination.
- Closes its tab at the end (as today), and the dashboard tab must be open (as today: the bridge).
- **Why today's version finds few jobs:** it looks for `a[href*="/jobs/view/"]` links, which LinkedIn's search list
  mostly doesn't use anymore (cards carry `data-job-id` / `data-occludable-job-id`, links use `currentJobId=`), and it
  reads one page only. The new reader keys on job ids from those attributes, not class names (LinkedIn's DOM changes
  often; same principle as the bookmarklet).

## Stored reads (token saving)

- Each job's read (description ≤ 6,000 chars, as today) and its review are stored in the account, keyed by LinkedIn
  job id, on the found job (synced like today's `af:` docs). A stored job is never re-read from LinkedIn and never sent
  to the AI again.
- When the review rules change (edited, or a rule added by Keep/Remove/overrule), stored jobs that aren't tracked yet
  can be re-judged from the stored text ("Re-check N jobs with your new rules"), never re-read from LinkedIn. Not
  automatic, so a rule edit doesn't silently spend tokens (my call).
- Reviews go to the AI in batches (several jobs per call) as jobs arrive during the run, using the user's own AI chain
  (`withAi`), through a new stateless route. The AI gets the job text and the review rules (incl. class years and the
  firm list), never the user's profile, contacts or resume.

## Constraints

- LinkedIn job search stays **test build only** (`--with-agent`); the store build can't run it.
- Nothing ever applies or submits; the reader only clicks job cards and pagination.
- Job page text is untrusted: the AI's output is limited to the fixed fields above (structured output, server-checked);
  a description can't add rules or change verdicts of other jobs.
- Privacy pages: mention that job postings you find (public text) and their AI reviews are stored in your account and
  sent to your AI provider; bump `legalUpdated`.
- House rules apply: no hardcoded colors, zod on routes, toasts not alerts, keep `check:jobs` passing.

## Non-goals

- Mass applying / real-site Fill selected testing / the agent-bench practice task (step 2).
- Contacts with the same read-once pattern (later).
- Searching anywhere but LinkedIn with the click-through reader (career boards keep their API search).
- Any LinkedIn action beyond reading listings (no Easy Apply, no saving jobs, no messages).

## Anti-goals (would make it a failure even if it works)

- The tracker fills with junk (wealth/AM roles, wrong class years) the owner has to clean up.
- It stalls or sits on a tab doing nothing.
- It re-reads or re-judges the same jobs and burns tokens.
- It guesses class years.

## Calls made after the builder check (mine, for the owner to check)

- **Internship + US only.** The owner recruits for summer analyst internships in US offices, so `jobFinder.ts`'s
  `isInternship` and `inUS` rules apply to LinkedIn jobs too: a full-time or non-US posting is "skip" with that reason,
  whatever the AI says.
- **No AI available** (no key, or every model out of quota mid-run): the run still reads and stores jobs, marked
  "not reviewed yet"; they're reviewed from the stored text as soon as AI works again (no re-reading). Nothing is
  auto-added until reviewed.
- **The verdict is set by code from the AI's fields** (firm rank, role type, class years, internship, US), not by the
  AI, so it's predictable and covered by `check:jobs`. The AI extracts and classifies; rules learned from
  Keep / Remove / overrule are free text sent to the AI (like grading rules) and can only change how it classifies.

## Left to the builder

- Data shapes (review fields on `FoundJob` / `JobApplication`, the "Added by AI" flag, the resume's class-year mark,
  where the review rules live in `ApplyState`), the route name, batch size, exact timeouts and waits, list size caps
  for stored skipped jobs, and the UI details within the existing Applications page pattern.
- Tests: pure logic (class-year conversion helpers if any, auto-add decision, dedupe, resume pick) in `check:jobs`;
  the click-through reader on a mock LinkedIn page in the headless harness, as for 1.3.

## Added 2026-10-26: Handshake, the Excel tab, mass apply (owner: "build ASAP"; calls marked "my call")

- **Class years:** the owner applies to Summer 2027 internships and doesn't mind class of 2028 or 2029, so both are
  open and "year unclear" keeps the role's verdict (tagged "year unclear"); only a posting clearly for other years
  (class of 2027, MBA, graduate students) is skipped (my call).
- **Handshake** is a second source in the same pipeline (stored reads, AI review, auto-add). Opt-in in the extension's
  Options, test build only, same risk note as LinkedIn (Handshake's terms forbid automated access): the reader opens a
  Handshake job search in your own logged-in browser, reads each posting's page at a person's pace (same caps), and
  stops at any sign-in. Most Handshake postings say **"Apply externally"**: Fill selected opens the Handshake page,
  clicks that button (never "Apply" inside Handshake, never submit), follows the tab it opens (usually Workday) and
  fills that like any other job. A posting that applies inside Handshake is "needs you" (my call: Handshake's own
  apply is one click on a resume you pick; it stays yours).
- **LinkedIn reader (my call, for speed):** keeps opening each job's own page (it reads the full description reliably)
  instead of clicking cards in the pane; adds the job-id attributes, pages 2, 3…, skipping known ids, 30 per run,
  90 per day.
- **Excel:** every job on **My list** (added by you, or Kept from "Added by AI") gets a row on the workbook's
  applications tab (the owner's `APP ('27)`: Program Type = role, Institution Name = firm, Institution Type = tier
  when known, Application Link, Submitted Date, Status, Target Location), in the first numbered row with no firm, or
  the existing row with the same firm + program. Status words follow the owner's: submitted → IN PROCESS, then
  INTERVIEWING / OFFER / REJECTED / WITHDRAWN; a status typed in Excel that the dashboard doesn't know is never
  overwritten, and a status is only moved forward. "Added by AI" jobs aren't written until Kept (keeps the sheet
  free of jobs you'd prune). Written like every other dashboard edit: pending until you Save.
- **Mass apply (first cut of step 2):** Fill selected takes up to 50 jobs, runs two background tabs at a time, and
  when the last one finishes sends one WhatsApp text: "N ready to review and submit · M need you" with the reasons
  and a link to Applications. You still review and click Submit on each.
