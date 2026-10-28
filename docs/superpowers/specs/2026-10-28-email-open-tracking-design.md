# Email open tracking (Mailsuite-style) — design

Owner request, 2026-10-27/28. Status: design, not built.

## Intent

The owner wants to see, for every email they send to bankers, **whether and when it was opened**, the way their friends
do with Mailsuite (formerly Mailtrack). The purpose is **visibility and better analytics** about how outreach is going,
not action today. Alerts ("opened 3×, you haven't followed up") may come later if they find themselves missing things.

What "success" looks like: open times show up on each contact, on Follow-ups rows, and as a new metric across the Email
lab, and the numbers are honest about what a pixel can and can't know.

## What a pixel can and can't tell (agreed with the owner)

- **Opens:** an invisible 1×1 image per message; the image request is the "open". Unreliable at banks in two directions:
  Outlook often blocks outside images until the reader clicks "download pictures" (real opens missed), and security
  gateways (Proofpoint, Mimecast, Microsoft Defender) and Apple Mail Privacy Protection fetch images at delivery
  (fake opens). So every number is "at least X%" and every hit gets a label (below).
- **Forwards:** never seen directly. Like Mailsuite, a **"possibly forwarded"** hint when the pixel loads again from a
  clearly different place / device after the first person open. A guess, labeled as one.
- **CC'd on a reply:** already reliable via existing reply tracking (`lib/replyTracking.ts` intros → Follow-ups →
  Referrals). Not part of this work.
- **Mentions of you in mail you're not on:** impossible for anyone. Not built.
- **Link-click tracking:** not built (owner's rule: no wrapped/redirect links in the signature; scanners would also
  "click" every link).

## Goals

1. Track every email the owner sends to people, from three paths:
   - **Coverage-built emails:** first emails, follow-ups, info-session thank-yous, scheduling replies (everything that
     goes through `gmail.ts#buildMime` / `upsertDraft`, including server sends via `run-send`, which send the draft as is).
   - **Emails sent from Gmail's own compose window** (hand-written replies, quick thank-yous, drafts made by Claude
     workflows that the owner opens and sends): the Coverage extension adds the pixel inside Gmail, Mailsuite-style.
   - **Claude workflows that send directly** (never through Gmail's compose): a helper in the Recruitify plugin / Coverage
     connector that hands Claude a tracked pixel snippet to include before sending. (See "Open questions for the builder".)
2. Per open record: time (shown in the owner's zone and the recipient's), client kind (Outlook / Gmail / Apple Mail /
   other; phone vs desktop when the user agent says), rough location (city/country from Vercel's `x-vercel-ip-*`
   headers), and a **label**: `person` · `scanner` · `apple-privacy` · `you`.
3. Show it:
   - **Contact:** "Opened 3× · first Tue 9:14 AM ET" with the open history (per message: first email, follow-up #1 …).
   - **Follow-ups rows** (Due / Scheduled / Replied): an opened / not opened badge for the latest email.
   - **Gmail Sent folder** (extension): ✓ sent / ✓✓ opened next to tracked messages, hover = open history, like Mailsuite.
   - **Email lab:** open rate as a metric next to reply rate in every existing breakdown (`segments.ts#crossTab`
     dimensions: subject/template, hook, wording, time, day, font, experiment arms; segments: bank type, team, location),
     plus "time to first open".
   - **"When bankers read" chart:** person opens by hour × weekday in the recipient's zone.
   - **Per firm:** share of tracked emails ever seen opened, so a firm that blocks images reads as "unknown", not "ignored".
   - Bankers not in the tracker (off-sheet recipients) still get counted and appear under Follow-ups → "Not in tracker".
   - **New page "Email tracking" (`/tracking`, Outreach group in `Shell.tsx#GROUPS`)** — owner, 2026-10-28: "see
     everything holistically and check emails … open emails directly from my site". The one place for all of it:
     - Standard page pattern: PageHeader → Kpi tiles (tracked emails sent, opened ≥ once (at least X%), replied, median time
       to first open, possibly forwarded) → one table Card.
     - Table = **one row per tracked email** (not per person): recipient (contact link, or "not in tracker"), firm, which
       email (first / follow-up #n / thank-you / reply / sent from Gmail), subject, sent at, ✓ / ✓✓, opens (person count),
       first and last open, latest client + city, possibly-forwarded flag, replied. Toolbar: Segmented (All · Opened ·
       Not opened · Replied · Possibly forwarded), search, firm filter, date range, "include scanner / you hits" toggle.
     - Click a row → side panel (same pattern as Info sessions' `InfoSessionDetail`): the **email itself read from Gmail**
       (the sent message and the rest of the thread, rendered as text/safe HTML; via the browser's Gmail read token or the
       server's `gmail.readonly` connection, whichever is available), the full open timeline with labels, and
       **"Open in Gmail"** (deep link to the thread). My reading of "open emails directly from my site" is: read it here,
       with a one-click jump to Gmail for replying.
     - The lab charts (open rate by dimension, "when bankers read", per-firm visibility) live on this page as a second
       view (`/tracking?view=insights`), with open rate also added as a metric in the Email lab's existing results.
4. **Opt-in switch**, off by default: Settings → Email → Sending → "Track opens". Off = no pixel in new emails (already-sent
   ones keep reporting; that's fine). Privacy page updated (`/privacy` + `SITE.legalUpdated`; data flows: open time,
   client, approximate location of the recipient, stored in the owner's account).

## Non-goals / anti-goals

- No alerts or WhatsApp lines in this version (the 9 PM text stays as is). Leave room for them.
- No link tracking, no attachment (resume) open tracking.
- No per-email "don't track" switch and no storage-limiting setting in v1 (later, see Answers).
- **Never count the owner's own views** as opens (the whole value is lost if you see "opened" because you looked at your
  Sent folder).
- Don't present a missing open as "didn't read it".
- Don't blow the usage budget (CLAUDE.md "Usage budget": the free Upstash plan ran out once). A pixel hit must cost a
  small, fixed number of Redis commands, and the dashboard picks opens up in its existing sync, not a new poller.
- Nothing about this goes into the **public store build** of the extension yet (below).

## Decided (by the owner)

- Build our own version of what Mailsuite does (features, not code).
- Gmail-compose tracking ships **only in the owner's test build** (`npm run pack:extension -- --with-agent`) for now.
  It needs access to mail.google.com, which today's store build deliberately doesn't ask for. **Later it should go into
  the public store build**, so build it the store-friendly way: Gmail as an *optional* host permission requested from
  Options, the content script registered at runtime (`chrome.scripting.registerContentScripts`) once granted, and
  `pack-extension` stripping both from the store build (and failing if they remain), like the LinkedIn / Handshake readers.
- A careful banker or a privacy extension may notice the pixel and its Coverage address. The owner accepts that.
- Opt-in switch is fine.

## How it works (decided by me; the builder may refine)

### Pixel ids and the endpoint

- URL: `https://<site>/api/o/<id>.gif` (short, no word "track"). Response: a 1×1 transparent GIF, `Cache-Control:
  no-store, private`, always 200 even for unknown ids (never reveal anything), exempt from the per-IP rate limiter (a
  scanner burst must not 429, but cap writes per id, e.g. ≤ 50 hits kept per message).
- `id` must be makeable **offline** by the extension at compose time without a server round trip, and unforgeable:
  `<accountId>.<random>.<mac>` where `mac` = truncated HMAC of `<random>` with a per-account **pixel key** (random,
  stored sealed on the account like the capture token; the dashboard hands it to the extension over the existing bridge
  and the extension keeps it in `chrome.storage`). The server verifies the mac before writing anything.
- On a verified hit: one Redis write appending `{at, ua-class, city, country, ipHash, via}` to `opens:<accountId>`
  (capped, TTL ~30 days until acked), nothing else. Classification happens in a pure lib, not at hit time, except what
  only the request has (UA, `x-vercel-ip-*`, IP → keep only a hash + whether it's in a known scanner/Apple/Google range).

### Registering what each pixel belongs to

- **Coverage-built:** `buildMime` gets an optional `pixel` URL and appends the `<img>` at the end of the HTML part (never
  in text/plain). The draft records `pixelId` (on `contact.draft` / `followUpDraft` / the info-session and scheduling
  drafts), so opens map straight to contact + step.
- **Gmail compose (extension):** when a compose / reply box opens, the content script inserts the `<img>` with a fresh id;
  on Send / Schedule send it reports `{pixelId, to, cc, subject, at}` to the dashboard via the bridge when a dashboard tab
  is open, else queues it in `chrome.storage` until one is. **Source of truth = Gmail itself:** the dashboard's Gmail sync
  (and the server's `gmailTrack` where it reads sent mail) finds pixel ids in sent messages and maps id → recipients →
  contact by the same address/alias rules the tracker already uses. The extension's report is only the fast path.
  Unsent drafts just leave unused ids.
- **Claude direct sends:** the Coverage connector / plugin gets a `tracked_pixel` tool that returns an `<img>` snippet with a
  new id. Whether Claude's Gmail send path accepts HTML bodies is unverified (see questions); if it doesn't, those sends are
  untracked and the docs say so.

### Labels (pure, `lib/opens.ts`, `npm run check:opens`)

- `you`:
  - In Gmail web with the extension: the content script removes / blocks the pixel in messages the owner is viewing
    (Gmail serves it through `googleusercontent.com/...#<original url>`), so these never fire.
  - Phone Gmail app / other browsers: a hit via Google's image proxy (`GoogleImageProxy` UA) when the recipient's domain
    is **not** on Google mail (MX lookup per domain, cached) is the owner, not the banker. Recipients on Gmail /
    Workspace keep proxy hits as `person` (can't tell; noted in the UI).
- `scanner`: within ~60 s of the send, from known security-gateway / Microsoft / cloud ranges, or several hits in the same
  second.
- `apple-privacy`: Apple's proxy ranges / UA. Shown, not counted as a person open.
- `person`: everything else. Only `person` opens count toward open rate, "first opened", and the reading-time chart.
- **Possibly forwarded:** a `person` open after the first one from a different country / far-away city or a different
  client family (e.g., Outlook desktop → Gmail web), not explainable as the same person's phone. Flag, never a status.

### Dashboard side

- Opens come back in the existing sync response (`/api/server/sync`, or `/api/sync/pull` if cleaner) and are acked,
  like inbox items / tracked replies. Stored on the contact (`contact.opens: { pixelId, step, at, label, client, city,
  forwarded? }[]`, capped) so they sync across browsers through the existing `c:` docs; opens for unknown recipients go
  to `state.offSheet`.
- Lab: open rate = messages with ≥1 `person` open ÷ tracked messages sent, Wilson range like reply rate, same 30-per-arm
  verdict guard. Only messages sent with tracking on count in the denominator.

## Constraints

- Next 16 / React 19 / Vercel Hobby; Upstash free plan (budget above); `server-only` routes; never log keys or ids'
  secrets; privacy page updated in the same change.
- Extension and dashboard ship together: bump `SITE.extension.version` with the extension.
- Matching the owner's existing conventions: tokens not hex colors, Badge pills, pure logic + `check:*` script.

## Answers after the builder check (owner, 2026-10-28)

- **Gmail compose tracks every email sent**, Mailsuite-style (friends, professors, recruiters included), so the pixel can
  go in when the compose box opens. No per-email "don't track" switch in v1. **Later:** a setting that limits what's
  stored (e.g. keep only opens for tracker contacts / bankers, drop the rest) "to improve processes"; leave room for it
  (opens for non-contacts are kept separately so they can be filtered or dropped wholesale).
- **Every Coverage user can turn it on (opt-in)**, not only the owner. So:
  - Turning it on creates the user's server account (`settings.server`) if there isn't one yet; no Google connection is
    needed for Coverage-built emails (the pixel needs only the server account and the pixel key).
  - Privacy page covers it for all users: what's recorded about recipients (open time, mail client, approximate city /
    country, a hashed IP), that it's stored in the user's account, retention, and that turning it off stops new pixels.
  - Usage budget is per account: cap hits stored per message and opens stored per account per day; scanner bursts are
    collapsed into one stored hit. Pixel hits skip the rate limiter but must never cost more than a couple of Redis
    commands, and unknown / bad-mac ids cost zero writes.
  - The extension part (Gmail compose, ✓ / ✓✓ marks) is still the owner's test build only until it moves to the store build.

## Calls I made (owner can overrule)

- **✓ / ✓✓ in Gmail's Sent list** get their data over the existing dashboard bridge (a Coverage tab open), cached in
  `chrome.storage` so the last-known marks show without the tab. The extension gets no server credential of its own and
  does no polling.
- **Owner's own views from devices without the extension** (phone Gmail app) when the recipient is also on Google mail
  can't be told apart from the recipient's; accepted as a caveat shown in the UI. Outlook-hosted recipients (most banks)
  are handled by the MX rule.
- "Open emails directly from my site" = read the email and its thread in `/tracking`'s side panel, plus "Open in Gmail".
- Opens come back through the existing sync and are acked; the pixel is stripped when `/tracking` renders a sent email.

## Left to the builder

- Exact scanner / Apple / Google IP ranges and how they're kept up to date.
- How Gmail's compose DOM is found and how Send / Schedule send is detected (Gmail changes its DOM; key on stable
  attributes, re-check on the live site in the owner's Chrome).
- Where the open history UI sits on the contact and in Gmail's Sent list.
- Retention and caps.

## Still open

- Whether Claude's Gmail send path (Gmail connector `send_message`) accepts an HTML body with an `<img>`. If not, Claude direct sends stay untracked and the docs say so; drafts Claude makes and the owner sends from Gmail are tracked by the extension either way.
