---
name: update-tracker
description: Read or update the user's IB recruiting tracker spreadsheet (.xlsx) - look people up, change a status (sent, replied, call scheduled, moved on), tick the Referral? box, fix a team, office, title or email. Use when the user asks who they've contacted at a bank, wants their tracker updated, or says something happened with a contact ("X replied", "Y referred me", "Z left the firm").
---

# Update the tracker

Uses the **coverage-sheet** tools, which read and write the workbook with the Coverage app's own spreadsheet code.

## First time

If a tool says no workbook is set: `find_workbooks`, ask the user which file is their tracker (newest "IB Recruiting -
Master Spreadsheet…" is the likely one; skip backups), then `set_workbook`.

## Looking things up

- `list_contacts` (query / bank / status) and `get_contact` for one person. Answer from these; never guess a person or
  a date.
- Status words: `new` = not contacted (the sheet says "Pending"), `drafted`, `sent`, `followed_up`, `replied`,
  `call_scheduled`, `done`, `ignored` = moved on / bounced / left the firm.

## Changing things

1. Map what they said to fields: "replied" → status `replied`; "we have a call Tuesday" → `call_scheduled`; "referred
   me" → `referral: true`; "left the firm" / "bounced" → `ignored`.
2. Run `update_contact` with `dry_run: true` and show the cells it will write. For a single obvious change you may go
   straight to the real write; for several people, always show the list first.
3. Run it for real. Only those cells change: the tool checks every other cell is untouched before saving, and keeps a
   backup in `.coverage-backups` next to the file.
4. If it says the file is locked, ask them to close it in Excel and retry. The Coverage dashboard can stay open: it
   picks up changes made to the file by itself.

## Owner's rules to respect

- At most **2 live people per desk** (bank + office + team) at once: warn before marking a 3rd as contacted.
- **Don't email VP and above** (VP, Director, MD, Head, Partner) unless there's a strong tie (UCLA, UCLA Anderson,
  Seattle/Washington). `vpPlus: true` marks them.
- Never re-contact someone already emailed.
- Chats go through `/coverage:record-chat`, not this skill.
