---
name: tag-chatted-emails
description: Tag the Gmail threads of everyone the user has had a coffee chat or call with as "Chatted", sorted into Chatted/Follow-up - Good, Chatted/OK or Chatted/Bad - Ghost by their rating, grade, referral and whether they still reply. Use when the user asks to tag, label, sort or re-sort chatted emails, or to see who's good / OK / ghosting after a chat.
---

# Tag chatted emails

Sorts the user's Gmail by how each networking chat went. Needs the **coverage-sheet** tools (this plugin) and a
**Gmail connector** with label tools (search threads, list/create labels, label/unlabel a thread). If Gmail isn't
connected, say so and stop: tell them to connect Gmail in Customize → Connectors (Claude Code: `/mcp`).

## Labels

| Label | Meaning |
|---|---|
| `Chatted` | Parent label: every thread with someone they've chatted with |
| `Chatted/Follow-up - Good` | Worth following up hard: referral, rating ≥ 8/10, or grade ≥ 84 (B) |
| `Chatted/OK` | Everyone else who chatted. **The default.** |
| `Chatted/Bad - Ghost` | Rating below 4/10 or grade below 60, or ghosting (below) |

Use exactly these names. Create any that are missing (list labels first; never create duplicates).

## Steps

1. Call `chatted_people`. If it errors with "No tracker workbook set", run `find_workbooks`, ask which file is their
   tracker, and `set_workbook`.
2. For each person, start from `tier` (the sheet's evidence: `why`). Skip anyone without an email and list them at the end.
3. **Ghost check (can only move someone down to Bad - Ghost, never up):** in Gmail, find messages to and from their address
   after `lastChat` (or after `lastContacted` if there's no chat date). They are ghosting only if **all** hold:
   - the user sent them **2 or more** emails after the chat,
   - none of those got a reply,
   - the latest of them is **10+ days** old.
   One unanswered thank-you is normal: that's not ghosting. Someone who referred them is never Bad.
4. Find their threads: `from:<email> OR to:<email>` (all mail, newest 20 threads is plenty).
5. **Show the plan before changing anything**: a table of name · bank · tier · why · thread count, plus anyone skipped.
   Ask "Apply these labels?" and wait for a yes. Applying labels changes their Gmail, so don't skip this.
6. On yes: per thread add `Chatted` and the tier label, and remove the other two tier labels if present (re-sorting moves
   people between tiers). Don't touch any other labels, and never archive, delete, mark read or send anything.
7. Report counts per tier and anything that failed.

## Notes

- The owner's rule (Oct 2026): their first 10-12 chats are all at least OK. If the evidence says Bad but the user disagrees,
  their word wins: use the tier they say.
- A rating is theirs (the Conversation column's "8.9/10"); a grade is the AI rubric score ("B+ (84)") in the notes.
- To re-sort later, run the same steps: the tier labels move, `Chatted` stays.
- If they want the tier written into the tracker too, use `log_chat` / `update_contact` only when they ask.
