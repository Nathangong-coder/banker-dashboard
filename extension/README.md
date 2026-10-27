# Coverage browser extension (Chrome + Edge)

One Manifest V3 extension that runs in both Chrome and Edge. Plain JavaScript, no build step: the files in this folder
are what the browser runs. Built one part at a time (owner, 2026-10-21):

1. **LinkedIn → Coverage** (done): on a profile or People search you're viewing, the toolbar button sends it to the
   dashboard. "Add to tracker + find email" (1.1) adds or updates them and looks up emails with no review step
   (`src/lib/autoCapture.ts`; a search adds only AI-screened matches at a known firm, never MD+ without a tie); "Just
   open…" goes to Coffee chat prep / Find people as before. The store version never browses LinkedIn by itself (the opt-in LinkedIn job search in part 4 is test-build only).
2. Granola → Coverage (next): send the note you have open (transcript + summary) to the Activity log, matched and graded.
3. **Application autofill** (done, 1.1): on any other page, "Autofill this page" fills the form from Applications → My
   info, uploads your resume and drafts open answers in your voice. It never submits. How it works:
   - `background.js` runs it: `sites/apply.js#scanForm` reads the form (activeTab, granted by the popup click) → the
     list goes to your open Coverage tab through `content/dashboard.js` (a content script on the dashboard's own pages
     ONLY) → `src/lib/applyBridge.ts` plans every value there (`src/lib/apply.ts#planFill`, rules from your info;
     open questions → `api/apply/answer`) → `fillForm` types them in and shows a review box.
   - Your application info never lives in the extension; the dashboard tab must be open (it's opened if not).
   - Guards: password / SSN / bank / card / DOB fields never filled (checked in the dashboard and again in the page);
     hidden, off-screen and clipped fields skipped; consent / certification boxes and salary left for you; sensitive
     answers (work authorization, EEO, address, contact) only by rule, never by the AI, which never sees them; the AI's
     answers must match a scanned question id and, for choices, one of its options (checked on the server and in the
     worker); a site that's neither a tracked job nor a known application system needs a second click; LinkedIn is
     refused; the page itself can't message the extension; a redirect while the AI writes aborts the fill.
   - 1.2: custom dropdowns (opened to read their choices, then closed) and typeahead boxes (type, wait for the
     suggestions, click the best match: exact > prefix > initials like UCLA > shared words) are filled. On Workday,
     after "Allow Coverage on myworkdayjobs.com" (optional host permission, one site at a time; Chrome usually closes
     the popup while asking, so click the icon again), "Fill the next pages too" presses Next by fixed rules
     (`clickNext`: forward words only, anything like submit / apply / sign / withdraw refused, Workday's own next
     button preferred) and stops at a required question it can't answer, at AI drafts, at an error the site shows,
     at the review page, or after 10 pages. Forms embedded from an allowed application site are scanned with
     `allFrames`; others get an "Open the form in its own tab" button.
   - LinkedIn job pages: "Track this job" (`captureLinkedInJob`, read-only) → `/applications#job=` → a tracked job with
     the description (for AI answers) and the employer's apply link when LinkedIn shows it.
   - Tested end to end in headless Edge with the unpacked extension against a mock form with traps (hidden fields,
     SSN, password, certification box, prompt-injection text): see the 2026-10-24 notes in CLAUDE.md.
4. **Fill selected, saved logins, LinkedIn job search** (1.3, owner 2026-10-24):
   - **Fill selected** (dashboard → Applications, tick jobs): the dashboard sends `fillJobs` through the bridge
     (`content/dashboard.js` relays only `fillJobs` / `focusJob` / `linkedinJobs`; `background.js#fromDashboard`
     checks the sender is the dashboard address in Options). Each job opens in a "Coverage" tab group
     (`tabGroups`), and `drive()` takes it from the job page (`startApplication`: Workday's Apply → Apply Manually by
     their `data-automation-id`s, Lever's /apply link) through sign-in to the form, fills it page by page
     (`continuePages` in batch mode: AI drafts don't stop it) and reports `fillStatus` back. It needs access to the
     site: Options → "Allow all application sites" (all of `APPLICATION_SITES` in one prompt). A tab waiting for you
     to sign in or create an account carries on by itself once the page isn't a login page (`tabs.onUpdated`).
   - **Watch it work** (default on): one tab at a time, in front of you; `fillForm` scrolls to each field, types it
     letter by letter and shows a banner with Stop (`data-coverage-stop`; Stop only stops Coverage).
   - **Saved logins** (`vault.js`, off by default, Options): AES-GCM with a PBKDF2-SHA-256 (600k) key from your
     PIN; the key lives in `chrome.storage.session` (memory only, not readable by content scripts). `loginFor`
     returns a login only for the exact origin; `signIn` re-checks the origin in the page, needs exactly one visible
     password box, and presses only Workday's sign-in button or a single "Sign in / Log in / Continue" button. It
     never goes to the dashboard, the AI or a server; it never creates accounts; Chrome's own passwords can't be read.
   - **LinkedIn job search** (test build only; Options section between `<!-- agent:start/end -->`, optional
     `https://www.linkedin.com/*` stripped from the store build): opens a Jobs search in your browser, reads the
     list (`readLinkedInJobs`), then each job page (`captureLinkedInJob`) 6-14 s apart, max 25 a run and 60 a day,
     stops at any sign-in / checkpoint page, and sends each to the dashboard's finds (`foundJob`). The owner
     accepted the account risk (LinkedIn's User Agreement forbids automated access, even from your own browser).

## How an extension "controls" a website

- **Popup** (`popup.html/js`): the panel that opens from the toolbar icon. It's a tiny web page that belongs to the extension.
- **Running code on a page**: `chrome.scripting.executeScript({ target: { tabId }, func })` injects a function into the tab
  and returns its result. That function can read the page (`document`), and it could click or type too. Here it only reads.
- **Permissions** (`manifest.json`) decide what that's allowed to do:
  - `activeTab`: access to the current tab only, and only after you click the extension. No access to other tabs or sites.
  - `scripting`: lets the popup inject the function above.
  - `storage`: saves the dashboard address (`settings.js`).
  - We avoid `host_permissions` (e.g. `https://*.linkedin.com/*`), which would let it run on those sites without a
    click. Broad host permissions mean a slower, stricter store review and a scarier install warning.
- **Content scripts** (not used yet) run on matching pages automatically, e.g. to add a button inside the page itself.
- **Handing data to the dashboard**: the popup opens `https://<dashboard>/prep#li=<data>`. The part after `#` never
  leaves the browser, so nothing passes through a server. The dashboard validates it (`src/lib/linkedinCapture.ts#parseCapture`).

## Try it locally (unpacked)

**Chrome:** `chrome://extensions` → turn on **Developer mode** (top right) → **Load unpacked** → pick this `extension` folder.
**Edge:** `edge://extensions` → turn on **Developer mode** (left) → **Load unpacked** → same folder.

Pin it (puzzle-piece icon → pin), open a LinkedIn profile, click the Coverage icon → **Send profile to Coverage**.
After editing any file, press the extension's reload ↻ on the extensions page (and reload the LinkedIn tab).
To point it at a local dev server: right-click the icon → **Options** → `http://localhost:3000`.

## Package it

```bash
npm run pack:extension                # store build → dist/coverage-extension-<version>.zip (no agent test bench)
npm run pack:extension -- --with-agent  # full build with the agent side panel → …-<version>-agent.zip (testing only)
```

The store build (owner, 2026-10-23) strips `agent/`, the `sidePanel` permission, the optional all-sites access and the
popup's agent button, so it asks only for `activeTab`, `scripting` and `storage`. The script fails if any of it is left.

Bump `"version"` in `manifest.json` before every store upload (the stores reject a version they've already seen).
`dist/` is git-ignored.

## Publish: Chrome Web Store

Listing: https://chromewebstore.google.com/detail/hjmfcaldipgcjffmcemcljllmlpjlnlp (item id `hjmfcaldipgcjffmcemcljllmlpjlnlp`,
in `src/lib/site.ts` → `SITE.extension.chromeUrl`).

### 1.3.2

Bug fixes only: (1) a resume upload hidden behind an "Attach" / "Upload resume" link (a file input with no label) was
reported as "Unlabelled field" and not filled; the scan now labels it from the text around it. (2) Workday sets
aria-hidden on the whole page while a popup is open, so the scan found "No form fields"; when that hides every field it
scans again without the aria check (size / position / clipping checks still keep traps out), and an empty scan now says
what it saw. No new permissions;
review answers same as 1.3.1. `npm run pack:extension` → `dist/coverage-extension-1.3.2.zip`.

### 1.3.1 (after 1.3.0 is approved)

Only change: saved logins sync through the user's Coverage account (the PIN-encrypted vault goes through the dashboard
tab, `syncVault` / `vault` bridge request). No new permissions. Review answers: same as 1.3.0, plus in **Data usage**
the authentication information line now reads "…encrypted with a PIN only the user knows; the encrypted copy is kept in
the user's own Coverage account so it follows them to their other browsers; neither the developer nor the server can
decrypt it". `npm run pack:extension` → `dist/coverage-extension-1.3.1.zip`.

### Updating the listing (1.3.0)

1. Deploy the dashboard first (Fill selected and Find jobs need the new dashboard code), then
   `npm run pack:extension` → `dist/coverage-extension-1.3.0.zip` (store build: no agent, no LinkedIn job search,
   no localhost). Developer Dashboard → the item → **Package** → Upload new package. If an older version is still in
   review, cancel that review first.
2. **Store listing**: replace the description with the one below.
3. **Privacy practices** (answers to paste):
   - **Single purpose:** "Coverage is a recruiting assistant for the user's own Coverage dashboard: it saves the
     LinkedIn profile, search or job the user is viewing to their dashboard, and fills job application forms from
     the information the user saved there, one at a time or several the user picked. The user reviews and submits
     every application."
   - **activeTab:** "Reads the current tab only after the user clicks the toolbar button: the LinkedIn page they're
     viewing, or the job application form they want filled."
   - **scripting:** "Runs the functions that read the page the user clicked on (or the application pages of jobs the
     user chose to fill), and type the user's saved answers into those forms. It never submits them."
   - **storage:** "Saves the user's dashboard address, the last autofill summary for a tab until the browser closes,
     and, only if the user turns it on, their application-site logins encrypted with a PIN they choose."
   - **tabGroups:** "Puts the application tabs opened by 'Fill selected' into one labelled tab group."
   - **Host permission (banker-dashboard-three.vercel.app):** "A content script on the extension's own web app only. It
     relays autofill requests and the user's 'Fill selected' command between the extension and the user's open
     dashboard tab, where their application information is stored. It runs on no other site."
   - **Optional host permissions (application sites):** "Requested only when the user clicks 'Allow' in the popup or
     settings: needed to fill a multi-page application (Workday) as its pages change, to fill several applications
     the user picked in background tabs, and to fill a form embedded from that application system on an employer's
     careers page."
   - **Remote code:** No.
   - **Data usage** (tick): Personally identifiable information (name, email, address, phone typed into forms),
     **Authentication information** (only the application-site logins the user saves, encrypted, used only on that
     site), Location (home address), Health information (only a disability-status answer, if the user saves one),
     Website content (the page / form the user clicks on). Certify: not sold, not used for unrelated purposes, not
     used for credit. The data goes only between the user's browser tab, their own dashboard, and the employer's form
     they fill; saved logins never leave the extension.
   - **Privacy policy:** `https://banker-dashboard-three.vercel.app/extension/privacy`.
4. **Submit for review.** Expect a closer look than 1.2 (authentication data, background filling). Existing users
   get a prompt to accept the tab-groups permission before 1.3 turns on.

### First publish (done for 1.0.0; kept for reference)

1. **Developer account**: https://chrome.google.com/webstore/devconsole, sign in with the Google account that will own it,
   pay the one-time registration fee and turn on 2-step verification.
2. **New item** → upload the zip. 3. **Store listing**: description, category Productivity → Workflow & Planning,
   screenshot (1280×800), the 128 px icon (in the zip) and a promo tile (440×280). 4. **Privacy practices** as above.
5. **Distribution**: Unlisted, Private or Public. 6. **Submit for review**; updates = bump the version, upload, submit.

## Publish: Microsoft Edge Add-ons

Edge can install straight from the Chrome Web Store (users click "Allow extensions from other stores"), so this step is optional.
To list it in Edge's own store:

1. Register at **Partner Center** (https://partner.microsoft.com/dashboard/microsoftedge), free.
2. **Create new extension** (or, once listed, **Update**) → upload the same zip.
3. Fill in availability, properties (category, privacy policy URL), store listing (description, screenshots, logo) and
   submit. Review typically takes up to about a week.

## Store description (paste-ready)

> Coverage is the recruiting assistant for your Coverage dashboard (built for investment banking networking).
>
> • On LinkedIn: one click adds the banker whose profile you're viewing to your tracker and looks up their email; on a
>   People search it adds the matches; on a job page it saves the job to your Applications.
> • On job applications: fills the form from the information you saved in Coverage (contact details, education, work
>   authorization, optional self-identification answers), uploads your resume, and drafts open questions in your own
>   voice from your writing samples. On Workday it picks from dropdowns and goes page by page.
> • Fill selected: pick several jobs on your dashboard and Coverage fills each one up to its review page in a tab
>   group, live in front of you if you like, with a Stop button.
> • Optional saved logins, encrypted with your PIN, sign you in to application accounts you already have.
>
> You stay in control: it never submits an application or presses Submit, never reads your browser's saved
> passwords, never fills SSNs or payment details, and sends nothing to any server of ours. Your information stays in
> your own dashboard, and saved logins never leave the extension.
