# Follow-ups overviews + Gmail scheduling hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Follow-ups checkable by hand (links to Gmail, Scheduled matching Gmail, overviews by bank + calendar for cold and warm) and get emails into Gmail's own Schedule send via the extension (with a visible cursor) or Claude in Chrome.

**Architecture:** Pure logic in new `src/lib/*.ts` files covered by a new `npm run check:followups` script (the repo's test pattern: tsx scripts with `check(what, ok)`); React UI in `src/components` + the two pages; the hand-off list rides on the existing `/api/server/sync` body and is served by two new MCP tools; the extension gets one new command and a cursor overlay inside `trustedClick`.

**Tech Stack:** Next.js 16 App Router, React 19, Zustand store, zod, plain-JS MV3 extension, hand-rolled MCP route.

**Spec:** `docs/superpowers/specs/2026-11-23-followups-overview-gmail-scheduling-design.md`

## Global Constraints

- Gmail web links: `https://mail.google.com/mail/u/0/#search/<encodeURIComponent(query)>`, threads `#all/<threadId>`, drafts `#drafts?compose=<messageId>`.
- Day filters use epoch seconds: `after:<startSec> before:<endSec>` of the owner's local day; one link ≤ 1,800 chars of query, more links if longer.
- Verification of "scheduled" only via Gmail's `in:scheduled` (`api/server/scheduled`): match = a scheduled item to that address within ±2 minutes of `at`.
- Nothing ever presses plain **Send**; a draft whose To / subject don't match the item is skipped (`failed: "draft changed"`).
- No new polling (usage diet); hand-off rides on the server sync; Gmail scheduling only in the extension's test build.
- DESIGN.md: L-3 overviews, D-1 tables, no KPI tiles, tokens only (no hex in components), one badge per row max, 390 px no horizontal scroll.
- Cold total on the overview = Shell's nav badge (follow_up + move_on that are `isDue`), from one shared function.

## Review Focus

- A person with two scheduled emails (first + follow-up) → two Scheduled rows, not one (likely the 13 vs 18 gap) — test in Task 3.
- A scheduled email to an address that's only an alias, or to someone not in the tracker → still a row — test in Task 3.
- A day with 40+ people → several Gmail links, none over the limit — test in Task 1.
- Someone queued for Coverage sending AND put on the Gmail hand-off → only one survives (hand-off wins only if no serverSend) — test in Task 6.
- Gmail scheduled time 1 minute off the planned slot → still confirmed; 10 minutes off → not — test in Task 6.

---

### Task 1: Gmail links

**Files:**
- Create: `src/lib/gmailLinks.ts`
- Create: `scripts/check-followups.mts`; Modify: `package.json` (script `check:followups`)

**Interfaces:**
- Produces: `gmailSearchUrl(q: string): string`, `gmailThreadUrl(threadId: string): string`, `gmailDraftUrl(messageId: string): string`, `personQuery(c: Pick<Contact,"email"|"aliases"|"name">): string` (`(from:a OR to:a OR from:b OR to:b OR "First Last")`), `dayLinks(day: Date, people: {to?: string[]; from?: string[]}): string[]` (URLs).

- [ ] Step 1: tests in check-followups: search URL encodes `in:scheduled`; personQuery includes every address + quoted name; dayLinks for 1 person = 1 URL containing `after:` / `before:` epoch seconds of local midnight / next midnight; 60 addresses → ≥2 URLs each with query ≤ 1800 chars.
- [ ] Step 2: run `npm run check:followups` → FAIL (module missing).
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS. Commit.

### Task 2: Row links on every person row

**Files:** Create `src/components/PersonLinks.tsx`; Modify `src/app/followups/page.tsx` (row + ScheduledRow), `src/app/think/page.tsx` (TodoTab rows, Everyone).

**Interfaces:** `PersonLinks({ c }: { c: Contact })` → three small links: "Gmail thread" (`c.threadId` or `c.mail?.messages[0]?.threadId`, else hidden), "Search Gmail" (`personQuery`), "LinkedIn" (if `c.linkedin`). `target="_blank" rel="noreferrer"`, 12 px, muted → brass-ink on hover, icons from lucide.

- [ ] Step 1: add component; place under the name in each row (NameCell sub-line).
- [ ] Step 2: `npm run typecheck && npm run lint` pass. Commit.

### Task 3: Scheduled = Gmail's folder + Coverage's queue

**Files:** Create `src/lib/scheduledRows.ts`; Modify `src/app/followups/page.tsx` (Scheduled view + count), `scripts/check-followups.mts`.

**Interfaces:**
- Consumes: `offSheet.scheduled` items `{at,to[],subject,labels[],threadId}`.
- Produces: `ScheduledRow = { key: string; at: string; to: string; subject?: string; contact?: Contact; via: "gmail" | "coverage"; step?: number; stop?: boolean }`; `scheduledRows(items, contacts, now = Date.now()): ScheduledRow[]` sorted by `at`. Gmail items: one row per item (first matching recipient by email/alias, `contact` undefined when none); Coverage: one row per `c.serverSend` with future `sendAt` unless a Gmail row for that contact is within ±2 min; past items dropped; `stop` = `STOP_LABEL` on labels.

- [ ] Step 1: tests: two Gmail items to one person → 2 rows; alias match; untracked address → row with no contact; past item dropped; serverSend at same minute as a Gmail item → 1 row; serverSend alone → `via:"coverage"`.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: run → PASS.
- [ ] Step 5: Scheduled view renders `scheduledRows` (contact rows keep ScheduledRow actions; untracked rows show address + "Not in tracker"); count = rows.length.
- [ ] Step 6: check the owner's real data in Chrome (their Coverage tab → Cold outreach → Scheduled vs Gmail's Scheduled folder count); note the cause in the commit message. Commit.

### Task 4: Overview data

**Files:** Create `src/lib/followupsOverview.ts`; Modify `src/components/Shell.tsx` (badge uses `coldDueCount`), `scripts/check-followups.mts`.

**Interfaces:**
- `coldDueCount(contacts, banks, fu): number` (moved from Shell).
- `ColdBankRow = { key: string; bank: string; due: number; drafted: number; scheduled: number; cold: number; total: number }`; `coldByBank(contacts, banks, fu, scheduled: ScheduledRow[], now?): { rows: ColdBankRow[]; totals: Omit<ColdBankRow,"key"|"bank"> }` — `due` = follow_up/move_on isDue && !stale (same as Shell), `cold` = stale, `drafted` = kind send && isDue, `scheduled` = scheduled rows per contact bank; `canonBank` key; rows sorted by total desc.
- `WarmPerson = { c: Contact; how: string; lastAt?: string; owed?: TodoKind }`; `warmByBank(contacts, now?): { key: string; bank: string; people: WarmPerson[] }[]` — warm = `isEngaged(c)`; `how` from logged chat / call / referral / reply dates ("Chat 10/14", "Replied 10/2", "Referred you"); `lastAt` = latest of lastFromYou / lastHeardAt; `owed` = `todoFor(c, now)?.kind`; people oldest `lastAt` first; banks by most people owed then name.
- `CalDay = { green: Contact[]; red: Contact[] }`; `calendarDays(contacts, monthStart: Date, now?): Map<string /*YYYY-MM-DD local*/, CalDay>` — green: each email date of yours (sentAt, lastTouchAt, lastEmailedAt, followUpLog) for contacts not replied since that date and not moved on; red: `lastHeardAt` day for contacts where `todoFor` kind is `reply` (not resolved/handled).

- [ ] Step 1: tests: totals.due === coldDueCount for a mixed fixture; a replied contact isn't green on its old email day; a `reply` todo is red on lastHeardAt's day; handledAt after → not red; warmByBank puts an engaged person under canonical bank with `owed`.
- [ ] Step 2: FAIL → implement → PASS. Commit.

### Task 5: Calendar + overview tabs (UI)

**Files:** Create `src/components/FollowupCalendar.tsx`, `src/components/ColdOverview.tsx`, `src/components/WarmOverview.tsx`; Modify `src/app/followups/page.tsx` (tabs Overview · Queue; remove By banker / By bank; Replied + Referrals removed from the queue; Not in tracker / Needs new contact → notices opening a Modal), `src/app/think/page.tsx` (Overview tab first; Referrals tab added from `ReferralsTable`; reply rows ⋯ get "Reply with times" / "Send invite" from `components/Scheduling.tsx`).

**Interfaces:** `FollowupCalendar({ contacts }: { contacts: Contact[] })` — month grid (‹ ›), cells shaded `bg-green-soft`/`bg-red-soft` with counts, selected day → list of people (name → /person, bank, direction, PersonLinks, "No reply needed" on red = `updateContact(id,{handledAt: now})` + toast with Undo) and `dayLinks` buttons "Open this day in Gmail". ColdOverview = meta line + by-bank table (bank → /bank?key=, count cells link to `/followups?tab=queue&bank=`) with totals row + calendar. WarmOverview = filter "Not heard from in N+ days" (default 14), groups per bank, checkbox per person, "Draft check-ins (N)" (Task 7).

- [ ] Step 1: build; Queue reads `?bank=` to filter.
- [ ] Step 2: typecheck + lint + `npm run build`. Click-test on 127.0.0.1 `next start` demo data at 1280 and 390 px. Commit.

### Task 6: Hand-off list ("To schedule in Gmail")

**Files:** Modify `src/lib/types.ts` (`Contact.gmailSchedule?: { draftId: string; messageId: string; step: number; at: string; state: "waiting" | "scheduled" | "failed"; error?: string; updatedAt: string }`); Create `src/lib/handoff.ts`; Modify `src/lib/syncDocs.ts` only if contact fields are whitelisted, `src/lib/serverSyncBody.ts` (`handoff` array ≤ 200: `{contactId,name,email,subject,messageId,at,step}`), `src/app/api/server/sync/route.ts` (store `account.handoff` + `handoffAt`), `src/lib/server/accounts.ts` (Account type), `src/lib/serverSync.ts` (send waiting items), `src/lib/gmailScheduled.ts` (after reading, apply `confirmHandoff`), `src/lib/serverSync.ts#queueSends` (skip contacts with waiting gmailSchedule), `src/app/followups/page.tsx` (Gmail mode: "Draft & schedule" → draft + `planSends` slot → `gmailSchedule` waiting; Scheduled view lists waiting items under "To schedule in Gmail" with draft links, "Schedule N in Gmail" (Task 8) and "See them in Gmail" = `gmailSearchUrl("in:scheduled " + recipients)`).

**Interfaces:** `handoffItems(contacts): HandoffItem[]` (waiting only); `confirmHandoff(contacts, items, now?): {id; patch}[]` (±2 min → scheduled; scheduled whose Gmail item vanished and `at` still future → back to waiting).

- [ ] Step 1: tests: 1 min off → scheduled; 10 min off → stays waiting; contact with serverSend not in handoffItems; vanished → waiting.
- [ ] Step 2: FAIL → implement → PASS; `npm run check:sync` and `check:night` still pass. Commit.

### Task 7: Holiday check-ins from Warm overview

**Files:** Modify `src/lib/defaults.ts` (`HOLIDAY_TEMPLATE`, id `tpl_holiday`, kind `followup`-like non-starter, body: greeting, `[[AI: one warm line from your last conversation with {{first_name}}; skip if no notes]]`, wish for `{{holiday}}`, sign-off `Best,` + `{{my_first_name}}`), `src/lib/template.ts` (`{{holiday}}` placeholder = `settings.holiday ?? "Thanksgiving"`), `src/components/WarmOverview.tsx` ("Draft check-ins": per person fill → `withSignature` → `upsertDraft` in their thread → `gmailSchedule` waiting at the next send slot).

- [ ] Step 1: `check:outreach` renders tpl_holiday with a valid sign-off (add case). FAIL → implement → PASS. Commit.

### Task 8: Extension schedules in Gmail (A) + visible cursor

**Files:** Modify `src/lib/applyBridge.ts` (`sendCommand` type `"scheduleInGmail"`, payload `{ items: {id, to, subject, messageId, at}[] }`, result `{ results: {id, ok, error?}[] }`), `extension/content/dashboard.js` (pass through), `extension/background.js` (`scheduleInGmail(items)`: find/open `https://mail.google.com/mail/u/0/`, per item navigate to `#drafts?compose=<messageId>`, inject `sites/gmailSchedule.js`, run `scheduleDraft(item)`, 2 s gap, debugger attach for real input; `trustedClick` draws the cursor first), Create `extension/sites/gmailSchedule.js` (`SEL` block; checks To + subject; More send options → Schedule send → Pick date & time → date + time inputs → Schedule send; waits for "Send scheduled"; never clicks a control whose label is exactly "Send"), `extension/sites/apply.js` + `extension/agent/page.js` (dispatched-click fallback calls the same overlay), `scripts/pack-extension.mts` (strip gmailSchedule from the store build), extension `manifest.json` version + `SITE.extension.version` bump.

**Interfaces:** cursor = `drawCursor(x, y, click: boolean)` page function (injected via `cdp Runtime.evaluate`): fixed 18 px arrow SVG + 24 px ring pulse, `pointer-events:none`, `z-index:2147483647`, glides with a 350 ms CSS transition from its last spot, removed 4 s after the last action.

- [ ] Step 1: `npm run pack:extension -- --with-agent` passes, store build contains no gmailSchedule.
- [ ] Step 2: live check with the owner: one draft to the owner's own address, tomorrow 9:07 AM; cursor visible; appears in Gmail Scheduled; dashboard flips to "Confirmed in Gmail"; then cancel it. Commit.

### Task 9: Claude in Chrome (B): connector tools + plugin skill

**Files:** Modify `src/app/api/mcp/route.ts` (tools `emails_to_schedule` read-only: account.handoff with `sendAt` in the user's zone (`when`), `draftUrl`, `allScheduledUrl`; `confirm_scheduled`: runs the scheduled read (move the body of `api/server/scheduled/route.ts` into `lib/server/scheduled.ts#readScheduled(account)`), returns `{found: [...], missing: [...]}` by the ±2 min rule), Create `plugin/recruitify/skills/schedule-in-gmail/SKILL.md`, bump `plugin/recruitify/.claude-plugin/plugin.json` version, README line.

- [ ] Step 1: local JSON-RPC call of both tools on `next start` with dev login returns the shapes (or typecheck + a unit call if no server account locally). Commit.

### Task 10: 9 PM freshness + docs + ship

**Files:** Modify `src/components/NavBar.tsx#SyncButton` menu ("Update tonight's text" → `syncServer`), CLAUDE.md (new section), TODO.md.

- [ ] Step 1: owner's account in Chrome: Reminders → last sent / last text; Vercel logs if reachable; fix the cause found (if it's "no tab open that day", say so plainly and keep the 7–9 PM push).
- [ ] Step 2: all checks (`check:followups`, `check:accuracy`, `check:night`, `check:outreach`, `check:sync`, `check:selectors`, `check:contrast`), typecheck, lint, build. Commit, push, confirm Vercel deploy.
