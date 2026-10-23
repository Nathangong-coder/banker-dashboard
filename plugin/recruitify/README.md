# Coverage plugin for Claude Code and Cowork

Claude works on your IB recruiting tracker (.xlsx) the same way the Coverage dashboard does, without uploading it anywhere.

## What's inside

**Skills** (Claude uses them by itself; you can also type them):

| Skill | Use it to… |
|---|---|
| `/coverage:update-tracker` | look people up, set a status, tick Referral?, fix a team / office / title / email |
| `/coverage:record-chat` | log a coffee chat or call (from Granola, a transcript, or your notes), grade it, update the row |
| `/coverage:tag-chatted-emails` | label Gmail threads `Chatted` → `Follow-up - Good` / `OK` / `Bad - Ghost` |
| `/coverage:follow-up-planner` | see who's due, when to send (Tue–Thu, 9–11 AM their time, 6–8 days), draft follow-ups |

**Tools** (`coverage-sheet`, runs on your computer with Node 20+): `find_workbooks`, `set_workbook`, `list_contacts`,
`get_contact`, `update_contact`, `log_chat`, `grading_rubric`, `chatted_people`, `due_followups`.

## Install

Claude Code:

```
/plugin marketplace add Nathangong-coder/banker-dashboard
/plugin install coverage@coverage
```

Cowork / Claude desktop: Customize → Plugins → Add marketplace → `Nathangong-coder/banker-dashboard` → install
**coverage**.

Then say "set up my tracker". Claude finds your .xlsx files and asks which one is your tracker.

Tagging emails needs Claude's **Gmail** connector, and pulling chats needs the **Granola** connector (Customize →
Connectors). Granola's free plan gives notes from the last 30 days; full transcripts need a paid Granola plan.

## Safety

- Only the cells a change needs are written. Before saving, the tool checks that every other cell is unchanged, and it
  keeps the 15 most recent backups in `.coverage-backups` next to the workbook.
- Close the file in Excel before a change (Excel locks it). The Coverage dashboard can stay open: it picks up the change.
- Gmail labels are applied only after you confirm the list. Nothing is ever sent, archived or deleted.
- Your data stays on your computer and in your own Gmail/Granola accounts; the plugin has no server.
