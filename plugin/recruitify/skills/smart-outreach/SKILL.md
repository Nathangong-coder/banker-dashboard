---
name: smart-outreach
description: Make the user's IB networking emails mention a good coffee chat they already had at the same bank ("I recently spoke with Benjamin Hon, who told me about the mentorship-based culture, and I'd love to learn more about tech at Mizuho from you"). Use whenever drafting a first email or a follow-up to a banker, or when the user asks for "smart" outreach / follow-ups.
---

# Smart outreach: name the good chat

Uses **coverage-sheet** (`smart_mention`, `get_contact`) and, for drafts, a **Gmail connector**. A Google Drive / Docs
connector helps when a chat's notes live in a Google Doc.

## For every email you draft to a banker

1. Call `smart_mention` with the person you're emailing. It looks for a chat **with someone else at the same bank**
   that the user rated **6/10 or better** (or graded 60+ when there's no rating). It never picks the person
   themselves or someone who referred them (that email already says so).
2. **Nothing found:** write the email as usual. Don't mention anyone.
3. **Found:** read `mention.notes`. If `mention.notesDoc` is a Google Doc and you can open it, read the part about that
   person too: the doc is the live record and may have more than the sheet. **No `notesDoc`?** With a Google Drive
   connector, search Drive for a doc titled with that person's name (else a doc whose text has their full name); use
   it only if exactly one fits, and tell the user which doc you read. Several fit → ask which one.
4. Write **one sentence** following `instruction`: who they spoke with, one or two specific, positive things that
   person told them, and that they'd love to learn more about the team at the bank from this person. Under 45 words,
   in the user's voice, no em dashes.
   - Use **only** what the notes say. No deals, numbers, names or claims that aren't written there. Nothing negative,
     nothing that sounds confidential ("he said the group is losing people").
   - If the notes have nothing specific and positive, use `withoutNotes` as written.
5. Placement (`placement`): first email = the start of the paragraph with the hook and the ask. Follow-up = its own
   paragraph after the first one, and **only if the chat happened after the user's last email to them** (otherwise
   the first email already had it, or it isn't news).
6. Show the user the sentence and where it came from ("from your 10/16 chat with Benjamin Hon, 8/10") before
   creating the Gmail draft. Drafts only, never send.

The Coverage dashboard does the same thing automatically when it writes drafts (Settings → Email → Writing → Smart
mentions), so emails written in either place read the same way.
