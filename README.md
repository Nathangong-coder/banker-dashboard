# Coverage: IB networking desk

A dashboard that handles the repetitive parts of investment banking recruiting:

1. **Enrich contact info.** Upload your recruiting .xlsx, view it as a spreadsheet, and fill in blank emails from each person's LinkedIn URL and name (Apollo, with Hunter as a fallback). Write the results back into the same file.
2. **Find people.** Google-search public LinkedIn profiles for each bank (via Serper). AI screens each profile against your criteria: Tech IB or NY Generalist, not Healthcare, UC grad or from Washington State, and based in CA or NY. Add matches to the right bank tab.
3. **Email drafts.** Select contacts, auto-assign templates (AI or keyword rules), have AI fill the personal `[[AI: …]]` lines, and create Gmail drafts with your resume attached.
4. **Bank coverage.** Every bank you could recruit at, sorted into *reached out*, *have contacts but haven't emailed*, and *cold* (no contacts yet), with a progress bar, this week's email count, and one-click next steps ("Draft emails", "Find people").
5. **Follow-ups.** Track each banker and each bank, split by SF and NY. Sync Sent mail and replies from Gmail, draft in-thread follow-ups, and get reminders by browser notification, phone push (ntfy), SMS (Twilio), or calendar (.ics).

## How data is handled

Everyone brings their own keys. Contacts, templates, your resume, and the uploaded workbook are stored in the browser (IndexedDB). The `/api/*` routes forward each request to Apollo, Serper, Anthropic, or Twilio with the caller's key and store nothing. Gmail calls go straight from the browser to Google. Several people can use one deployment without seeing each other's data.

Trade-off: data lives in a single browser. Use **Settings → Export backup** to move it to another machine.

## Which keys you need

Everything is set in **Settings & keys** in the app. Each service shows *connected* or *not set*, what it's for, and a link to get the key. The sidebar counts the four core services, and each feature tells you when a key it needs is missing.

- **Every key is tested live before it's saved.** Model lists and account endpoints are free to call. The one exception is Serper, which spends 1 search on the test. A bad key shows the provider's error and isn't stored.
- **Several keys per service.** Keys are tried top to bottom. If one is invalid, rate-limited or out of credits, the next is used automatically. Use the ↑ button to set the primary.
- **Any AI provider:** Anthropic (Claude), OpenAI, Google Gemini, DeepSeek, GLM (Z.ai, or mainland `open.bigmodel.cn`), any OpenAI-compatible API, or a Vercel AI Gateway key. The model list comes from your key, and a model is switched to only after it answers a test prompt.

| Service | Needed for | Cost |
|---|---|---|
| **Apollo** (or Hunter) | Enrich contact info: finds missing emails | Apollo free plan includes some credits · Hunter 25 free/month |
| **Serper** | Find people: Google search of LinkedIn profiles | 2,500 free searches |
| **AI**: Claude, GPT, Gemini, DeepSeek, GLM… | AI screening, auto-assigning templates, writing personalized lines, organizing imported templates | Pay per use, usually cents per batch (Gemini has a free tier) |
| **Google OAuth Client ID** (no secret needed) | Creating Gmail drafts and syncing sent mail and replies | Free |
| ntfy topic · WhatsApp (CallMeBot) · Twilio | Phone reminders (all optional) | ntfy and CallMeBot free · Twilio paid |

Without keys you can still upload your sheet, view and edit it, track statuses and follow-ups, fill templates (placeholders only, no AI), open drafts in your mail app, and export follow-ups to your calendar.

## Reminders: text, push and WhatsApp

Follow-ups are due 7 days after your last email (Follow-up #1, then #2). After 2 follow-ups plus 7 more days, the app suggests moving on. All of these numbers are in Settings. The **Follow-ups → Reminders & alerts** tab groups everything due into one message per day at 9am.

| Channel | Free? | Can schedule ahead? | Setup |
|---|---|---|---|
| Calendar (.ics) | ✅ | ✅ any date | Download, open, and add to Google or Apple Calendar |
| ntfy push | ✅ | ✅ up to 3 days | Install the app and subscribe to a topic |
| WhatsApp via CallMeBot | ✅ (personal use) | ❌ send-now only | Message the bot once to get a key |
| Browser notification | ✅ | ❌ only while the dashboard is open | Click Enable |
| Twilio SMS | ❌ ~$1/mo number + ~1¢/text | ✅ 15 min – 35 days | See below |

**Free and zero-effort:** download the .ics now and then, and your phone calendar handles the alerts. Add ntfy if you want real push notifications.

### ntfy (free push)
1. Install **ntfy** (iOS or Android) and tap **+** to subscribe to a long random topic, e.g. `coverage-yourname-8x2kq7`. Anyone who guesses the topic can read it.
2. Paste the same topic into Settings, then go to Follow-ups → Reminders → **Send test**.
3. **Schedule next 3 days** queues the 9am digests. Press it again every few days.

### WhatsApp (free, CallMeBot)
1. Save **+34 694 23 41 84** as a contact and WhatsApp it: `I allow callmebot to send me messages`.
2. It replies with an API key within about 2 minutes. If nothing arrives, try again after 24h.
3. Put your WhatsApp number (with country code, e.g. `+14255550123`) and the key into Settings, then click **WhatsApp me today's list**.

This only messages *your own* number and can't schedule, so for now it's an on-demand "what's due today" ping. An automatic 9am ping is planned; see [TODO.md](TODO.md).

### Twilio SMS (paid, schedulable)
1. Sign up at [twilio.com](https://www.twilio.com). A trial account can text only your own verified number, which is all this needs.
2. **Phone Numbers → Buy a number** with SMS capability.
3. **Messaging → Services → Create Messaging Service** and add that number as a sender. Copy the service ID (`MG…`). Scheduled texts need it.
4. From the console home page, copy the **Account SID** and **Auth Token**.
5. In Settings, fill in Account SID, Auth token, From number (or the `MG…` ID), and your own phone number.
6. **Text me today's list** sends right away. **Schedule upcoming** queues daily texts up to 35 days out.

For US numbers, Twilio may require **A2P 10DLC registration** (a short form, a few days) before texts deliver reliably. Toll-free numbers need toll-free verification instead.

### Why not fully automatic daily texts?
All data lives in your browser, so the server doesn't know who's due, and a server cron job has nothing to send. Scheduling ahead (ntfy, Twilio, calendar) covers this. Real server-side daily sends need a small database plus a Vercel Cron job. That's planned; see [TODO.md](TODO.md).

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000
npm run check:workbook -- "your file.xlsx"   # verify the parser against a real workbook
npm run check:templates -- "templates.docx"  # preview how a templates doc will be imported
```

## Deploy to Vercel

Easiest: push to GitHub, then at vercel.com/new import the repo. Every push to `main` deploys to production, and other branches get preview URLs.

Or from the CLI:

```bash
npm i -g vercel
vercel        # first deploy, links the project
vercel --prod
```

No environment variables are required. Optional: `NEXT_PUBLIC_GOOGLE_CLIENT_ID` sets a default Gmail Client ID for everyone using your deployment, so each user only has to be added as a test user. Put it in `.env.local` for local dev. It is not a secret.

### Gmail setup (one time, ~10 minutes)

**You only need the Client ID. You don't need the Client secret.** The app signs in with Google's popup in the browser
([token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)), which uses only the Client ID. A secret
must never be put in a web page, so keep it private or delete it. The same steps are in the app under **Settings → Gmail → step-by-step setup**,
along with a **Test Gmail connection** button that tells you which step is wrong.

1. **Create a project:** [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate).
2. **Enable the Gmail API:** [Gmail API → Enable](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. **Consent screen:** [Google Auth Platform](https://console.cloud.google.com/auth/overview) → Get started. Enter an app name and your email, choose audience **External**.
   Then go to **Audience → Test users** and add every Gmail address that will use the app. Leave the app in **Testing**; no Google verification is needed for up to 100 test users.
4. **Client ID:** [Clients](https://console.cloud.google.com/auth/clients) → Create client → **Web application**.
   - **Authorized JavaScript origins:** your site, e.g. `https://your-app.vercel.app`, and `http://localhost:3000` for local dev. No trailing slash.
   - **Authorized redirect URIs:** leave empty (the popup flow doesn't use them).
5. Copy the Client ID (ends in `.apps.googleusercontent.com`) into **Settings → Gmail**, or set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in Vercel.
6. Click **Test Gmail connection**. Google will warn that the app "hasn't been verified". That's expected for your own test app: click **Continue** and tick **both** Gmail permissions.

Common errors:
- **`Error 400: origin_mismatch`:** the exact site URL isn't in *Authorized JavaScript origins*. Changes take a few minutes to apply.
- **`Access blocked` / `access_denied`:** your Gmail isn't listed under *Test users*.
- **"Gmail API has not been used in project…":** step 2 was skipped.

Scopes: `gmail.compose` (create drafts) and `gmail.readonly` (sync sent mail and replies). The app never sends email itself; drafts wait for you in Gmail.
Official walkthrough: [Gmail API JavaScript quickstart](https://developers.google.com/workspace/gmail/api/quickstart/js).

## Bank coverage

The bank list is built from your contacts, every bank tab (even empty ones), and any list of firms in the spreadsheet. That means a
tab with an "Institution Name" column (plus an optional "Institution Type"), or a tab with one category per column like
"Investment Banks (Bulge Bracket)". Only IB and PE categories are used from those. Name variants are merged (JPMorgan = JP Morgan,
Jeffries = Jefferies, FinTech Partners = FT Partners…). Hide banks you're not recruiting for, add any by hand, or switch on a
standard IB target list. A bank is **reached** once any email to someone there has gone out. It's **gone quiet** when it was reached, nobody
replied, and nothing's been sent in 3+ weeks.

## Gmail sync

Once Gmail is connected (one click per browser session; the sidebar shows **Connect Gmail sync**), the app reads your Sent mail and
inbox every 20 minutes while it's open:
- the **real date** of each first email, how many **follow-ups** went out (counted up to the first reply), and whether they **replied**;
- for contacts whose email is **missing**, it searches Sent mail by their name. If the recipient's name or address matches, the email
  is filled in (marked *gmail* as the source), along with the dates.

Statuses only move forward (it never un-does a "replied" or lowers a follow-up count you set). Google doesn't let a web page get a
Gmail token without a click, so fully background sync with the tab closed needs a server-side setup (see [TODO.md](TODO.md)).

## Email templates

The app ships with 14 ready-to-use templates adapted from a real IB networking playbook:
- Standard, and VP/MD-and-above.
- Same-school, business-school, club, UC and same-city alums, plus USC.
- Hometown, and hometown high school.
- Non-target school, and same major.
- Two follow-ups.

Fill in your profile in Settings (name, school, school nickname and city, major, club, hometown, and a one-line background) and they're ready.
"Auto-assign" picks the right template for each contact from your notes and their school/title.

**Import your own:** Drafts → Templates → **Import doc** takes a Word .docx, a Google Doc (download as .docx, or paste a link to a doc shared as
"anyone with the link"), or .txt/.md. It works best when:
- each template is its own tab, heading or bold title;
- the subject line sits just above "Hi NAME,";
- blanks are written in ALL CAPS (NAME, FIRM, POSITION, SCHOOL, HOMETOWN, CLUB, CITY, X HIGH SCHOOL…);
- instructions to yourself are in [brackets].

NAME is resolved by position: in the greeting it's the contact, after "My name is" or as the sign-off it's you.

**Is the import 100% accurate?** Not guaranteed, which is why nothing is saved until you review it. The rule-based parser handles documents structured like
the above very reliably. Every substitution is listed and highlighted, and unfamiliar ALL-CAPS words are flagged. The optional AI pass only names templates and
resolves flagged blanks. If it changes any of your wording, its edits are thrown out automatically. For a one-time import, a two-minute skim of the review
screen gets you to 100%.

## Spreadsheet format

Any tab with a `Name` column (or `First Name` + `Last Name`) plus an `Email` or `LinkedIn` column counts as a contact table. Optional columns: `Position`, `Location/Team`, `Status`, `Connection / Comment`, `Company`. The bank comes from a tab title like "JP Morgan Application Tracker", or from the tab name. SF and NY people live in the **same bank tab**; the region comes from the `Location/Team` column (for example `NY · Tech`). Rows with no location default to SF. Old `(NY)` tabs still work.

Status values: "Sent" means emailed. "Pending" means queued and not sent yet. Each bank has a cap on live people (default 2: emailed and still waiting for a reply). The bank view shows who's next when a slot opens.

Write-back only changes: emails found, status changes (e.g. "Sent", "Followed up (1x)", "Replied"), and new people added into blank numbered rows of the right bank tab, or into a new `Prospects` tab. Everything else in the workbook is left as is.

## Notes and limits

- **Saving back to your .xlsx** works in Chrome and Edge (File System Access API). If the file lives in OneDrive, right-click it and choose **Always keep on this device**, and close it in Excel before saving.
  If the file changed on disk since you imported it (Excel autosave, OneDrive sync), the app re-reads it first and applies its changes on top, so your Excel edits aren't lost.
  "*An operation that depends on state cached in an interface object…*" means OneDrive or Excel touched the file mid-read. The app now retries automatically; if it persists, close Excel and wait for OneDrive to finish syncing.

- Find people never logs in to LinkedIn or scrapes it. It only reads public Google search snippets, so a school or hometown sometimes can't be confirmed. Those people land under **Maybe** for you to review.
- Apollo's search endpoint hides last names. Enabling Apollo in Find people spends credits to reveal each person.
