# Accounts + login (step 1 of the roadmap)

Owner: Nathan · 2026-10-25 · Status: draft for approval

Roadmap order (owner): **login → mobile app design (incl. demo tutorial + simpler UI) → ship the phone app to the
Apple App Store and Google Play → recruiting orchestrator agent.** This document covers only the first item.

## Why

Coverage started as "everything lives in this browser" (Zustand persisted to IndexedDB, no accounts) and then grew
online pieces one at a time (automatic sending, the 9 PM text, phone captures, the Claude connector), each keyed to a
hidden random account the browser made (`settings.server = {id, token}`). The result is a half-local, half-online
state the owner dislikes. Concretely: the owner moved from Edge to Chrome and can't use Coverage in Chrome without
re-entering everything (Settings → Backup only exports contacts, templates, banks, prospects and part of settings, not
applications, coverage, info sessions, the workbook, resumes…). Every other user would hit the same wall the first
time they change computer.

The product direction the owner described: Coverage is the **peace of mind** layer (what's owed, what's due, which
banks you're behind on, which jobs / info sessions you're missing) that keeps watch when you aren't looking, which a
chat with Claude can't do. It will become a phone app. That needs the data to live in the user's account, not one
browser. Login is step 1.

## Goals

1. **Sign in with Google**, required for the real dashboard. Sign in on any browser / computer and everything is
   there: contacts, drafts, templates, applications + My info, coverage, info sessions, chats, firms, settings, API
   keys, the spreadsheet, resumes, signature logo.
2. **Signed out = demo.** A visitor who isn't signed in can explore a fake dashboard filled with made-up bankers,
   jobs and chats. Nothing they do is saved. Any real action (import a spreadsheet, draft / send, connect Google, find
   people, fill an application, run AI) opens a "Sign in to do this" prompt. Signing out returns you to the demo. Your
   real data never shows signed out, not even in the browser you last used. (The "Clippy" guided tutorial and the
   simplified UI belong to the mobile design step, not this one.)
3. **Connect Google in a few clicks, like Claude's connectors.** Nobody creates a Google Cloud project or pastes a
   Client ID: every user goes through the deployment's own Google client (as automatic sending already does).
4. **Moving existing data in (Edge → Chrome):** open Coverage in the old browser, sign in, and its local data is
   uploaded to the account, together with its existing server account (automatic sending, captures, Claude connector
   tokens). Nothing local is deleted until the user says so.
5. **Two tabs / two devices open at once:** the last save wins for that piece, and the other tab updates by itself.
6. **Extension:** keeps working with no setup (it already defaults to the deployed dashboard and talks to it through
   the open dashboard tab). Its saved logins sync through the account, encrypted with the user's PIN so the server
   can't read them. Chrome's "Allow application sites" prompt stays once per browser (Chrome's rule; owner accepted).
7. **The spreadsheet comes along:** the account keeps the latest workbook. On a new computer the user can Download it,
   or pick a local file once to keep saving straight into it (as today).

## Non-goals (this step)

- Email + password, magic links, GitHub or any other sign-in method (add later if users without Google show up).
- Coverage paying for AI / search for users. Users keep bringing their own Apollo / Hunter / Serper / Brave / AI keys;
  they just stop re-entering them. Hosted AI with a free monthly limit is a later decision.
- Google app verification (the 100-user cap + "unverified app" warning are fine for now, owner's call). Restricted
  Gmail scopes need a paid security assessment before verification; plan it once there are real users.
- The guided tutorial, the simplified "2 buttons, 3 jobs" UI, the phone app.
- Teams / sharing between users.
- Offline editing beyond what the local cache gives for free.

## Anti-goals (would make this a failure even if it "works")

- **Losing any of the owner's existing data** during the move (the Edge browser holds the only copy of most of it).
- A signed-out browser showing the last user's real data.
- API keys, Google tokens, or saved application passwords readable in logs, error messages, the browser bundle, or
  (for saved logins) by the server at all.
- Two open tabs silently undoing each other's edits on *different* contacts.
- A first screen that's Google's "unverified app / this app wants to read your email" warning before the user has
  seen anything (see "Two Google steps" below).
- Re-introducing the half-and-half state: after this ships, the browser is a cache of the account, never a second
  source of truth.

## Decided (by the owner)

- Sign in with Google only, for now ("simplest one just to test").
- Sign-in required; signed out = a fake demo dashboard ("lead you back to demo").
- Everything online; the account is the source of truth. The spreadsheet "comes along by getting re-downloaded".
- Extension and two-tabs behaviour as described in Goals 5–6.
- Chrome's per-browser site permission prompt is acceptable.
- Up to 100 users on the unverified Google app is acceptable for now.
- Keep bring-your-own keys for now (synced to the account).
- **One Google identity:** the owner signs in with and sends outreach from the same account, nagong1@ucla.edu (UCLA
  Google Workspace). UCLA already lets this Google client read mail (the browser Gmail sync works today), so no
  admin step is expected. Connect Google uses `login_hint` = the signed-in email; a different account on Google's
  screen is refused with a clear message (no separate sending identity in this step).
- **Vercel Blob:** the owner created a free-tier Blob store (2026-10-25). The builder confirms
  `BLOB_READ_WRITE_TOKEN` is on the banker-dashboard project (Production + Preview + Development).
- **Google Cloud:** the owner will add the sign-in redirect URIs (production + `http://127.0.0.1:<port>` for local
  testing) and the new scopes on the consent screen when the builder gives the exact values.

## My calls (owner hasn't weighed in; flagged so they can object)

- **Two Google steps.** "Sign in with Google" asks only for name + email (`openid email profile`, no warning
  screen). Right after, a **Connect Google** step asks for Gmail / Calendar / Docs on Google's checkbox screen. One
  extra click, but the first screen isn't a scary warning.
- **One Google connection for everything.** Today the browser uses separate Google Identity Services popups (Gmail
  each session, Calendar, Docs, gmail.modify) next to the server's refresh token. After this, Connect Google stores one
  refresh token on the server with the union of scopes, and the browser gets short-lived access tokens from a Coverage
  endpoint. No more per-session Gmail popup. The user's own Client ID setting goes away.
- **API keys** are stored on the server sealed with `SERVER_ENC_KEY` (AES-256-GCM, like the refresh token) and loaded
  into the signed-in browser, which keeps sending them as headers exactly as today. The server already receives every
  key with every request, so holding them sealed adds little risk.
- **Where data lives:** structured state in the existing Upstash Redis; large files (workbook, sheet snapshots if
  large, resumes, logo) in **Vercel Blob (private)**, which isn't provisioned yet. Keeps ~100 users on free / near-free
  plans.
- **Sign-out clears the local cache** in that browser (after making sure everything is uploaded), then shows the demo.
- **Same-browser tabs** update instantly (BroadcastChannel); **other devices** pick up changes on focus and by
  polling a cheap version number about every 30 s while visible. (Faster polling would burn Upstash's free command
  quota; "within seconds" holds for the common case of two tabs in one browser.)

- **Staged rollout, not one cutover** (the owner's only real copy is IndexedDB on the production origin, which no
  preview or 127.0.0.1 can see):
  1. ship the complete backup export (every slice + blobs) to production, and the owner downloads one;
  2. ship sign-in as optional ("Sign in to sync" banner), and rehearse the move by importing that backup into a
     throwaway account on 127.0.0.1, then do the real move in Edge;
  3. make sign-in required. Browsers that still hold un-uploaded local data get a "Sign in to keep your data"
     screen (never the demo over their data) until they upload or remove it.
- **Exactly one server account per user.** If the moved browser's `settings.server` account and an account the user
  already has both exist, merge into one (the one with Google connected / a live send queue wins; sends, inbox,
  track, captures, Twilio index and connector tokens are moved over, the other deleted). Every server route and the
  hourly tick see one account per user.
- **Merge granularity:** per contact; per manual cell patch (`patches` keyed by tab+cell) and per `sheetOps` entry;
  per application / job and per found job; per key for coverage maps (stages, ratings, added); per info session.
  Remaining slices (settings, templates, experiments…) are whole-piece last-write-wins.

## How it should work

### Identity and sessions

- New user record keyed by Google's `sub`: email, name, picture, createdAt, the linked server account id(s).
- Sign-in = Google authorization-code flow on the deployment's client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`),
  scopes `openid email profile`, new redirect URI (e.g. `/api/auth/google/callback`) that the owner must add in Google
  Cloud. Verify the ID token (issuer, audience, expiry, `email_verified`).
- Session = an HttpOnly, Secure, SameSite=Lax cookie holding a random token; only its hash is stored in Redis with
  the user id and an expiry (e.g. 30 days, sliding). Sign-out deletes it.
- **Every server route that today authenticates with `Authorization: Bearer id.token` (`authAccount`) also accepts
  the session** and resolves the user's linked account. The capture token (phone page), QStash-signed job routes,
  the Twilio webhook and the Claude connector's OAuth tokens keep their own auth. The connector's `/connect` approval
  page uses the signed-in user instead of the browser's `settings.server`.
- Rate-limit the sign-in routes like `server/google/start`.

### The account's data

- Everything the Zustand store persists today (the `partialize` output, all slices) plus the IndexedDB side keys
  (`blob:workbook`, `blob:snapshots`, `blob:resume`, `blob:logo`, `blob:appresume:<id>`, `infosessions:unsorted`).
- **Contacts are stored per contact** (one entry per contact id with its own updatedAt) so edits to different people
  in two tabs merge; other slices can be whole-slice last-write-wins. The builder may split further where it's cheap.
- Not synced (stays per browser, by design): the File System Access handle (re-pick the file once per computer),
  grid undo history, theme / board prefs / consent / nudge flags in localStorage (the builder may sync theme if
  trivial), session-only caches.
- Respect Vercel's 4.5 MB request/response cap: upload large files to Blob directly from the browser (client
  uploads with a server-issued token), and push state in pieces.
- The `settings.server` credentials become unnecessary once the session works; existing ones are kept only to link
  the old server account during the move.

### Local cache and sync

- Signed in: IndexedDB stays as a **cache of the account**, namespaced per user id, so the dashboard loads instantly
  and survives a flaky connection. On load: show the cache, fetch newer server versions, merge.
- Changes push to the server shortly after they happen (debounced, a few seconds), per changed piece. A pending-
  upload indicator / "All changes saved" state is visible somewhere unobtrusive. Leaving the page with unsaved
  changes warns.
- Conflict rule: last write wins per piece (per contact for contacts). The losing tab adopts the server version.
- Store migrations (`version: 10`, `migrateState`) keep working: data pulled from the server runs through the same
  migrate path.

### First sign-in on a browser that has local data (the move)

1. Detect existing un-namespaced local data (today's IndexedDB keys).
2. If the account is empty: upload everything (state + blobs), link the browser's existing `settings.server` account
   (proven by its Bearer credentials) to the user so automatic sending, the send queue, captures, the 9 PM text and
   connector tokens carry over unchanged.
3. If the account already has data (signed in elsewhere first): ask which to keep ("Use this browser's data" /
   "Use my account's data"), defaulting to the one with more contacts; never merge silently and never delete either
   side without a click. If the browser's server account differs from the user's, link both or keep the one with
   automatic sending connected (builder's call, but don't drop a live send queue).
4. The old local copy stays until the user clicks "Remove this browser's old copy" (shown after a successful upload).
5. A one-time **full backup download** is offered before the upload (a complete JSON + the workbook), since this
   browser may hold the only copy. Settings → Backup's export should become complete (every slice + blobs) too.

### Connect Google

- One "Connect Google" button (onboarding after first sign-in, Settings, and wherever today's code asks for a Gmail /
  Calendar / Docs popup). Authorization-code flow with offline access, `prompt=consent`, `login_hint` = the signed-in
  email, `include_granted_scopes=true`.
- Scopes = everything the server and browser use today: `gmail.compose`, `gmail.readonly`, `calendar.events` (covers
  reading + creating invites), `calendar.freebusy`, `documents.readonly`, `drive.metadata.readonly`, and
  `gmail.modify` only if the "⚠ VP+ check" label stays (builder may drop that feature's separate scope by asking for
  modify here, or keep it as an on-demand extra). Unticked boxes degrade as they do today (each feature checks its
  flag on `account.google`).
- New endpoint returns a short-lived Google access token for the signed-in user (from the stored refresh token).
  `gmail.ts`, `gcal.ts`, `gdocs.ts` get their token from it instead of GIS popups. Gmail-in-browser calls stay
  browser-side (no change to what they do), they just stop needing the popup.
- The Google account connected must match the signed-in email, or say clearly which one is connected.
- Owner's manual steps: add the new redirect URIs, add the new scopes to the OAuth consent screen, keep the app "In
  production".

### Demo (signed out)

- A fixed sample dataset (made-up names only, like the landing mocks) loaded into a non-persisting store; the normal
  pages render it. A top bar says "Demo · Sign in with Google to use your own".
- Server routes are never called in demo. Actions that would call a server, touch Gmail, import / save files, or
  change the extension get a "Sign in to do this" modal. Browsing, filtering, opening rows and harmless edits can
  work in memory and reset on reload.
- `/welcome`, `/privacy`, `/terms`, `/extension/*`, `/capture`, `/connect` (it will itself ask to sign in),
  `/agent-practice` stay public as today.

### Extension

- No sign-in of its own in this step: it already defaults to the deployed dashboard and works through the open
  dashboard tab (bridge), which is now signed in. If the dashboard tab is signed out, the bridge answers "not signed
  in" and the popup says "Sign in to Coverage first".
- Saved logins sync: the vault's encrypted blob (`{v, salt, iv, data}`) is sent through the bridge to the account and
  restored in another browser; the PIN never leaves the extension, the server stores only the ciphertext. Off unless
  the user turned saved logins on.

### Account management

- Settings: signed-in email, Sign out, "Download everything" (complete backup), **Delete my account** (deletes the
  user, sessions, all synced data and blobs, and the linked server account via the existing `deleteAccount`, and
  revokes the Google token).

### Privacy + legal (must ship with it)

- `/privacy`, `/terms`, `/extension/privacy` and the Settings page header ("Your data and API keys live in this
  browser…") describe the old model and must be rewritten: data is now stored on Coverage's servers (Upstash Redis,
  Vercel Blob), encrypted where noted, deletable; Google sign-in data; Google Limited Use statement still applies.
  Bump `SITE.legalUpdated`. Update CLAUDE.md's "All user data is client-side" and related notes.

## Constraints

- Next.js 16 App Router (read `node_modules/next/dist/docs/` before writing routes; `src/proxy.ts` is the
  middleware), React 19, Zustand v5 persisted store, AI SDK 7, zod on every route body, `errorResponse` for errors,
  `server-only` on server modules. Match existing UI primitives and tokens (no hardcoded colors).
- Never log or return secrets (`redact()` pattern). The Google client secret never reaches the browser.
- Vercel: 4.5 MB request/response cap; Hobby plan; Upstash free plan quotas (command count and size).
- The public GitHub repo: no secrets, no `.xlsx` / `.pdf` / `.env*` committed.
- Test on 127.0.0.1 with `next start`, never against the owner's localhost IndexedDB. The owner's real data is in
  their Edge browser on the deployed site; the move must be rehearsed on a copy first.
- Existing checks must keep passing (`typecheck`, `lint`, `build`, `check:*`), plus new checks for the sync merge
  rules and session auth.

## Left to the builder

- Session details (cookie name, lifetime, rotation), Redis key layout, Blob paths, how state is chunked.
- Exact polling interval and debounce, as long as the behaviour above holds and free-plan quotas aren't blown.
- How the demo dataset is built (reuse landing mock names) and which in-memory edits demo allows.
- Whether to use a library or hand-roll the OAuth (the repo hand-rolls Google OAuth and its own OAuth server today;
  hand-rolling keeps it consistent).
- Order of work, as long as the owner's Edge data is never at risk and nothing ships half-migrated.
