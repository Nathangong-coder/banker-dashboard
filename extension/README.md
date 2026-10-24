# Coverage browser extension (Chrome + Edge)

One Manifest V3 extension that runs in both Chrome and Edge. Plain JavaScript, no build step: the files in this folder
are what the browser runs. Built one part at a time (owner, 2026-10-21):

1. **LinkedIn → Coverage** (done): on a profile or People search you're viewing, the toolbar button sends it to the
   dashboard. "Add to tracker + find email" (1.1) adds or updates them and looks up emails with no review step
   (`src/lib/autoCapture.ts`; a search adds only AI-screened matches at a known firm, never MD+ without a tie); "Just
   open…" goes to Coffee chat prep / Find people as before. The extension never browses LinkedIn by itself.
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
   - Multi-page forms (Workday): click Autofill again on each page. Typeahead dropdowns (react-select / Workday) and
     forms inside another site's iframe are left for you (the popup links the iframe so you can open it directly).
   - Tested end to end in headless Edge with the unpacked extension against a mock form with traps (hidden fields,
     SSN, password, certification box, prompt-injection text): see the 2026-10-24 notes in CLAUDE.md.

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

1. **Developer account**: https://chrome.google.com/webstore/devconsole, sign in with the Google account that will own it,
   pay the one-time registration fee ($5 when this was written) and turn on 2-step verification.
2. **New item** → upload `dist/coverage-extension-<version>.zip`.
3. **Store listing**: description (below), category Productivity → Workflow & Planning, language, at least one
   screenshot (1280×800 or 640×400), the 128 px icon (already in the zip) and a small promo tile (440×280).
4. **Privacy practices** tab (the part reviewers read most closely):
   - Single purpose: "Sends the LinkedIn page you're viewing to your own Coverage dashboard for IB networking."
   - `activeTab`: "Reads the current LinkedIn page only when the user clicks the toolbar button."
   - `scripting`: "Injects the read-only function that collects the visible profile text from the current tab."
   - `storage`: "Saves the user's dashboard address."
   - Remote code: **No** (all code ships in the package).
   - Data usage: check **Website content**. It's used only for the extension's single purpose, not sold, not used for
     ads or credit. Tick the three certifications.
   - Privacy policy URL: `https://banker-dashboard-three.vercel.app/extension/privacy` (the extension's own policy;
     the main `/privacy` §7 links to it).
   - Homepage URL `…/extension`, support URL `…/extension/support` (Store listing tab).
7. **After approval:** paste the listing URL into `src/lib/site.ts` → `SITE.extension.chromeUrl`; the /extension page's
   buttons switch from "Install it now" (load unpacked) to "Add to Chrome".
5. **Distribution**: *Unlisted* (only people with the link can install it, good for you plus a few testers),
   *Private* (specific emails / a Google Group), or *Public*.
6. **Submit for review**. Small, narrow-permission extensions are usually reviewed in a few days. Updates: bump the version,
   upload the new zip, submit again.

## Publish: Microsoft Edge Add-ons

Edge can install straight from the Chrome Web Store (users click "Allow extensions from other stores"), so this step is optional.
To list it in Edge's own store:

1. Register at **Partner Center** (https://partner.microsoft.com/dashboard/microsoftedge), free.
2. **Create new extension** → upload the same zip.
3. Fill in availability, properties (category, privacy policy URL), store listing (description, screenshots, logo) and
   submit. Review typically takes up to about a week.

## Store description (paste-ready)

> Coverage helps students running investment banking networking outreach. On a LinkedIn profile or People search
> you're viewing, click the Coverage button to send it to your Coverage dashboard: add the banker to your tracker or
> open Coffee chat prep for them. The extension reads the page only when you click, never runs in the background,
> and sends nothing to any server: the text goes straight to your own dashboard in a new tab.
