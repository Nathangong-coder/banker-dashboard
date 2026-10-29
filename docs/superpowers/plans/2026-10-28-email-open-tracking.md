# Email Open Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mailsuite-style open tracking: a per-message pixel in every email Coverage builds and (test build) every email sent from Gmail, open hits labeled person / scanner / apple-privacy / you, shown on a new `/tracking` page, on contacts, Follow-ups rows, the Email lab and Gmail's Sent list.

**Architecture:** Pixel ids are `<accountId>.<rand>.<mac>` where the mac uses a per-account key the server *derives* from `SERVER_ENC_KEY` (no Redis read to verify). The dashboard and extension get that key once and mint ids offline. `GET /api/o/<id>.gif` verifies and appends one raw hit to `opens:<acct>` in Redis. The existing `/api/server/sync` call returns and acks the hits. Everything else (labels, "you" detection, forwarded hint, rates) is a pure function of raw hits + the dashboard's registry of tracked messages + "self-seen" events, so it can be recomputed and unit-checked.

**Tech Stack:** Next 16 App Router routes, Upstash Redis, Zustand store + account sync docs, Chrome MV3 (plain JS, no build), WebCrypto HMAC, `tsx` check scripts.

**Spec:** `docs/superpowers/specs/2026-10-28-email-open-tracking-design.md`

## Global Constraints

- Opt-in, off by default: `settings.tracking.on` (undefined = off). Off = no new pixels; hits for old ones still record.
- Pixel URL: `${SITE.url}/api/o/<id>.gif`, 1×1 transparent GIF, `Cache-Control: no-store, private`, always 200, never a body that differs for bad ids.
- A bad / unverifiable id costs **zero** Redis commands; a good one at most 3 (RPUSH + LTRIM + EXPIRE in one pipeline). `/api/o/` is exempt from the rate limiter in `src/proxy.ts`.
- Redis: `opens:<acct>` list, capped 2000 entries, TTL 30 days, until acked by the dashboard's sync.
- Never store a raw IP: store `ipHash` = first 16 hex of sha256(`acct` + ip) and a coarse `net` class.
- Only `person` opens count toward open rate, first-open time and the reading-time chart. Open rate is shown as "at least X%".
- Gmail-compose tracking and the Gmail content script exist **only in the test build** (`npm run pack:extension -- --with-agent`). `pack-extension` strips them from the store build and **fails** if any remain. Built the store-ready way: `https://mail.google.com/*` as an optional host permission, the script registered at runtime with `chrome.scripting.registerContentScripts`.
- Extension rules (chrome-extensions skill): MV3 only, async/await (no `.then` chains in new code), no state in service-worker globals (use `chrome.storage`), `chrome.permissions.request` straight from the click with no `await` before it, `return true` for async `onMessage` replies, batch DOM writes in `requestAnimationFrame`.
- Rendering a sent email in `/tracking` uses the Sanitizer API (`el.setHTML(html, { sanitizer })`) with a DOMPurify fallback loaded only when `setHTML` is missing (modern-web-guidance `sanitize-untrusted-html`). Pixel `<img>`s are removed before rendering, so viewing in Coverage never fires one.
- Privacy page updated (`/privacy`, `/extension/privacy`) and `SITE.legalUpdated` bumped in the same change.
- Extension version and `SITE.extension.version` bump together (to the next minor after whatever the parallel extension session ships; coordinate at merge).
- UI: theme tokens only, PageHeader → Kpi row → one table Card, Badge pills, no `window.alert`.
- Zustand selectors never return fresh objects/arrays (`check:selectors`).

## Review Focus

1. **Owner views their own email** (Gmail web with extension, Coverage draft opened in Gmail before Schedule send, phone Gmail app). Expect: labeled `you`, never counted. Tests in Task 2 (`self-seen window`, `before sentAt`, `proxy + non-Google MX`).
2. **Security scanner burst at delivery** (3 hits within 2 s, 20 s after send). Expect: one `scanner` entry, no open. Test in Task 2.
3. **Same pixel, many hits over days** (the banker re-reads on phone). Expect: one person, opens count up, *not* "possibly forwarded" when only the client changes Outlook desktop ↔ Outlook iOS in the same country. Test in Task 2.
4. **Forged / truncated / other-account ids hitting `/api/o/`.** Expect: GIF returned, nothing written. Test in Task 1 (`verify rejects`) + Task 3 manual curl.
5. **Gmail compose edge cases**: reply inside a thread, forward, Schedule send, Send via Ctrl+Enter, a compose closed without sending. Expect: exactly one pixel per sent message, none left in discarded drafts' reports. Verified in Task 7's live check list.

---

### Task 1: Pixel ids (pure, shared by server, dashboard and extension)

**Files:**
- Create: `src/lib/pixel.ts`
- Create: `extension/pixel.js` (ESM twin, same algorithm; the extension has no build step)
- Create: `scripts/check-opens.mts`, add `"check:opens": "tsx scripts/check-opens.mts"` to `package.json`

**Interfaces:**
- Produces:
  - `pixelKeyFor(serverSecret: string, accountId: string): Promise<string>`: base64url HMAC-SHA256(secret, `"pixel:" + accountId`). Server only.
  - `mintPixelId(accountId: string, key: string): Promise<string>` → `<accountId>.<rand 12 base64url>.<mac 11 base64url>`, mac = HMAC-SHA256(key, `accountId + "." + rand`) truncated.
  - `verifyPixelId(id: string, keyFor: (acct: string) => Promise<string>): Promise<{ accountId: string } | null>`: constant-time compare.
  - `pixelUrl(base: string, id: string): string` → `${base}/api/o/${id}.gif`.
  - `PIXEL_PATH_RE = /\/api\/o\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{11})\.gif/`, also used to find pixels inside HTML and Gmail proxy URLs (`…#https://…/api/o/…`).
  - `extension/pixel.js` exports `mintPixelId`, `pixelUrl`, `PIXEL_PATH_RE` with identical behavior (WebCrypto `crypto.subtle`).

- [ ] **Step 1: Write failing checks in `scripts/check-opens.mts`** (same `check(what, ok, detail)` helper style as `scripts/check-tracking.mts`):
  - `mint → verify round trip` returns `{ accountId }`.
  - `verify rejects`: changed last char, other account's key, missing parts, 500-char garbage → all `null`.
  - `extension twin agrees`: `import("../extension/pixel.js")` mints an id that `verifyPixelId` (TS) accepts, and both `PIXEL_PATH_RE` match `https://ci3.googleusercontent.com/meips/AbC=s0-d-e1-ft#https://x.app/api/o/<id>.gif`.
- [ ] **Step 2:** `npm run check:opens` → FAIL (module missing).
- [ ] **Step 3:** Implement both files with WebCrypto only (works in Node 22, browsers and the extension worker).
- [ ] **Step 4:** `npm run check:opens` → all `ok`.
- [ ] **Step 5:** Commit `feat(tracking): pixel ids`.

### Task 2: Open classification and stats (pure)

**Files:**
- Create: `src/lib/opens.ts`
- Modify: `scripts/check-opens.mts`

**Interfaces:**
- Consumes: Task 1 `PIXEL_PATH_RE`.
- Produces:
  ```ts
  type Net = "apple" | "google-proxy" | "microsoft" | "scanner" | "other";
  interface RawHit { id: string; at: string; ua: string; city?: string; country?: string; ipHash: string; net: Net }
  type HitLabel = "person" | "scanner" | "apple-privacy" | "you";
  type TrackedKind = "first" | "follow-up" | "thank-you" | "reply" | "gmail";
  interface TrackedMessage { id: string; to: string[]; subject: string; kind: TrackedKind; step?: number; contactId?: string;
    createdAt: string; sentAt?: string; gmailDraftId?: string; threadId?: string; source: "coverage" | "gmail" | "claude";
    hits: RawHit[]; seen: string[] /* ISO times the owner had it on screen */ }
  netOf(ip: string, ua: string): Net                       // used by the route at hit time
  clientOf(ua: string): { family: "outlook" | "gmail" | "apple-mail" | "other"; device: "phone" | "desktop" | "unknown" }
  labelHits(m: TrackedMessage, mx: Record<string, "google" | "other">): { hit: RawHit; label: HitLabel }[]
  openSummary(m, mx): { opens: number; firstAt?: string; lastAt?: string; forwarded: boolean; lastClient?: string; lastCity?: string }
  openRate(ms: TrackedMessage[], mx): { sent: number; opened: number; low: number; high: number }  // Wilson 95%, reuse lab's helper if exported
  readingHeatmap(ms, mx, tzOf: (m: TrackedMessage) => string): number[][]  // [weekday 0-6][hour 0-23], person opens only
  ```
- Rules (from the spec; exact values):
  - `you`: hit within ±120 s of any `seen` time; or hit before `sentAt` (or before `createdAt` + 0 when `sentAt` unknown and the hit is from the same `ipHash` as a `seen`-window hit); or `net === "google-proxy"` and **every** recipient domain has `mx[domain] === "other"`.
  - `scanner`: `net` is `microsoft` / `scanner`, or the hit is within 60 s after `sentAt`, or ≥2 hits within the same 2 s (the whole burst becomes one `scanner` entry).
  - `apple-privacy`: `net === "apple"`.
  - `person`: everything else.
  - Possibly forwarded: a `person` hit after the first `person` hit whose `country` differs, or whose `city` differs **and** whose client family differs. Same family on phone vs desktop never counts.
  - IP ranges for `netOf`: Apple `17.0.0.0/8`; Google proxy = UA contains `GoogleImageProxy`; Microsoft = UA/headers from Exchange Online / known `40.92–40.107.x` + `52.100–52.103.x` mail ranges; scanner = Proofpoint (`148.163.128.0/19`, `67.231.144.0/20`), Mimecast (`205.139.110.0/24`, `207.211.30.0/24`, `170.10.128.0/21`), plus UA with no browser token (e.g. `python-requests`, `Java/`, empty). Keep the table in one `const NETS` with a `// reviewed 2026-10` stamp.

- [ ] **Step 1: Failing checks** (all with fixed ISO times):
  - `self-seen window`: hit 30 s after a `seen` time → `you`.
  - `before sentAt`: hit 5 min before `sentAt` (Coverage draft opened in Gmail to schedule) → `you`.
  - `proxy + non-Google MX`: `google-proxy` hit, `to: ["a@gs.com"]`, `mx: {"gs.com":"other"}` → `you`; same with `mx: {"startup.com":"google"}` → `person`.
  - `scanner burst`: 3 hits 20 s after `sentAt` within 2 s → `openSummary.opens === 0` and one `scanner` label.
  - `apple`: `17.58.1.2` → `netOf === "apple"` → not counted.
  - `re-reads are one person`: Outlook desktop NY Tue + Outlook iOS NY Wed → `opens === 2`, `forwarded === false`.
  - `forward hint`: Outlook NY then Gmail web London → `forwarded === true`.
  - `open rate`: 10 messages, 3 opened → `{ sent: 10, opened: 3 }`, `low < 0.3 < high`.
  - `heatmap`: one person open Tue 09:14 America/New_York → `heat[2][9] === 1`.
- [ ] **Step 2:** `npm run check:opens` → the new checks FAIL.
- [ ] **Step 3:** Implement `src/lib/opens.ts`.
- [ ] **Step 4:** `npm run check:opens` → all `ok`.
- [ ] **Step 5:** Commit `feat(tracking): classify opens`.

### Task 3: Server: pixel endpoint, key, MX lookup, opens in sync

**Files:**
- Create: `src/app/api/o/[file]/route.ts` (GET)
- Create: `src/app/api/server/pixel/route.ts` (POST, `authAccount`): `{ key, base }`; with `{ domains: string[] ≤ 50 }` also returns `mx: Record<domain, "google"|"other">` via `node:dns/promises` `resolveMx` (Google = any exchange ending `google.com` / `googlemail.com`), 3 s timeout each, failures → `"other"`.
- Modify: `src/proxy.ts`: `/api/o/` skips the limiter.
- Modify: `src/app/api/server/sync/route.ts`: body gets `opensAck: z.array(z.string().max(80)).max(2000).default([])` (the `id|at` pairs already stored); response gets `opens: RawHit[]` (≤ 500 per call, oldest first, `moreOpens: boolean`).
- Create (in `lib/server/accounts.ts` or new `lib/server/opens.ts`): `OPENS(acct)`, `pushHit`, `readHits`, `ackHits`.

**Interfaces:**
- Consumes: Task 1 `verifyPixelId`, `pixelKeyFor`; Task 2 `netOf`, `RawHit`.
- Produces: `POST /api/server/pixel` → `{ key: string; base: string; mx?: Record<string, "google" | "other"> }`; sync response `opens`, `moreOpens`.

- [ ] **Step 1:** Implement the GIF route: parse `[file]` (`<id>.gif`), `verifyPixelId(id, acct => pixelKeyFor(process.env.SERVER_ENC_KEY!, acct))`. On success, build a `RawHit` (`city`/`country` from `x-vercel-ip-city` (URI-decoded) / `x-vercel-ip-country`, `ua` ≤ 300 chars, `ipHash`, `net`) and pipeline RPUSH/LTRIM(-2000)/EXPIRE(30 d). `export const dynamic = "force-dynamic"`. The 43-byte GIF is a module constant.
- [ ] **Step 2:** Implement `api/server/pixel` and the sync additions. Ack removal = rewrite the list without acked entries (LRANGE once + DEL + RPUSH remaining), done only when `opensAck` is non-empty.
- [ ] **Step 3:** Verify on 127.0.0.1 with `next start` (as in CLAUDE.md, never localhost) and a throwaway account: `curl -s -o NUL -w "%{http_code} %{content_type}" http://127.0.0.1:3000/api/o/bad.gif` → `200 image/gif`, and no `opens:*` key created; a minted id → one entry; sync returns it; ack removes it. Then delete the throwaway account.
- [ ] **Step 4:** `npm run typecheck && npm run lint`.
- [ ] **Step 5:** Commit `feat(tracking): pixel endpoint and sync`.

### Task 4: Dashboard state, setting, and pixels in Coverage-built emails

**Files:**
- Modify: `src/lib/types.ts`: `Settings.tracking?: { on?: boolean }`; `State.tracking: { key?: string; base?: string; messages: TrackedMessage[]; mx: Record<string, "google" | "other"> }`.
- Modify: `src/lib/store.ts`: default `tracking: { messages: [], mx: {} }`, migration bump, actions `registerTracked(m)`, `addHits(hits)`, `addSeen(id, at)`, `setTrackingKey(key, base)`.
- Modify: `src/lib/syncDocs.ts`: `tracking.messages` as a LIST (prefix `tm:`, id `id`), so each message is its own doc. Extend `scripts/check-sync.mts` with a round trip containing two tracked messages.
- Modify: `src/lib/gmail.ts`: `DraftInput.pixel?: string` (URL); `buildMime` appends `<img src="…" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` as the last child of the HTML body (never text/plain).
- Create: `src/lib/trackingActions.ts`: `pixelFor(input: { to: string; subject: string; kind: TrackedKind; step?: number; contactId?: string; gmailDraftId?: string }): Promise<string | undefined>`. Returns `undefined` when tracking is off. Otherwise it fetches and caches the key (`/api/server/pixel` via `serverSync.ts#serverCall`, creating the server account if needed), **reuses** the id already registered for the same `gmailDraftId`, else mints and registers one. Returns the URL.
- Modify the five `upsertDraft` call sites (`app/drafts/page.tsx` ×2, `app/followups/page.tsx`, `components/InfoSessionActions.tsx`, `components/Scheduling.tsx`) to pass `pixel: await pixelFor(…)`, then record the returned `gmailDraftId` on the registry entry.
- Modify: `src/lib/serverSync.ts`: send `opensAck`, apply `opens` via `addHits`, loop while `moreOpens`. After a Gmail sync, set `sentAt` / `threadId` on registry entries whose contact's `sentAt` / `lastEmailedAt` / `followUpLog` shows the matching step went out after `createdAt`. Ask `/api/server/pixel` for MX of new recipient domains (≤ 50 per call, cached in `tracking.mx`).
- Modify: `src/app/settings/page.tsx` (Email → Sending): "Track opens" switch with one muted line: "Adds an invisible image to emails Coverage makes, so you can see when they're opened. Banks often block images, so missing opens mean unknown."

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `pixelFor`, store actions above, `state.tracking`.

- [ ] **Step 1:** Add to `scripts/check-sync.mts` a failing round trip for `tracking.messages` (two docs `tm:<id>`, edit one → one changed doc). Run `npm run check:sync` → FAIL.
- [ ] **Step 2:** Implement types, store, syncDocs. `npm run check:sync` → PASS.
- [ ] **Step 3:** Add a check in `check-opens.mts`: `buildMime({…, pixel})` has exactly one `/api/o/` in the decoded HTML part and none in text/plain. Run → FAIL, implement, → PASS.
- [ ] **Step 4:** Implement `trackingActions.ts`, the call sites, serverSync, and the Settings switch. `npm run typecheck && npm run lint && npm run check:selectors`.
- [ ] **Step 5:** Commit `feat(tracking): pixels in Coverage emails`.

### Task 5: `/tracking` page, contact + Follow-ups badges, lab metric

**Files:**
- Create: `src/app/tracking/layout.tsx` (metadata like the other client routes), `src/app/tracking/page.tsx`
- Create: `src/components/TrackingDetail.tsx` (side panel, same pattern as `InfoSessionDetail`)
- Create: `src/components/SafeEmailHtml.tsx`: `setHTML` with sanitizer config `{ elements: ["p","div","br","span","b","strong","i","em","u","a","ul","ol","li","blockquote","table","tbody","tr","td","th"], attributes: ["href"], replaceWithChildrenElements: ["font","center"] }`, DOMPurify fallback (`npm i dompurify`, dynamic import) with `ALLOWED_TAGS` = same + `#text`, `ALLOWED_ATTR: ["href"]`, `ALLOW_ARIA_ATTR: false`, `ALLOW_DATA_ATTR: false`, `KEEP_CONTENT: false`. Strip `img` entirely (so no pixel ever fires). Links get `target="_blank" rel="noopener noreferrer"` after insertion.
- Modify: `src/lib/gmail.ts`: `threadMessages(clientId, threadId): Promise<{ id: string; from: string; to: string; at: string; subject: string; html?: string; text: string }[]>` (format=full, `partText`, `stripQuoted` on text). Plus `gmailThreadUrl(threadId)` → `https://mail.google.com/mail/u/0/#all/<threadId>`.
- Modify: `src/components/Shell.tsx` `GROUPS` Outreach: `{ href: "/tracking", label: "Email tracking", icon: MailCheck }` after Email drafts.
- Modify: `src/components/ContactsTable.tsx` (or the contact detail it opens) + `src/components/FollowupsUi.tsx` rows: `Badge` "Opened 3× · Tue 9:14 AM ET" / "Not opened yet" (only when the latest email is tracked).
- Modify: `src/lib/segments.ts` / `src/components/LabResults.tsx`: an "Open rate" column beside reply rate in `crossTab` output, using tracked messages only.

**Interfaces:**
- Consumes: Task 2 `labelHits`, `openSummary`, `openRate`, `readingHeatmap`, `clientOf`; Task 4 `state.tracking`.

- [ ] **Step 1:** Page per the spec: Kpi tiles (Tracked sent · Opened ≥ once "at least X%" · Replied · Median time to first open · Possibly forwarded). Table, one row per `TrackedMessage`: recipient (contact link, else "Not in tracker"), firm, kind, subject, sent, ✓ / ✓✓, opens, first / last open (their zone + yours on hover), last client + city, forwarded flag, replied. Toolbar: Segmented All · Opened · Not opened · Replied · Possibly forwarded; search; firm filter; date range; "Show scanner / your own views" toggle. `?view=insights` = open rate by template / hook / send hour / day / firm, the heatmap (day × hour, `chart` tokens), firms with 0 opens out of ≥ 3 tracked ("probably blocks images").
- [ ] **Step 2:** Detail panel: thread via `threadMessages` (browser Gmail token; if none, a "Connect Gmail to read it here" button + "Open in Gmail"), `SafeEmailHtml` for HTML else `<pre class="whitespace-pre-wrap">`, open timeline with label Badges, "Open in Gmail".
- [ ] **Step 3:** Badges + lab column. `npm run typecheck && npm run lint && npm run check:selectors && npm run build`.
- [ ] **Step 4:** Click-test on 127.0.0.1 (`next start`, dev login, seeded tracked messages through the store in devtools): page renders, filters change counts, panel opens, no pixel request in the Network tab while viewing a message, no horizontal scroll at 390 px.
- [ ] **Step 5:** Commit `feat(tracking): Email tracking page`.

### Task 6: Extension bridge for tracking

**Files:**
- Modify: `extension/content/dashboard.js`: add `"pixelKey"`, `"pixelSent"`, `"pixelSeen"`, `"pixelStatus"` to `ALLOWED`.
- Modify: `src/lib/applyBridge.ts` `HANDLERS`:
  - `pixelKey()` → `{ key, base, accountId } | null` (null when tracking is off).
  - `pixelSent(p)` → `registerTracked({ id, to, subject, kind: "gmail", source: "gmail", createdAt: at, sentAt: scheduledFor ?? at, threadId? })`; validates `PIXEL_PATH_RE`-shaped id and ≤ 20 recipients.
  - `pixelSeen(p)` → `addSeen(id, at)` for each `{ id, at }` (≤ 200).
  - `pixelStatus(p: { ids: string[] ≤ 500 })` → `Record<id, { opens: number; lastAt?: string; forwarded: boolean }>`.
- Modify: `extension/background.js`: a small `tracking` section (kept in **new file `extension/tracking.js`** imported by background.js to stay clear of the parallel session's edits):
  - `syncPixelKey()` on each dashboard hello (`vaultSync` path): `askDashboard("pixelKey")` → `chrome.storage.local.set({ pixel })` (or remove when null).
  - Outbox: `pixelOutbox` (sent) and `pixelSeenOutbox` arrays in `chrome.storage.local` (≤ 500 each), flushed by `askDashboard` when a dashboard tab answers; flushed on hello and after each push.
  - Message handlers for the Gmail content script: `{ type: "pixelMint" }` → `{ url, id }` (or `{ off: true }`), `pixelSent`, `pixelSeen`, `pixelStatus` (answers from cache `pixelMarks` refreshed via the dashboard when reachable).

**Interfaces:**
- Consumes: Task 1 `extension/pixel.js`; Task 4 store actions.
- Produces: runtime messages `pixelMint`, `pixelSent {id,to,subject,at,scheduledFor?}`, `pixelSeen {items:[{id,at}]}`, `pixelStatus {ids}` → used by Task 7.

- [ ] **Step 1:** Implement. Every `onMessage` branch with async work returns `true`; no worker globals hold state.
- [ ] **Step 2:** `npm run check:agent` (still passes), `npm run typecheck && npm run lint`.
- [ ] **Step 3:** Commit `feat(extension): tracking bridge`.

### Task 7: Gmail content script (test build)

**Files:**
- Create: `extension/sites/gmail.js` (content script, isolated world)
- Modify: `extension/manifest.json`: `"https://mail.google.com/*"` in `optional_host_permissions`.
- Modify: `extension/options.html` + `extension/options.js`: section between `<!-- gmail:start -->` / `<!-- gmail:end -->` with switch `#gmOn` "Track opens of emails I send from Gmail", using the existing `siteToggle` pattern (request from the click), plus a status line. On grant, ask the worker to register the script.
- Modify: `extension/tracking.js`: `ensureGmailScript()`: if `chrome.permissions.contains({ origins: ["https://mail.google.com/*"] })` and flag `gmailTrack === true`, then `chrome.scripting.registerContentScripts([{ id: "gmail-track", matches: ["https://mail.google.com/*"], js: ["sites/gmail.js"], runAt: "document_idle", persistAcrossSessions: true }])` if not already registered (`getRegisteredContentScripts`); otherwise unregister. Called on `runtime.onInstalled`, `runtime.onStartup`, `permissions.onAdded/onRemoved`, and the Options message.
- Modify: `scripts/pack-extension.mjs`: store build removes `https://mail.google.com/*`, `sites/gmail.js`, and the `gmail:start/end` block; the check fails if any remain; `--with-agent` allows them.

**Behavior of `sites/gmail.js`:**
- Send: a capture-phase `click` listener on the document for the compose Send button (`[role=button][data-tooltip^="Send"]`, plus the "Schedule send" menu item) and `keydown` Ctrl/Cmd+Enter inside a compose body. Synchronously before Gmail handles it: if the body has no pixel, insert one (`pixelMint` was requested when the compose opened and kept on the compose element, so no await is needed at send). Read To/Cc/Bcc from the compose's recipient chips (`[data-hovercard-id]` / `span[email]`) and the subject from `input[name="subjectbox"]`, then post `pixelSent`. Record an immediate `pixelSeen` (the compose itself loads the image).
- Pre-mint: a `MutationObserver` on `document.body` finds new compose bodies (`div[contenteditable="true"][role="textbox"]` inside a compose dialog / inline reply) and fetches a minted id for each. Batch DOM work in `requestAnimationFrame`.
- Self-views: the observer also scans added nodes for `img` whose `src` matches `PIXEL_PATH_RE` (direct or Gmail proxy `#` fragment) and posts `pixelSeen {id, at: now}` (debounced 2 s, deduped per id per minute).
- Sent list marks: on `#sent` / `#scheduled` views, for rows with a known id (the worker keeps `subject+recipient → id` from `pixelSent`), add a small ✓ / ✓✓ span with `title` = "Opened 3× · last Tue 9:14 AM". Restyle-proof: inline styles only, inserted inside the row's subject cell, removed and redrawn on route change.
- Selectors live in one `const SEL = {…}` at the top of the file with a `// checked on live Gmail 2026-10-xx` comment.

- [ ] **Step 1:** Implement manifest, options, tracking.js registration, pack-extension changes. `npm run pack:extension` (store) → passes and lists no Gmail permission; `npm run pack:extension -- --with-agent` → includes it.
- [ ] **Step 2:** Implement `sites/gmail.js`.
- [ ] **Step 3: Live check in the owner's Chrome** (unpacked test build, Options → switch on; send only to the owner's own second address). Each line must hold:
  - New email → sent message source has exactly one `/api/o/` image; `/tracking` lists it as "sent from Gmail".
  - Reply in a thread and a forward → one pixel each.
  - Schedule send → registered with `sentAt` = the scheduled time.
  - Compose closed without sending → nothing registered.
  - Opening the message in Sent → `pixelSeen` arrives; the hit is labeled `you`.
  - Opening it from the second account on a phone → `person`, ✓✓ appears in Sent after the next dashboard sync.
- [ ] **Step 4:** Commit `feat(extension): track Gmail sends (test build)`.

### Task 8: Privacy, docs, version

**Files:**
- Modify: `src/app/privacy/page.tsx` and `src/app/extension/privacy/page.tsx` (section on open tracking: what's recorded about recipients (open time, mail client, approximate city / country, a hashed IP), kept in your account until synced and then in your Coverage data, 30-day server TTL, off by default, turning off stops new pixels; extension test build reads Gmail compose / message pages only to add and spot the tracking image), `src/lib/site.ts` (`legalUpdated`, `extension.version`).
- Modify: `extension/manifest.json` version, `extension/README.md` (test-build Gmail tracking, how to turn on), `CLAUDE.md` (a short "Email open tracking" section in the existing style), `CHROMEWEBSTORE.md` if present: note the future store justification for `mail.google.com` ("adds a tracking image to emails you send and shows open marks in your Sent folder; reads compose and Sent pages only").

- [ ] **Step 1:** Write the changes.
- [ ] **Step 2:** `npm run build && npm run typecheck && npm run lint && npm run check:opens && npm run check:sync && npm run check:selectors && npm run check:agent`.
- [ ] **Step 3:** Commit `docs(tracking): privacy, README, version`.

---

## Notes for execution

- **Work in a git worktree** (`superpowers:using-git-worktrees`): another session is editing `extension/*`, `src/lib/applyBridge.ts` and `src/lib/site.ts` right now with uncommitted changes. New extension logic goes in new files (`extension/pixel.js`, `extension/tracking.js`, `extension/sites/gmail.js`). Edits to shared files (background.js import + hello hook, dashboard.js `ALLOWED`, applyBridge `HANDLERS`, manifest, options, pack-extension, site.ts) are kept to a few lines, so the merge is small. Bump the version only at merge time.
- Not covered by this plan (spec "Still open"): a `tracked_pixel` tool for Claude direct sends. Add it after checking whether the Gmail connector's `send_message` accepts HTML.
