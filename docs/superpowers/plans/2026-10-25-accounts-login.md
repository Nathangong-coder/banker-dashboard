# Accounts + login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign in with Google; the account (server) becomes the source of truth for all dashboard data, the browser a
per-user cache; signed out = demo; old browser data moves in safely.

**Architecture:** Sessions are an HttpOnly cookie → `sess:<sha>` in Upstash Redis. The persisted Zustand state is cut
into small JSON "docs" (`lib/syncDocs.ts`, pure) and stored sealed (AES-256-GCM) per user in a Redis hash with a
change log (sorted set by revision), so pulls are "docs changed since rev N". Large files (workbook, snapshots,
resumes, logo) go through `api/sync/blob` in ≤3 MB parts, stored in Vercel Blob (private), falling back to Redis
when `BLOB_READ_WRITE_TOKEN` isn't set (local tests). `settings.server` ({id, token}) syncs like any other setting,
so automatic sending / captures / connector keep their Bearer auth unchanged. Browser Google calls get access tokens
from the server's refresh token (`api/server/google/token`) instead of GIS popups when connected.

**Tech Stack:** Next.js 16 route handlers, Zustand v5 persist (`skipHydration`, per-user `name`), idb-keyval,
@upstash/redis, @vercel/blob 2.8.2, zod, Node crypto.

**Spec:** `docs/superpowers/specs/2026-10-25-accounts-login-design.md`

## Global Constraints

- Sign in with Google only; scopes for sign-in `openid email profile`; Connect Google is a separate step.
- Required sign-in only when `NEXT_PUBLIC_SIGNIN_REQUIRED=1` (stage 3). Before that, a browser with old local data
  keeps working signed out with a "Sign in to sync" banner (stage 2). A browser without local data → demo.
- One server account per user; merge on conflict (Google-connected / live queue wins).
- Never log or return secrets; every doc is sealed at rest with `SERVER_ENC_KEY`.
- Vercel 4.5 MB request/response cap → pushes ≤ ~500 KB of raw JSON per request, blob parts ≤ 3 MB.
- Polling ≈ 30 s while visible + on focus; BroadcastChannel for tabs in one browser; push debounce ≈ 3 s.
- Old local data is never deleted without a click; a full backup download is offered before the move.
- Owner's manual steps (tell them): redirect URIs `/api/auth/google/callback` (prod + `http://127.0.0.1:<port>`),
  scopes `calendar.events` + `calendar.freebusy` on the consent screen, `BLOB_READ_WRITE_TOKEN` on the project.

## Review Focus

- Signing out in a browser that still has un-pushed edits → push first, refuse sign-out if offline (no silent loss).
- Pull while a doc is being edited locally (dirty) → local wins until pushed; never flicker back.
- A deleted contact / job in tab A → tombstone reaches tab B (doesn't resurrect on B's next push).
- Huge first upload (owner: ~200 contacts with profiles, multi-MB snapshots) → chunked, resumable on failure.
- Demo mode calling a server route or Gmail → "Sign in to do this", never a real request.

---

### Task 1: Doc mapping (pure) + check script

**Files:** Create `src/lib/syncDocs.ts`, `scripts/check-sync.mts`; Modify `package.json` (`check:sync`).

**Interfaces — Produces:**
- `type Docs = Record<string, unknown>`
- `toDocs(state: Record<string, unknown>): Docs` — keys: `c:<contactId>`, `b:<bankKey>`, `p:<sheet>\u0000<addr>`,
  `aj:<jobId>`, `af:<foundKey>`, `is:<sessionId>`, `cov:<field>` (and `cov:<field>:<k>` for `COVERAGE_MAPS`),
  `apply` (apply minus jobs/finder.found), `s:<topLevelField>` for the rest. `snapshots`/`gridUndo` excluded.
- `fromDocs(docs: Docs): Record<string, unknown>` — exact inverse (arrays keep a stable order by `order` field
  stored in the doc: `{ i, v }` for array collections).
- `serialize(docs: Docs): Record<string, string>` (stable JSON per doc) and
  `diffDocs(prev: Record<string,string>, next: Record<string,string>): { changed: Record<string,string>; removed: string[] }`.
- Tests (`check:sync`): round trip of a realistic state is deep-equal; editing one contact changes exactly one doc;
  removing a job yields exactly one `removed`; patches on two cells of two tabs are two docs; undefined fields don't
  create diffs.

### Task 2: Server users, sessions, sign-in routes

**Files:** Create `src/lib/server/users.ts`, `src/lib/server/googleSignIn.ts`, routes `src/app/api/auth/google/start`,
`.../callback`, `api/auth/me`, `api/auth/signout`, `api/auth/link`, `api/auth/delete`, `api/auth/dev` (dev only);
Modify `src/proxy.ts` (signup limiter for `/api/auth/google/start`, exempt callback).

**Interfaces — Produces:**
- `interface User { id; email; name?; picture?; createdAt; accountId?; oldAccounts?: string[] }`
- `currentUser(req): Promise<User | null>`, `requireUser(req): Promise<User>` (401 "Sign in first."), both reject a
  cross-site `Origin` on non-GET.
- `createSession(uid) → Set-Cookie value`, `endSession(req)`.
- `api/auth/me` → `{ user: {id,email,name,picture} | null }`; `api/auth/link` (session + Bearer) → links /
  merges server accounts (`mergeAccounts(keep, drop)` in accounts.ts).
- Dev login: only when `NODE_ENV !== "production"` and `COVERAGE_DEV_LOGIN=1`; 404 otherwise.

### Task 3: Sealed doc store + blob parts

**Files:** Create `src/lib/server/userData.ts`, routes `api/sync/push`, `api/sync/pull`, `api/sync/blob`, `api/sync/status`.

**Interfaces — Produces:**
- `pushDocs(uid, changed: Record<string,string>, removed: string[]): Promise<number /*rev*/>`
- `pullDocs(uid, since: number): Promise<{ rev; docs: Record<string,string>; removed: string[] }>` (since=0 → all)
- `dataStatus(uid) → { rev; docs: number; contacts: number }`
- Blob: `PUT /api/sync/blob?name=<n>&part=<i>&parts=<n>` body = bytes; `GET ?name&part`; `DELETE ?name`. Names
  limited to `workbook|snapshots|resume|logo|appresume:<id>`. Meta doc `blobmeta` (`{[name]: {parts, size, type, at}}`)
  rides in the doc store.
- `deleteUserData(uid)`.

### Task 4: Browser Google tokens from the server connection

**Files:** Modify `src/lib/server/google.ts` (scopes + `scopes` stored), callback, create `api/server/google/token`;
Create `src/lib/googleToken.ts`; Modify `gmail.ts`, `gcal.ts`, `gdocs.ts` (try server token first).

**Interfaces:** `setServerGoogleToken(fn: (scopes: string[]) => Promise<string | null>)`; `serverGoogleToken(scopes)`.

### Task 5: Per-user local cache + sync engine + session store

**Files:** Modify `src/lib/store.ts` (`skipHydration`, `useLocalNamespace(ns)`, blob key prefix, `onBlobChange`),
Create `src/lib/session.ts`, `src/lib/sync.ts`.

**Interfaces:** `useSession` ({status, user, mode: "loading"|"account"|"legacy"|"demo"}); `startSync(uid)`,
`stopSync()`, `flushSync(): Promise<boolean>`, `useSyncStatus` ({pending, lastSyncedAt, error}); `hasLegacyData()`.

### Task 6: Shell gating, demo, move flow, account UI

**Files:** Create `src/lib/demo.ts`, `src/components/SignIn.tsx`, `src/components/MoveData.tsx`,
`src/components/AccountMenu.tsx`; Modify `Shell.tsx`, `api.ts` (demo guard), `serverSync.ts` (demo guard),
`settings/page.tsx` (Account card, complete backup).

### Task 7: Extension saved-logins sync

**Files:** Modify `extension/content/dashboard.js`, `extension/background.js`, `extension/vault.js`,
`src/lib/applyBridge.ts`, `src/lib/apply.ts` (`ApplyState.vault?`).

### Task 8: Privacy, terms, CLAUDE.md, verification

Rewrite data-handling sections, bump `SITE.legalUpdated`; typecheck, lint, build, all `check:*`; e2e on 127.0.0.1
with dev login: move flow, two tabs, demo guard, sign out.
