---
name: record-chat
description: Record a coffee chat, call or info session with a banker into the user's IB recruiting tracker, pulling the notes from Granola (or a pasted transcript), grading it with the owner's rubric, and writing the Conversation row, rating and status. Use when the user says they had a chat / call with someone, asks to log or grade a chat, or asks to pull recent chats from Granola.
---

# Record a chat

Writes one person's chat into their Conversation row on their bank tab, the way the user would type it, so the Coverage
dashboard picks it up. Needs the **coverage-sheet** tools; Granola is optional.

## 1. Get what was said

Pick the first source that works:
1. **Granola connector** (if connected): find the meeting by the person's name / the date, read its notes (and the
   transcript if the plan allows; the free plan gives notes only, and only the last 30 days). Match the meeting's
   attendees to the person's email from `get_contact` when you can; a first name alone isn't enough (two Jameses once
   got mixed up).
2. A transcript or notes the user pastes or attaches (.txt, .vtt, .docx…).
3. Ask the user for 2-3 sentences on what was discussed.

For "pull my recent chats from Granola": list the last 2 weeks of Granola meetings, match each to a tracker contact
(`list_contacts` by name, then check the email), show the matches, and record the ones they confirm.

## 2. Ask for what the text can't tell (one short question)

- Their own **rating out of 10** (optional; never invent one).
- **How it felt** (laughing? ran over?). Transcripts drop laughter, so this matters for the grade.
- Did they **refer** the user or promise to?

## 3. Grade it (when there's a transcript or real notes)

Call `grading_rubric`. Score every area 1-5 using its anchors; 3 when there's no signal, never a penalty for missing tone
cues. Apply the owner's rules, which beat the rubric (long, personal chats are a strength: never suggest cutting them
short). Advice the banker gave goes into the summary or commitments, **not** into "improvements". Pass the area scores
to `log_chat`, which computes the overall score and letter (all 3s = 71, all 4s = 84).

## 4. Write it

1. `get_contact` to confirm the right person (pass `bank` if the name is ambiguous).
2. `log_chat` with `dry_run: true`: name, date (YYYY-MM-DD), kind, a 1-3 sentence `notes` summary, `feel`, `rating`,
   `referral`, `grade` (areas, one-line summary, commitments). Show the user the cells.
3. On their OK, run it again without `dry_run`. It keeps a backup in `.coverage-backups` next to the workbook.
4. Then tell them what to do next from the commitments and the thank-you points: e.g. "send a thank-you tonight that
   mentions X", and suggest `/recruitify:tag-chatted-emails` to re-sort their Gmail.

## Rules

- If the save fails because the file is open, ask them to close it in Excel (the dashboard can stay open: it picks
  up the change by itself).
- Rows are never inserted. If their bank tab's Conversation table is full, say so; they add a row in Excel.
- Don't paste whole transcripts into the sheet: a summary line only.
