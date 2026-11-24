# Follow-ups overview, Gmail scheduling hand-off, visible extension cursor (owner, 2026-11-23)

## Why

The owner doesn't use Follow-ups because it can't be checked by hand: no links to the Gmail thread, no way to search
Gmail for other emails with someone, a big number ("74") with no breakdown, and a row of sections that don't make sense
(Replied duplicates Warm follow-ups; Scheduled shows 13 when Gmail has 18). Automatic sending broke once and the owner
stopped trusting it, so scheduling has to happen **inside Gmail**, where the owner can see every scheduled email and
filter to just Coverage's. The extension already automates pages, but you can't see what it's doing (no cursor; it
"randomly clicks / disappears").

Success = the owner can open Follow-ups, see per bank what makes up the total, see on a calendar which days have
unanswered emails either way, jump to Gmail filtered to exactly those emails, and get tonight's emails into Gmail's own
Schedule send (by the extension or by Claude in Chrome) without clicking through each one.

## Goals

1. **Follow-ups overview** (new first page in the Follow-ups category): per-bank breakdown that adds up exactly to the
   Cold outreach count in the nav, plus a month calendar (green = days you emailed people who haven't replied; red =
   days someone wrote and you haven't answered). Click a day → that day's emails in Gmail. One-click "No reply needed"
   on red items.
2. **Every person row on Cold outreach, Warm follow-ups and the overview links out:** the Gmail thread, a Gmail search
   for that person (all addresses on file + name, both directions), LinkedIn.
3. **Cleaner Cold outreach:** Replied tab removed (its "offer times / send invite" go to Warm follow-ups rows);
   Scheduled count matches Gmail's Scheduled folder.
4. **Scheduling in Gmail, two ways, one list:** (A) the extension opens each draft in Gmail and uses Schedule send;
   (B) Claude in Chrome does the same through the Recruitify plugin + Coverage connector. Both read the same
   "to schedule" list and both are verified the same way (Gmail's `in:scheduled`).
5. **Visible extension cursor** for every automated click (applications and Gmail).
6. **9 PM text freshness:** find why the owner's text was stale and fix the cause; the end-of-day Sync must push the plan.

## Non-goals

- The landing page / product pages (next, separately; owner will add a demo video later).
- Replacing Coverage's own server sending (it stays as an option; this adds the Gmail route).
- Shipping Gmail scheduling in the Chrome Web Store build (test build only, like open tracking).
- A shared DataTable / saved views for the other list pages (still queued).

## Anti-goals (fails even if it "works")

- Any number on the overview that doesn't reconcile with the nav badge or the lists it summarizes.
- An email scheduled at a time other than the one shown in Coverage, or scheduled twice (Gmail + Coverage).
- The extension or Claude pressing **Send** instead of Schedule send, or touching a draft that isn't on the list.
- Marking something "scheduled" in Coverage that isn't in Gmail's Scheduled folder.
- Busy "dashboard" decoration: KPI tile rows, pill badges on every row, gradients (docs/DESIGN.md V-2, V-3, B-3).

## Constraints

- Gmail's API cannot create Schedule-send emails; something must click Schedule send in Gmail's page.
- Server Google connection has `gmail.compose` (+ optional `gmail.readonly`); labels need `gmail.modify`, which only
  the browser token asked on click has (`lib/gmailLabels.ts` already does this).
- Usage diet (CLAUDE.md 2026-11-23): no new polling; the hand-off list rides on the existing server sync.
- DESIGN.md: L-3 for the overview, D-1 tables, C-3 progress colors, tokens only, 390 px no horizontal scroll.

## Approaches considered (for scheduling)

| | How | Trade-off |
|---|---|---|
| **A. Extension (picked)** | Coverage drafts + lists; the extension opens each draft in the Gmail tab and schedules it at its slot while you watch | Gmail markup changes can break it; needs the test build's mail.google.com access |
| **B. Claude in Chrome (picked, alongside A)** | You ask Claude "schedule tonight's emails"; the plugin skill reads the list from the connector and clicks through Gmail | Slower, uses Claude usage, started by you each time; nothing new in the extension |
| C. Coverage server sending, made checkable | Label + link + morning-after check | Not in Gmail's Scheduled folder, which is what lost the owner's trust |

Owner chose **A and B**. They share everything except the "hands".

## Design

### 1. The hand-off list ("To schedule in Gmail")

- In Gmail mode (`settings.sendMode === "gmail"`, or no server connection), "Draft & schedule" on Cold outreach /
  Drafts writes the Gmail draft as today, then records `contact.gmailSchedule = { draftId, messageId, step, at, state,
  updatedAt }` where `at` = the slot from `planSends` (unchanged rules: send window, 6–8 day spacing, random minute) and
  `state` = `waiting` | `scheduled` (confirmed in Gmail) | `failed` (with `error`).
- The server sync pushes the `waiting` items (name, email, subject, messageId, at, step) as `handoff` on the account;
  the MCP route serves it. No new polling.
- **Verification is Gmail's own:** the existing `in:scheduled` read (`api/server/scheduled` +
  `gmailScheduled.ts#applyGmailScheduled`) marks an item `scheduled` when a scheduled message to that address exists
  within ±2 min of `at`. Nothing is marked scheduled on the extension's or Claude's word alone.
- A contact with `gmailSchedule` waiting is excluded from `queueSends` (no double send), and vice versa.
- Gmail links: draft = `https://mail.google.com/mail/u/0/#drafts?compose=<messageId>`; "all of Coverage's scheduled" =
  `#search/in:scheduled label:Coverage` when the label exists, else `#search/in:scheduled (to:a OR to:b …)`.
  The `Coverage` label (`Coverage/Follow-up`, `Coverage/First email`) is added with the browser `gmail.modify` token
  when it's already granted (same rule as Gmail labels' "Keep up to date"); otherwise the recipient search is used.

### 2. A — the extension schedules

- Dashboard: Cold outreach → Scheduled (and Drafts) get **"Schedule N in Gmail"** → `applyBridge.ts#sendCommand(
  "scheduleInGmail", items)`.
- Worker (`background.js#scheduleInGmail`): finds or opens one Gmail tab (`mail.google.com/mail/u/0`), focuses it, and
  per item: navigate to the draft link → wait for the compose → check the To address and subject match the item (else
  skip: `failed: "draft changed"`) → More send options → Schedule send → Pick date & time → type the date and time
  (in the browser's zone; Gmail's picker uses it) → Schedule send → wait for Gmail's "Send scheduled" toast →
  report `scheduledInGmail` (id, ok/error). One at a time, ≥ 2 s apart. Never clicks a button whose text is "Send"
  alone. Stop button in the watch banner.
- New page script `sites/gmailSchedule.js` (or a section of `sites/gmail.js`), selectors in one `SEL` block next to
  the existing ones; real input via `cov-click` / `cov-type` like the application fills.
- After a run the dashboard asks the server to re-read `in:scheduled` (one call) so states flip to confirmed.

### 3. B — Claude in Chrome through the plugin

- Connector (`api/mcp`): `emails_to_schedule` (read-only: the `waiting` hand-off items with name, to, subject,
  `sendAt` in the user's zone, draft link, "all scheduled" link) and `confirm_scheduled` (asks the server to re-read
  `in:scheduled` now and returns which items it found; nothing is marked by the caller).
- Plugin skill `schedule-in-gmail` (`plugin/recruitify/skills/schedule-in-gmail/SKILL.md`, plugin version bump):
  call `emails_to_schedule` → confirm the list with the user → for each, Claude in Chrome opens the draft link, checks
  To/subject, uses More send options → Schedule send → Pick date & time → enters `sendAt` → Schedule send; never
  presses Send → `confirm_scheduled` → report found / missing. Works from Claude Code and the Claude app (connector).

### 4. Visible cursor (extension)

- `background.js#trustedClick` (every automated click goes through it) first injects / moves a cursor overlay in the
  page (`pointer-events: none`, top z-index, arrow + a ring on click), glides it from its last spot to (x, y) over
  ~300–500 ms, pulses, then clicks. Typing shows a caret badge on the field. Removed when the run ends. Works in the
  test build's background windows too (it's in the page, so a screenshot or a watching user sees it).
- Fallback (no debugger): the dispatched-event path moves the same overlay.

### 5. Overviews: an "Overview" tab on Cold outreach AND on Warm follow-ups (owner, 2026-11-23)

Each page opens on its Overview tab (Cold outreach: Overview · Queue; Warm follow-ups: Overview · the current lists).
The calendar is one shared component on both (both colors, so either page answers "which days need me").

**Warm overview** (owner: "lists out everyone at each bank so I know who to email over Thanksgiving"): one group per
bank (bank link, health color), everyone warm there (replied, met, referred you, or a logged chat): name → /person,
title, how you know them (chat 10/14, replied 10/2, referred you), last email either way, what's owed if anything
(the `todoFor` label), and Gmail / LinkedIn links. Sorted by bank urgency, people by last contact (oldest first, so
the ones going stale lead). A "Haven't heard from in N+ days" filter (default 14). Tick people → **"Draft check-ins"**
drafts the check-in template for each into Gmail (a new starter template "Holiday check-in", `{{holiday}}` /
`[[AI: one line from your last chat notes]]`, no resume) and adds them to the To schedule list (§1). My call: the
holiday wording is a template the owner edits, not hard-coded.

**Cold overview** (below):

L-3 layout, no tiles. Header meta line = the totals in words ("74 to do · 31 went cold · 18 scheduled · 6 replies
owed"). Then two columns (stacked under 1024 px):

- **By bank** (D-1 table, left ~60%): Bank (link to `/bank?key=`), Follow-ups due, Replies owed, Thank-yous /
  check-ins, Drafted, Scheduled, Went cold. Sorted by total to-do. A footer row with column totals; the first three
  columns' total = the nav badge (same functions: `nextAction`, `todoFor`). Clicking a count opens that list filtered
  to the bank (Cold outreach `?bank=`, Warm follow-ups `?bank=`).
- **Calendar** (right ~40%): month grid, ‹ › months. A day is shaded green (step lightness by count, C-3) when you
  emailed people that day who haven't replied since; red when someone wrote that day and you haven't answered (warm
  `unansweredReplies` + cold replies not handled). Both → split cell. Click a day → a panel under the calendar lists
  that day's people (name, bank, which way, "Open in Gmail", "No reply needed" for red ones = `handledAt` in one
  click, undo in a toast) and an **"Open this day in Gmail"** link: `#search/(to:a OR to:b OR from:c …)
  after:<epoch start> before:<epoch end>` (epoch seconds so the day is the owner's local day). Long recipient lists
  are cut into several links (Gmail's search box limit) with a note.

### 6. Cold outreach clean-up

- Tabs inside the queue: **Due · Drafted · Scheduled**. "Replied" goes (the "Reply with times" / "Send invite"
  actions move to Warm follow-ups rows for reply items). "Referrals" moves to Warm follow-ups. "Not in tracker" and
  "Needs new contact" stay as one-line notices that open their lists in a side panel. The By banker / By bank tabs go
  (Overview replaces By bank; People on the spreadsheet page is the per-banker list).
- **Scheduled = Gmail's Scheduled folder + Coverage's own queue**, reconciled: one row per scheduled email, including
  ones to people not tracked (marked "not in tracker"). The 13 vs 18 gap is investigated on the owner's data first
  (likely: several scheduled emails to one person collapsed into one row, or addresses not matched to a contact), and
  `check:accuracy` gets a case for the cause.
- Row links (all lists): Gmail thread (`#all/<threadId>` when known, else the person search), "Search Gmail"
  (`#search/(from:x OR to:x OR "<First Last>")` over every address on file), LinkedIn.

### 7. 9 PM text

- "Update tonight's list" already exists on Reminders. Check the owner's account (Reminders → "Last sent to the
  server", Vercel logs for `/api/server/sync` + tick) to find why last night's text was stale, fix that cause, and make
  sure the header Sync (and the scheduled end-of-day run) ends with the plan push (`backgroundJobs` runs server sync
  last; confirm it runs when `syncEvery` is 6h and the tab is open in the evening).
- Also add the button to the header Sync menu ("Update tonight's text").

### 8. Process tracker → bank page (done 2026-11-23)

`Modal` takes `titleHref`; the Process tracker's "People & to-dos" title links to `/bank?key=`.

## Decided by the owner

- Approaches A and B, both.
- Overview + calendar with green / red days, click a day → Gmail filtered; easy disregard.
- Replied removed or replaced; Scheduled must match Gmail.
- Cursor must be visible.
- The overview should look clean; the owner will send reference designs to look at.

## Calls made here (owner can change)

- (Owner changed: the overviews are tabs on Cold outreach and Warm follow-ups, not their own page.)
- Draft check-ins uses an editable "Holiday check-in" starter template.
- Referrals → Warm follow-ups; By banker / By bank tabs removed.
- Gmail scheduling is test-build only.
- Verification only through Gmail's `in:scheduled`.
- Calendar uses the owner's local day; "emailed" = any of your emails that day with no reply since.

## Left to the builder

- Exact Gmail selectors for the date/time picker (checked live; keep them in one `SEL` block).
- Hand-off storage key names and the sync payload shape (follow `serverSyncBody.ts`).
- Calendar cell styling within the tokens.

## Verify

- `check:accuracy` (+ new cases: overview totals = nav badge; scheduled reconciliation; calendar day buckets),
  `check:night`, typecheck, lint, build.
- Owner's real data in Chrome: overview totals, the 18 scheduled, a day's Gmail link.
- Extension: schedule one real draft to the owner's own address for tomorrow, see the cursor, confirm in Gmail's
  Scheduled, then cancel it. Claude in Chrome: same with the plugin skill.
