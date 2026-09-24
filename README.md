# Coverage: IB networking desk

A dashboard that handles the repetitive parts of investment banking recruiting:

1. **Enrich contact info.** Upload your recruiting .xlsx, view it as a spreadsheet, and fill in blank emails from each person's LinkedIn URL and name (Apollo, with Hunter as a fallback). Write the results back into the same file.
2. **Find people.** Google-search public LinkedIn profiles for each bank (via Serper). AI screens each profile against your criteria: Tech IB or NY Generalist, not Healthcare, UC grad or from Washington State, and based in CA or NY. Add matches to the right bank tab.
3. **Email drafts.** Select contacts, auto-assign templates (AI or keyword rules), have AI fill the personal `[[AI: …]]` lines, and create Gmail drafts with your resume attached.
4. **Follow-ups.** Track each banker and each bank, split by SF and NY. Sync Sent mail and replies from Gmail, draft in-thread follow-ups, and get reminders by browser notification, phone push (ntfy), SMS (Twilio), or calendar (.ics).

## How data is handled

Everyone brings their own keys. Contacts, templates, your resume, and the uploaded workbook are stored in the browser (IndexedDB). The `/api/*` routes forward each request to Apollo, Serper, Anthropic, or Twilio with the caller's key and store nothing. Gmail calls go straight from the browser to Google. Several people can use one deployment without seeing each other's data.

Trade-off: data lives in a single browser. Use **Settings → Export backup** to move it to another machine.

## Which keys you need

Everything is set in **Settings & keys** in the app. Each service shows *connected* or *not set*, what it's for, and a link to get the key. The sidebar counts the four core services, and each feature tells you when a key it needs is missing.

| Service | Needed for | Cost |
|---|---|---|
| **Apollo** (or Hunter) | Enrich contact info: finds missing emails | Apollo free plan includes some credits · Hunter 25 free/month |
| **Serper** | Find people: Google search of LinkedIn profiles | 2,500 free searches |
| **Claude** (Anthropic key or Vercel AI Gateway key) | AI screening, auto-assigning templates, writing personalized lines | Pay per use, usually cents per batch |
| **Google OAuth Client ID** | Creating Gmail drafts and syncing sent mail and replies | Free |
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

This only messages *your own* number and can't schedule, so use it as an on-demand "what's due today" ping.

### Twilio SMS (paid, schedulable)
1. Sign up at [twilio.com](https://www.twilio.com). A trial account can text only your own verified number, which is all this needs.
2. **Phone Numbers → Buy a number** with SMS capability.
3. **Messaging → Services → Create Messaging Service** and add that number as a sender. Copy the service ID (`MG…`). Scheduled texts need it.
4. From the console home page, copy the **Account SID** and **Auth Token**.
5. In Settings, fill in Account SID, Auth token, From number (or the `MG…` ID), and your own phone number.
6. **Text me today's list** sends right away. **Schedule upcoming** queues daily texts up to 35 days out.

For US numbers, Twilio may require **A2P 10DLC registration** (a short form, a few days) before texts deliver reliably. Toll-free numbers need toll-free verification instead.

### Why not fully automatic daily texts?
All data lives in your browser, so the server doesn't know who's due, and a server cron job has nothing to send. Scheduling ahead (ntfy, Twilio, calendar) covers this. Real server-side daily sends would need a database, which could be added later.

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000
npm run check:workbook -- "your file.xlsx"   # verify the parser against a real workbook
```

## Deploy to Vercel

Easiest: push to GitHub, then at vercel.com/new import the repo. Every push to `main` deploys to production, and other branches get preview URLs.

Or from the CLI:

```bash
npm i -g vercel
vercel        # first deploy, links the project
vercel --prod
```

No environment variables are required.

### Gmail setup (one time per deployment)

1. In Google Cloud Console, create a project and enable the **Gmail API**.
2. Configure the OAuth consent screen as External, in Testing mode, and add each user's Gmail address as a test user.
3. Under Credentials, create an OAuth client ID of type **Web application**. Add your Vercel URL (and `http://localhost:3000`) as authorized JavaScript origins.
4. Paste the client ID into Settings.

Scopes used: `gmail.compose` (create drafts) and `gmail.readonly` (sync sent mail and replies). While the app is unverified by Google, it is limited to 100 test users.

## Spreadsheet format

Any tab with a `Name` column (or `First Name` + `Last Name`) plus an `Email` or `LinkedIn` column counts as a contact table. Optional columns: `Position`, `Location/Team`, `Status`, `Connection / Comment`, `Company`. The bank comes from a tab title like "JP Morgan Application Tracker", or from the tab name. SF and NY people live in the **same bank tab**; the region comes from the `Location/Team` column (for example `NY · Tech`). Rows with no location default to SF. Old `(NY)` tabs still work.

Status values: "Sent" means emailed. "Pending" means queued and not sent yet. Each bank has a cap on live people (default 2: emailed and still waiting for a reply). The bank view shows who's next when a slot opens.

Write-back only changes: emails found, status changes (e.g. "Sent", "Followed up (1x)", "Replied"), and new people added into blank numbered rows of the right bank tab, or into a new `Prospects` tab. Everything else in the workbook is left as is.

## Notes and limits

- Find people never logs in to LinkedIn or scrapes it. It only reads public Google search snippets, so a school or hometown sometimes can't be confirmed. Those people land under **Maybe** for you to review.
- Apollo's search endpoint hides last names. Enabling Apollo in Find people spends credits to reveal each person.
