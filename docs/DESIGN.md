# DESIGN.md: Coverage (CRM style)

How Coverage should look and be laid out, for people and coding agents. It replaces the "UI design" section of
CLAUDE.md wherever they disagree. Every rule has an id (`C-3`, `L-2`…): cite the id when a change follows or breaks
a rule, instead of saying "more consistent". (Salesforce does the same for its agents: "a rule an agent can't
source is a rule an agent will eventually break".)

**Owner's brief (2026-11-22):** "copy more of a CRM style (Salesforce and HubSpot)… de-claudeify things and make
them more polished." Specific complaints: too much text at the top of every page; every page opens with four boxes
that look like separate columns and a toggle bar on the top right; pills everywhere.

## 0. Sources (and how much to trust each)

| Source | What it gave us | Trust |
|---|---|---|
| `@salesforce-ux/design-tokens` 4.1.0, `dist/themes/cosmos/*.css` (npm) | The real Cosmos (SLDS 2) values: font scale, spacing, radius, shadows, surfaces, status colors | High: the shipped tokens |
| SLDS blueprints: Page Headers (object home, record home, related list), Data Table, Path, Cards, Activity Timeline, Split View | Page anatomy | High |
| HubSpot knowledge base: record layout (left sidebar, middle tabs, right associations), index pages with saved view tabs | Record + list anatomy | High |
| salesforce.com/blog/category/design ("Agents can mimic good design. Ours know why it works", "What is SLDS 2") | Rule ids, tokens-not-hex, accessibility as a gate, user's job first | High (principles, no values) |
| Third-party DESIGN.md reconstructions (shadcn.io, webdesignhot) of hubspot.com / salesforce.com | DESIGN.md section format only | Low: they describe the MARKETING sites (80px serif heroes, orange CTAs), not the product UI. Don't copy their values. |

## 1. Atmosphere

- **V-1 A work tool, not a landing page.** Quiet neutrals, dense tables, one accent color for actions, color for
  status only. The data is the decoration.
- **V-2 Show the records, not a summary of them.** The first thing under a page header is the list / board /
  record itself. Counts live in the header's meta line (`24 banks · Sorted by urgency · SF, NY`), not in tiles.
- **V-3 De-Claudeify.** No cream "paper" background, no airy display type, no row of 4 stat tiles, no segmented pill
  bar as page navigation, no pill badge on every row, no left-border accent cards, no gradients, no emoji.

## 2. Color (tokens in `src/app/globals.css`; never hex in components, see CLAUDE.md)

Cosmos neutrals, our logo navy for the global header, our green as the single action accent.

| Token | Hex | Role | Cosmos source |
|---|---|---|---|
| `paper` | `#f3f3f3` | Page background (behind cards) | `surface-2` |
| `panel` | `#ffffff` | Cards, tables, header bars, popovers | `surface-1` |
| `subtle` | `#fafafa` | Table header row, hovered rows, inset areas | (between surface-1/2) |
| `ink` | `#181818` | Titles, record names, table primary column | `neutral-base-10` |
| `ink-2` | `#2e2e2e` | Body text | `on-surface-2` |
| `muted` | `#5c5c5c` | Labels, meta line, secondary columns (7.0:1 on white) | `on-surface-1` |
| `line` | `#e5e5e5` | Row dividers, card borders | `neutral-base-90` |
| `line-2` | `#c9c9c9` | Input borders, button borders | `border-1` |
| `navy` / `top` | `#0e1a2b` | Global header only (logo color) | ours |
| `brass-strong` (accent) | `#1f7a5c` | Primary button fill, active tab underline, selected row mark, focus ring | ours (5.3:1 on white) |
| `brass-ink` | `#175c45` | Links | ours |
| `brass-soft` | `#e6f2ed` | Selected row / active filter background | ours |
| `blue` / `blue-soft` | `#0b5cab` / `#eef4ff` | Info | `info-40` / `info-95` |
| `green` / `green-soft` | `#056764` / `#def9f3` | Success (replied, referral) | `success-40/95` |
| `amber` / `amber-soft` | `#8c4b02` / `#fbf3e0` | Warning (due soon, unconfirmed) | `warning-40/95` |
| `red` / `red-soft` | `#b60554` / `#fef0f3` | Error, overdue | `error-40/95` |

- **C-1** One accent. Green means "you can act here" (primary button, links, active tab). It is never a status.
- **C-2** Status colors appear as small text or a 8px dot next to text, or a soft-background badge (B-3). Never
  as large fills.
- **C-3** Progress (cold → found → emailed → talked → referral) uses one hue in steps of lightness (G-2), so it
  reads in grayscale and for color-blind users.

## 3. Type

- **T-1 Family:** `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` (Cosmos
  `font-family-base`). Lexend Deca goes: it's a display face, and it made every page look like a landing page.
  Mono (`Consolas, Menlo, monospace`) only for ids and code.
- **T-2 Scale** (Cosmos `font-scale-*`): 10, 12, **13 (base)**, 14, 16, 20, 24, 28 px.

| Use | Size / weight / line height |
|---|---|
| Body, table cells, form fields | 13 / 400 / 1.5 |
| Meta line, column headers, field labels, captions | 12 / 400 (headers 600) / 1.4 |
| Card title, section title | 14 / 600 / 1.4 |
| Page header title (object home: the view name) | 18 / 700 / 1.25 |
| Record name (record home) | 20 / 700 / 1.25 |
| Eyebrow above a title (object or record type: "Banks", "Bank") | 12 / 400, muted, sentence case |
| Big number (only inside an Analytics chart card) | 24 / 600 |

- **T-3** Sentence case everywhere. No ALL-CAPS labels except 2–3 letter codes (SF, NY, IB).
- **T-4** Numbers in tables are tabular (`font-variant-numeric: tabular-nums`) and right-aligned.

## 4. Space, size, shape, depth

- **S-1 4 px grid** (Cosmos `spacing-1..8` = 4, 8, 12, 16, 24, 32, 40, 48).
- **S-2 Page gutter 12 px**, gap between cards 12 px (Salesforce's record and home pages). Card padding 12–16 px.
- **S-3 Rows:** table rows 36 px (compact, default) / 44 px (comfortable, a list-view setting). Header bars 48–56 px.
  Controls 32 px tall on desktop; touch targets ≥ 44 px under 768 px.
- **S-4 Radius:** 4 px buttons, inputs, badges; 8 px cards, popovers, modals; full circle only for avatars and
  dots. No pill buttons, no pill tabs.
- **S-5 Depth:** cards = white + 1 px `line` border + Cosmos `shadow-1` (`0 0 2px #0000002e, 0 2px 2px #0000002e`
  at most; we use a lighter `0 1px 2px rgba(0,0,0,.08)`). Popovers, menus, side panels = Cosmos `shadow-3`.
  Nothing else casts a shadow.

## 5. Page templates (every page is one of these)

### L-1 Object home (a list of records)
Banks, People, Applications, Info sessions, Drafts, Activity log.

```
┌ Page header (panel, 1 card) ────────────────────────────────────────────────────────────┐
│ [icon] Banks                                                     [ New ] [Import][ ⋯ ]  │
│        All banks ▾  📌                                                                   │
│ 24 banks · Sorted by urgency · Offices: SF, NY · Updated 2 min ago   [🔍 Search ] [▦▤⊞] [⚙] [⏷] │
└──────────────────────────────────────────────────────────────────────────────────────────┘
┌ The list (same card or the next one) ────────────────────────────────────────────────────┐
│ □  Bank ▾          SF            NY            LA           Next step            Due       │
│ □  Evercore        ■ Tech?       ■ Generalist  —            Email a 2nd person   6 days    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- Row 1: object icon tile (32 px, accent-soft background), eyebrow = object name, title = **the saved view's
  name with a ▾ switcher** (L-4). Right: at most one primary button, then a button group, then ⋯.
- Row 2 (meta line): count · sort · filters in words · freshness, all 12 px muted. Right: search, **Display as**
  (icon button group: table / grid / board), list view settings gear, filter toggle.
- **No KPI tiles here** (V-2). Totals that matter go in the meta line; charts go to an Analytics view.

### L-2 Record home (one record)
A bank, a person, an info session, an application.

```
┌ Highlights panel ──────────────────────────────────────────────────────────────────────┐
│ [icon] Bank                                                  [Follow] [Draft email] [⋯] │
│        Evercore                                                                         │
│ Tier: Elite boutique   Offices: SF · NY   Applied: Summer 2028 SA   Owner: you         │
├ Path ──────────────────────────────────────────────────────────────────────────────────┤
│ ‹Watching›‹Networking›‹ Applied ›‹First round›‹Superday›‹Offer›   [Mark as current step] │
└─────────────────────────────────────────────────────────────────────────────────────────┘
┌ Main (2/3): tabs Overview | People | Activity | Notes ─┐ ┌ Rail (1/3) ───────────────────┐
│ …                                                       │ │ Next steps (3)                │
│                                                         │ │ Why it's ranked #1            │
│                                                         │ │ Applications (1)   View all   │
└─────────────────────────────────────────────────────────┘ └───────────────────────────────┘
```

- Highlights = Salesforce compact layout: 4–6 key fields in one row of label-over-value pairs.
- **Path** (Salesforce) for anything with stages: chevrons, completed in accent-soft, current in accent with white
  text, the rest neutral. One click sets the stage (our Process tracker columns).
- People variant (HubSpot): left 280 px "About" card (fields, inline edit), middle activity timeline (emails,
  chats, calendar, notes, newest first), right 280 px associations (bank, referred by, referrals, applications).

### L-3 Workspace / Home (a queue of to-dos)
Dashboard, Things to think about, Follow-ups.

- One header row (title + at most one primary action). Then the queue: grouped by **Overdue / Today / This week /
  Later** with plain group headers (14 px 600 + count), one line per item: type icon · what to do · related record
  link · due. Actions show on row hover (and always on touch). Expanding a row shows its detail inline.
- A right rail (320 px) may hold 1–3 small cards (reminders, this week's numbers).

### L-4 Saved views ("customize view")
- Every object home has views: a name, filters (offices, tiers, stages, teams…), visible columns, sort, display
  (table / grid / board), density. Built-ins: "All", "Recently viewed"; yours appear below; one can be pinned as
  the default. Stored per account (`coverage.views`, a `cm:` sync doc each).
- Switcher menu: the views (search if > 8), then "New view…", "Rename", "Save as…", "Delete". Editing filters on a
  saved view shows "Save" / "Revert" in the meta line until saved.

### L-5 Split view (list + detail)
Drafts, Info sessions, Find people: a 360 px list on the left (one record per two-line row), the record on the
right. Under 1024 px the detail opens as its own screen.

### L-6 Setup (settings)
Left vertical tab list (180 px), right: form sections as cards, each with a title and a one-line description. Save
per section.

## 6. Components

- **G-1 Global header:** navy, 48 px: logo + "Coverage", global search (center, 480 px), help, settings, account.
- **G-2 App navigation:** white bar under the header, object tabs (Home, Banks, People, Outreach, Applications,
  Calendar, Things to think about…), active = 3 px accent underline + ink text, overflow in "More ▾". Replaces the
  group switcher + sidebar (phase 3).
- **B-1 Buttons:** *Neutral* (white, `line-2` border, accent text): the default. *Brand* (accent fill, white text):
  one per header. *Destructive* (red text, neutral shape). *Icon button* 32 × 32 with border. *Button group*:
  joined neutral buttons, 1 px separators, ends rounded 4 px.
- **B-2 Tabs:** underline tabs for sections of one page/record. Never a segmented pill bar for navigation; the
  segmented control is only for 2–3 display modes, drawn as an icon button group.
- **B-3 Badges:** 12 px, 4 px radius, soft status background, at most one per row, only for state that changes
  what you do next ("Overdue", "Unconfirmed"). Everything else is plain text in its column.
- **D-1 Data table:** sticky header (subtle background, 12 px 600 muted, sort arrow on hover), 36 px rows with
  `line` dividers, first column = record link (ink, 13 px 600), numbers right-aligned, row hover = `subtle`,
  selected = `brass-soft` + 2 px accent inset on the left of the row (not a card border). Row actions in a ⋯ menu
  in the last column. Inline edit: pencil on hover.
- **D-2 Grid cell (coverage):** a 24 px square whose fill steps through the progress scale (C-3), with the team
  (unconfirmed = amber italic "Tech?") and a 12 px note. "—" when the office doesn't hire.
- **K-1 Card:** header (icon 20 px, title 14 px 600, count in muted, actions right), body, optional footer link
  "View all". Related lists are cards.
- **P-1 Path**, **P-2 Activity timeline** (icon column + vertical line, item = title, meta, expandable body),
  **P-3 Filter panel** (right side panel, 320 px, fields stacked, "Apply" / "Cancel"), **P-4 Empty state**
  (one sentence + one action, no illustration).
- **F-1 Forms:** label above field, 12 px muted; 32 px inputs, 4 px radius, `line-2` border, focus = 2 px accent
  ring; help text under the field.
- **M-1 Modals:** header bar (title), body, footer bar (Cancel neutral + one brand action). Toasts: top center,
  status colored, short.

## 7. Do / don't (agent checklist)

- **Do** start every page from L-1…L-6 and name it in the PR / commit.
- **Do** put counts in the meta line and details in tables.
- **Do** keep one brand button per header and put the rest in a group or ⋯.
- **Don't** add a row of KPI tiles to a list or queue page (V-2).
- **Don't** use a segmented pill bar as page navigation (B-2) or a pill badge on every row (B-3).
- **Don't** use cream backgrounds, display fonts, gradients, left-border cards or emoji (V-3).
- **Don't** hardcode hex in components; add a token (C-*).

## 8. Responsive

- ≥ 1280: full templates. 1024–1279: record rail drops below main. 768–1023: header buttons beyond the brand one go
  into ⋯; grids scroll sideways inside their card. < 768: tables become stacked rows (record link, then 2–3 key
  fields), nav bar becomes a menu, rows get 44 px targets. No horizontal page scroll at 390 px (existing rule).

## 9. Accessibility (a gate, not a polish step)

WCAG 2.2 AA: text 4.5:1 (`npm run check:contrast` covers every token pair), focus visible on everything, real
buttons and links, color never the only signal (progress also has the cell's note, status also has text).

## 10. Where each page goes

| Page | Template | Notes |
|---|---|---|
| Bank coverage | L-1 (Display as: grid by office / table / board) + L-2 for a bank | Pilot. The Process tracker becomes this page's board display. |
| A bank (from coverage, firms) | L-2 | Path = Process tracker steps; rail = why ranked, next steps |
| Things to think about, Follow-ups, Dashboard | L-3 | |
| Spreadsheet → People (contacts table) | L-1 | The grid stays a tool view |
| A person | L-2 (people variant) | |
| Applications, Info sessions, Activity log | L-1 (+ L-5 for sessions) | |
| Email drafts, Find people | L-5 | |
| Templates, Email lab | L-1 / L-6 | |
| Corrections, Settings | L-6 | |

## 11. Migration plan

1. **Tokens + type** (globals.css: a `crm` theme, the new default; Lexend → system-ui; 13 px base). Every page
   shifts at once; old themes stay in the picker.
2. **Primitives:** `PageHeader` object-home and record-home variants, `ListViewSwitcher` (L-4), `DataTable` (D-1),
   `Path`, `Card` header (K-1), button variants (B-1), underline `Tabs` (B-2). Retire `Kpi` rows on list pages.
3. **Shell:** global header + app navigation bar (G-1, G-2).
4. **Pages**, one per commit, starting with Bank coverage, then Things to think about, Follow-ups, People.

**Status (2026-11-22):** 1–3 done. Shell = `components/AppNav.tsx` (G-2 tabs + phone menu) + `GlobalSearch.tsx` (G-1:
people, banks, pages; "/" focuses). Primitives restyled in place (`ui.tsx`: Button B-1, Card K-1, PageHeader = a header
bar, Segmented = underline tabs B-2, Badge B-3, inputs F-1, menus / modals shadow-3; `Kpi` = a label-over-value pair
inside one `.kpi-strip` highlights bar, never tiles) and added in `crm.tsx` (`RecordHeader`, `Path`, `Tabs`,
`RelatedCard`, `Timeline`, `QueueGroup`). Pages: Bank coverage (L-1), Things to think about + Follow-ups (L-3
headers + tabs), new record pages `/person?id=` (L-2 people variant) and `/bank?key=` (L-2 with the Process steps as
the Path). Still to do: a shared `DataTable` (D-1) and moving the remaining list pages (Applications, Info sessions,
Activity log, Drafts, Find people) onto `ObjectHeader` + saved views.
