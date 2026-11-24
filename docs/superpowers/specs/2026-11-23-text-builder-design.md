# 9 PM text builder: your own sections, splits and presets (owner, 2026-11-23)

## Why

The 9 PM text is fixed: up to three messages (📊 Big banks, ✅ To-do, 📬 Outreach), ≤8 names per section, Big banks =
starred banks else bulge bracket + elite boutique, 10 banks max. The owner can't choose which banks (by color, prestige,
urgency), how many, what goes in each message, or how it's split, and there's nothing for warm relationships.

## Goals

- The text is a list of **messages**; each message is a list of **blocks**; every block has a **preset** plus a few
  options. Reorder, remove, add blocks; move a block into its own message ("split").
- A **live preview** on Reminders, built from your data by the same function the server uses, so what you see is what
  arrives.
- Whole-text presets to start from; today's text is the "Standard" preset (nothing changes until you edit).

## Non-goals

- Changing when it's sent (still 9 PM, every night) or the channel (WhatsApp via CallMeBot).
- Free-form message templating with a custom syntax.

## Blocks and their presets

| Block | Presets | Options |
|---|---|---|
| **Banks** | Starred · Top tier by prestige · Most urgent · Needs help (red / amber first) · Going well (green) · Applied / interviewing | which colors (⚪ 🔴 🟡 🟢), tiers, starred only, rank by prestige / urgency / health / last activity, max banks (1–30), fields per line (step, chats, emailed, application, next step) |
| **This week** | On · Off | emails / replies / chats |
| **Do better** | Up to 3 tips · Off | max tips |
| **To-do** | Everything · Must-do (thank-yous, replies, calls tomorrow) · Names only | which kinds (thank-yous, replies, check-ins, referrals, reminders, info sessions, chats to confirm, calls tomorrow), max names per kind, show emails or not |
| **Cold outreach** | Follow-ups due · Follow-ups + offices to fill · Off | kinds, max names per kind, "Already scheduled" line on/off |
| **Warm** | Due for a check-in · Haven't heard from in N days · Holiday check-in list · Off | days, by bank or flat, max people |
| **Calendar** | Today's calls + tomorrow's · Off | (server adds these; this only places / hides them) |
| **Links** | Process tracker / Follow-ups links on or off | |

Whole-text presets: **Standard** (today's three messages), **One short text** (To-do must-do + Banks: Most urgent 5,
one message), **Bank focus** (Banks: Starred, all fields, its own message; To-do names only), **Holiday** (Warm:
Holiday check-in list by bank + To-do must-do).

## Design

- `settings.textLayout: TextLayout` (`{ preset?: string, messages: { blocks: Block[] }[] }`), synced like any
  setting, pushed to the server with the plan (`account.textLayout`). Undefined = Standard = today's output exactly
  (`check:night` keeps passing unchanged).
- Banks: the browser pushes every non-hidden bank's progress (name, health score, tier rank, urgency, starred, column,
  chats, emailed, live, app, next, last activity) instead of the pre-picked 10. The block's filter / rank / max run in
  `digestFormat.ts` on the server, so they also apply when the plan is a day old. ~100 banks ≈ a few KB.
- Warm: the browser adds a `warm` list (person, bank, last contact, owed) to the plan; the server drops anyone who wrote
  or got an email since the plan (same rule as today's items).
- `nightMessages(o, layout)` renders blocks in order; each message is still split at 1,400 chars (CallMeBot limit).
  Empty blocks are skipped; an empty message isn't sent.
- **UI (Reminders → "Your text")**: left = messages as cards with their blocks (drag to reorder, "⋯ → Own message /
  Remove", "+ Add block"), each block shows its preset dropdown and an "Options" disclosure; right = the preview
  (WhatsApp-like bubbles, one per message, with character counts). Whole-text preset picker at the top; "Reset to
  Standard". Save = pushes to the server right away (plus "Send me a test now", which uses the existing send-now).

## Calls made here (owner can change)

- Defaults keep today's text until edited.
- Rank options: prestige (tier, your stars break ties), urgency (`bankUrgency`), health, last activity.
- Holiday preset is a Warm list, not an automatic message to bankers.

## Verify

`check:night` (Standard = today's output byte for byte; each preset renders; color / tier filters; splitting; empty
blocks), typecheck, lint, build; preview vs a real "Send me a test now".
