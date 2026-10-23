---
name: follow-up-planner
description: Plan the user's IB networking follow-ups - who is due a follow-up or a "move on?" decision, when each email should go out, and drafting the follow-up text. Use when the user asks who to follow up with, what's due this week, or to draft follow-ups.
---

# Plan follow-ups

Uses **coverage-sheet** (`due_followups`, `get_contact`) and, for drafts, a **Gmail connector**.

## Who's due

1. `due_followups` (add `include_upcoming_days: 7` for "this week"). Dates come from the tracker's Contacted /
   Last emailed columns.
2. **Check before trusting it:** the Coverage dashboard may already have a follow-up queued or sent that the sheet
   doesn't show yet. If Gmail is connected, look for a newer message to them (sent or scheduled) and drop those people.
   Otherwise tell the user to check Coverage → Follow-ups → Scheduled.
3. Group the list: Follow-up #1 · Follow-up #2 · Move on? (2 follow-ups with no reply: suggest marking them moved on via
   `/recruitify:update-tracker`).

## The owner's timing rules

- Follow-up #1 about **7 days** after the first email, #2 about 7 days after #1, **max 2**, then stop.
- Send **Tue / Wed / Thu, 9-11 AM in the recipient's time zone** (NY = Eastern, Chicago/Texas = Central, else Pacific),
  **6-8 days** after the last email, at a random minute that isn't a round number (not :00, :15, :30…), so it doesn't
  look scheduled. Spread the days on purpose: some Tue, some Wed, some Thu, with gaps of 6, 7 and 8 days (they're
  collecting reply-rate data).
- Never follow up after a reply, a bounce, or an out-of-office saying they left.
- **No VP and above** without a strong tie (`vpPlus: true`).

## Drafting (only when asked)

- Reply **in the original thread** so it stacks under the first email. Keep it 2-4 sentences: a short nudge, no new
  ask. Sign-offs: follow-up #1 "Regards,", #2 "Kind regards,", then the first name, a blank line, and their signature.
- Create Gmail **drafts** only. Never send. Gmail's API can't Schedule-send, so give them the planned time for each
  ("Wed 9:47 AM ET") to schedule in Gmail, or tell them Coverage's automatic sending can do it from the dashboard.
- Show the drafts list (name · step · planned time) at the end.
