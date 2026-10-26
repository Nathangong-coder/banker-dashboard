# Mass apply: fill 30+ applications unattended, text me to review (design notes, step 2)

Owner request, 2026-10-25. **Status: noted, not yet brainstormed.** Step 2 after the LinkedIn job review
(`2026-10-25-linkedin-job-review-design.md`, step 1). This file captures what the owner asked for so the later design
session starts from it; open questions are listed at the end and need the owner before planning.

## What the owner wants (their words, condensed)

- Push job applying "a lot stronger", more of a **headless-browser feature**: going through the list of jobs, it
  should **fully fill out most applications** by itself.
- **Send a text when it's done**, so the owner does one final review and **submits 30+ applications at the same time**.
- The owner still does the final review and the submit click (nothing in this design submits on its own).

## Starting point (what exists, extension 1.3)

- Applications → Jobs → tick jobs → **Fill selected**: the extension opens each job in a tab group, signs in with the
  opt-in saved logins (PIN-encrypted vault), fills every page from My info + AI answers (Workday multi-page via
  `continuePages`), stops at the review page, and reports per-job status (`FillStatus`: ready / needs_you / signin /
  account / access / error) back to the dashboard. Never submits.
- Tested only on mock Workday-like pages (headless harness); never on a real bank's Workday / Greenhouse form or with
  real AI answers. The agent test bench (`extension/agent/`) is the agentic fallback for forms the rules can't handle.
- Texts: the 9 PM WhatsApp (CallMeBot, `lib/server/whatsapp.ts#sendWhatsApp`) and Twilio are already wired server-side.
- Step 1 sets each job's class year and resume (junior resume for class-of-2028 postings), so the right file is
  attached without asking.

## Goals (from the request)

1. One run fills the whole "apply" list (30+ jobs) without the owner watching.
2. "Most applications" end at the review page fully filled; the rest say exactly what's missing.
3. A text at the end: how many are ready to submit, how many need you and why, with a link to the review list.
4. A review screen built for submitting many in a row: open the next ready tab, check, submit (owner clicks), mark
   submitted, move on.

## Constraints carried over (house rules)

- Nothing ever clicks Submit / Apply-final; the owner submits.
- Saved logins stay PIN-encrypted and never readable by the dashboard, the AI or the server.
- Never types real passwords the owner hasn't saved; never solves CAPTCHAs; never creates accounts (the owner does,
  or it's a later opt-in toggle).
- Sensitive answers (self-ID, work authorization) only by the owner's rules, never by the AI.

## Open questions for the design session

- **Where the browser runs.** "Headless" can mean (a) the extension running in the owner's own Chrome in background
  tabs / a minimized window (keeps the saved logins and the owner's own sign-ins; needs the computer on), or (b) a cloud
  browser on a server (runs with the laptop closed, phone-only; but sign-ins, saved logins and CAPTCHAs would have to
  live server-side, which conflicts with today's "logins never leave the extension" rule). This choice shapes everything.
- How the final review + submit works if the run happened in the cloud (the filled form has to be reachable from the
  owner's browser or phone to submit).
- What counts as "fully filled" (every required field, or also optional essays), and when the AI may draft open
  essay questions vs leave them for the owner.
- Account creation on sites where the owner has none (today: stops with "Create an account").
- How the agent bench's agentic loop is used: fallback per stuck page, or the main filler.
- Which channel sends the "done" text (WhatsApp / SMS / push) and what it says.
- The agent-bench practice task (filling applications found on LinkedIn from the profile), which the owner asked for
  earlier, belongs here.
