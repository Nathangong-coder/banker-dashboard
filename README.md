# Coverage: IB networking desk

A dashboard that handles the repetitive parts of investment banking recruiting:

1. **Enrich contact info.** Upload your recruiting .xlsx, view it as a spreadsheet, and fill in blank emails from each person's LinkedIn URL and name (Apollo, with Hunter as a fallback). Write the results back into the same file.
2. **Find people.** Google-search public LinkedIn profiles for each bank (via Serper). AI screens each profile against your criteria: Tech IB or NY Generalist, not Healthcare, UC grad or from Washington State, and based in CA or NY. Add matches to the right bank tab.
3. **Email drafts.** Select contacts, auto-assign templates (AI or keyword rules), have AI fill the personal `[[AI: …]]` lines, and create Gmail drafts with your resume attached.
4. **Follow-ups.** Track each banker and each bank, split by SF and NY. Sync Sent mail and replies from Gmail, draft in-thread follow-ups, and get reminders by browser notification, phone push (ntfy), SMS (Twilio), or calendar (.ics).

## How data is handled

Everyone brings their own keys. Contacts, templates, your resume, and the uploaded workbook are stored in the browser (IndexedDB). The `/api/*` routes forward each request to Apollo, Serper, Anthropic, or Twilio with the caller's key and store nothing. Gmail calls go straight from the browser to Google. Several people can use one deployment without seeing each other's data.

Trade-off: data lives in a single browser. Use **Settings → Export backup** to move it to another machine.

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
- ntfy.sh can schedule notifications at most 3 days ahead. Twilio can schedule texts 15 minutes to 35 days ahead, but only with a Messaging Service SID.
