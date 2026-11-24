---
name: schedule-in-gmail
description: Put the user's Coverage follow-up and check-in drafts into Gmail's own Schedule send, using Claude in Chrome. Use when the user asks to schedule their Coverage emails, schedule tonight's follow-ups, or "schedule my drafts in Gmail".
---

# Schedule Coverage's drafts in Gmail

Google's API can't create Schedule-send emails, so Coverage writes the drafts and keeps a list of what to schedule
when. This skill does the clicking in Gmail, the same way the Coverage extension does.

Needs: the **coverage** connector (`emails_to_schedule`, `confirm_scheduled`) and **Claude in Chrome**.

## Steps

1. Call `emails_to_schedule`. If `count` is 0, say so and stop (the list fills when the user drafts follow-ups or
   check-ins in Coverage with Gmail scheduling).
2. **Show the list and ask before doing anything:** name, which email, and `sendAt` for each. Mention that Gmail's
   date / time box uses this computer's time zone and the times are in `timeZone`. Go on only when the user says yes.
3. Open Gmail in Chrome (`https://mail.google.com/mail/u/0/`). For each item, one at a time:
   1. Open its `draftUrl`. Wait for the draft to open.
   2. **Check the To address is the item's `to`** (and the subject, when one is given). If it isn't, skip the item and
      tell the user: never schedule a draft that doesn't match.
   3. Click the small arrow next to Send (**More send options**) → **Schedule send** → **Pick date & time**.
   4. Clear and type `gmailDate` into the date box and `gmailTime` into the time box, then click **Schedule send** in
      that dialog.
   5. Wait for Gmail's "Send scheduled" message.
4. **Never click Send.** If the only button you can find says Send, stop and tell the user.
5. Call `confirm_scheduled`. Report what's `found` and what's `missing` (with its `draftUrl`). Tell the user to press
   **Sync** in Coverage (or wait for its next sync) so the list shows them as "In Gmail".

## If something goes wrong

- The draft link opens nothing: the draft was sent, deleted or changed. Skip it and say so.
- The date box refuses the text: type the date the way the box shows it (e.g. "Nov 24, 2026") and the time as
  "9:07 AM".
- The time is already past or within two minutes: skip it and tell the user to pick a new time in Coverage.
