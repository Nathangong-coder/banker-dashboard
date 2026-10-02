# banker-dashboard: outreach rules + team-coverage feature (instructions for Claude)

> **How to use this file:** put it in the repo as `docs/outreach-rules.md` and add the line
> `@docs/outreach-rules.md` under `@AGENTS.md` at the top of `CLAUDE.md`. Claude Code will then load it every session.
> Part A is the standing rules the app has to enforce or default to. Part B and Part C are build tasks. Part D is a prompt
> you can paste into Claude Code to start the work.
> Everything here comes from Nathan's real outreach (≈85 emails, 9/29–10/1/2026). It replaces older defaults where they conflict.

---

## Part A — Outreach rules the app must follow

Work through these against the existing code (`defaults.ts`, `template.ts`, `emailFormat.ts`, `hooks.ts`, `experiments.ts`,
`followups.ts`, `desks.ts`, `api/enrich`, `api/prospect/*`). Where the app already does the thing, leave it and say so.
Where it doesn't, change the default or add the rule. Owner-editable settings stay editable: change the **defaults**, not the ability to edit them.

### A1. Who to email
1. **Seniority: only VPs and below** (Analyst, Associate, Senior Associate, VP; Director/ED/Principal are allowed but rank lower).
   **Never MDs, Heads, Partners or Group Heads**, unless they share a strong affinity: UCLA, UCLA Anderson, or Seattle/Washington.
   - Find (`api/prospect/filter` criteria + a hard post-filter on the reconciled title) drops MD/Head/Partner/"Global Head"/"Group Head" unless the
     profile's education or location shows an exception. Show the dropped people in a collapsed "Senior (skipped)" list. Don't delete them.
   - Drafts warns, without blocking, when a selected contact is MD+ and has no exception.
2. **Desk cap: max 2 live people per desk** (bank × office × team). This already exists (`followUp.livePerBank`, `desks.ts`); keep it at 2.
3. **Never re-contact** anyone already emailed (any `sentAt`, or a status at or past `sent`). Find/Add should flag duplicates by email, LinkedIn slug, or name+bank.
4. **Current role must be verified.** The source of truth for title, team, office and career path is the person's **current LinkedIn
   profile (Experience section)**, read at draft time. Web snippets, ZoomInfo and RocketReach go stale. Real misses:
   - someone listed as "Analyst" had been promoted to Associate;
   - someone had left banking for a startup;
   - the office in the sheet said SF, but LinkedIn said NY.
   If the headline/experience shows the person left the bank, set status `ignored` and add a "left firm" note.
5. **Location goes by the person's office, not the bank's HQ.** Tidal Partners = Palo Alto (SF region). Menlo Park and Palo Alto count as SF.

### A2. Email addresses
1. **Only send to a verified address.** Order: Apollo `bulk_match` → keep only `email_status: "verified"`. "Extrapolated" or guessed patterns don't count.
   Then Hunter. Then any other connected enricher (Lusha, RocketReach). If nothing is verified, the contact is "needs email" and gets no draft.
2. **Check every enrichment match against LinkedIn**: name, firm, city, and the LinkedIn URL when one is returned. Apollo has matched the
   wrong person before (a London MD for an SF analyst). If the returned `linkedin_url` or city disagrees, discard the match and show why.
3. Record which provider verified the email (`emailSource`) so it can be audited.

### A3. Email format (first email)
**Structure: 3 short paragraphs** (consolidated on 10/1/2026; the old version had 5):
```
Hi {first},

I hope this email finds you well! My name is Nathan Gong, I'm an Economics & Applied Mathematics student at UCLA interested in investment banking.[ TECH HOOK]

[AFFINITY/PATH HOOK] [ASK]

[CLOSE]

Sincerely,
Nathan Gong
UCLA Class of 2029
Economics & Applied Mathematics
425-394-3467 | LinkedIn | nagong1@ucla.edu
```
- **Font: Arial / sans-serif** (`settings.emailStyle.font` default → Gmail's Arial stack; it's Garamond today).
- **Resume (GongNathan.pdf) attached to every first email.** Follow-ups get no attachment.
- **Signature LinkedIn link = `https://www.linkedin.com/in/nathangong1/` directly.** Opening an API-made draft in Gmail's web UI rewrote the link into a
  `https://www.google.com/url?q=…` redirect. `emailFormat.ts` must never emit a redirect. If the app ever re-reads a draft's HTML (sync/update),
  turn `google.com/url?q=` hrefs back into the target URL and drop `data-saferedirecturl`.
- Phone digits keep the `&zwnj;` trick (already in `unlinkPhones`).
- **Max 2 hooks per email**: the tech hook (only if the person's team is Tech/TMT/software) plus ONE affinity hook.
- **Never invent experience.** Every fact in a hook comes from the person's profile. Nathan has **not** done the UBS IB Workshop, so never imply he has.
- **Firm naming:** write "Greenhill-Mizuho" for the merged Greenhill/Mizuho M&A business (people list either name).

**TECH HOOK (exact):**
> Through my summer/fall investment banking internship I worked on multiple tech deals (including one on a medtech startup), consequently developing a strong interest in the tech sector.

**Affinity priority** (pick the highest that applies): Volunteer (tutoring / soup kitchen) > Chinese > Washington (grew up in, or went to school in, WA) >
UCLA / Anderson > USC & other LA schools > other UC > other California school > Standard. Seattle/WA people get the WA hook, never the Chinese one.

**Subjects and hooks** (`{X} → {Y}` = a verified career-path fact from LinkedIn, e.g. "LionTree's software team to PJT's Software / AI group"):

| Type | Subject | Tailored hook |
|---|---|---|
| UCLA | Fellow Bruin Seeking to Connect | Your path from {X} to {Y} stood out to me, and seeing how you also went to UCLA, I wanted to reach out to learn more. |
| Anderson | Fellow Bruin Seeking to Connect | …and seeing how you're a fellow Bruin from Anderson, I wanted to reach out to learn more. |
| USC / LA school | Fellow LA Student Seeking to Connect | …and seeing how you also went to school in LA, I wanted to reach out to learn more. |
| Other UC | Fellow UC Student Seeking to Connect | …and seeing how you also went to a UC, I wanted to reach out to learn more. |
| Other California (Stanford, Santa Clara, Pepperdine…) | Fellow California Student Seeking to Connect | …and seeing how you also went to school in California, I wanted to reach out to learn more. |
| Chinese (+ shared school) | Fellow Chinese Bruin / Fellow Chinese UC Student / Fellow Chinese LA Student Seeking to Connect | Being Chinese myself, your path from {X} to {Y} really stood out, and I wanted to reach out to learn more. |
| Chinese, no shared school | Chinese Student Seeking to Connect | (same) |
| Washington | Fellow Washingtonian Seeking to Connect | While looking through your profile, I noticed that you graduated from {WA school}. Being from Seattle, WA myself, I thought it would be great to speak with someone else who lived in my hometown. |
| Standard | UCLA Student Seeking to Connect | Your path from {X} to {Y} stood out to me, and I wanted to reach out to learn more. |

**Template (non-tailored) hooks**, used ~20% of the time or when there's no verified path fact:
"Seeing how you also went to UCLA, I wanted to reach out to you specifically to hear more about your journey and how you found yourself at {Bank} after graduation."
Standard: "I wanted to reach out to you because I'm interested in learning more about investment banking at {Bank}."

**Senior (VP / Director / approved exception) version:** fold the seniority line into the hook paragraph, humble and bare-bones. There is **no** separate
"Given your experience…" paragraph anymore. Example:
> I know you are extremely busy as the head of consumer & retail, but your path from consumer and technology banking at Wells Fargo to leading Cantor's Consumer & Retail group really stood out to me and made me feel that you would have differentiated insights into building a career in investment banking.

**Asks** (they go in the same paragraph as the hook; experiment E1):
- E1-A: "I know that as {a/an title}, you must place a lot of value on your time, but if you happen to be available, I would love to have a call sometime. If so, I can send my availability, and I have attached my resume for your reference."
  Only on short emails (one hook). After an E4-A hook use "I would really appreciate a quick call sometime" so "love" isn't used twice.
- E1-B: "If you happen to be available, I would greatly appreciate the chance to connect over a quick call sometime. I have attached my resume for reference and can send my availability if needed."

**Closes** (E2): E2-1 "Thank you for your time, and I look forward to hearing from you soon!" · E2-2 "Thank you for your time; hope we get a chance to connect!"

**Volunteer hooks** replace intro+hook+ask. Tutoring version: "One of my most meaningful high school experiences was tutoring SAT math to underprivileged children. I'd love to learn more about your volunteer tutoring experience and journey at UCLA. If you happen to be available, I would love the chance to connect for a quick call. I can send my availability, and I've attached my resume for your reference."
Soup-kitchen version: same, but with "working at a soup kitchen" / "your volunteer experience". If the person isn't UCLA, write "journey to {Bank}". Any other kind of volunteering → no hook; flag it for Nathan.

### A4. Experiments (tag every email; read results from replies)
Model these with the existing lab machinery (`settings.experiments`, `assignTrial`, `draftMeta`, `crossTab`):
- **E1** ask lead-in A/B (above). **E2** close A/B. **E3** tailored vs template, **80/20**.
- **E4 "shaped that journey"**, Bruin/UC/LA hooks only, **70/30**:
  - E4-A (70%): "Your path from {X} to {Y} really stood out to me, and as a fellow Bruin, I'd love to hear how your time at UCLA shaped that journey."
    UC: "…as a fellow UC student, I'd love to hear how your time at {UC school} shaped that journey."
    LA: "…as a fellow LA student, I'd love to hear how your time at {LA school} shaped that journey."
  - E4-B (30%, control): the "seeing how you also went to UCLA, I wanted to reach out to learn more" line.
- The existing `verdict` guard (≥30 sends per arm, p < 0.05) stays. With weighted experiments (80/20, 70/30), `pickVariant` must
  assign by target share, not "least-used arm".

### A5. Send timing and follow-ups
- **Send times (by the recipient's office):** NY → **5:00 PM PT (8 PM ET)**; SF / LA → **7:00 PM PT**. Drafts shows "send at" by region,
  and the Gmail scheduled-send helper (if built) uses it. Don't send NY at 7 PM PT.
- **Follow-ups:** #1 after 7 days, #2 7 days after #1, then stop (`maxFollowUps: 2`). Same send-time rule. Never follow up after a reply,
  a bounce, or an out-of-office that says they left. Follow-up texts are the owner's two templates (already in `DEFAULT_TEMPLATES`, step 1/2).
- **Gmail labels** mirror state: `Outreach/SEND NOW`, `Outreach/HOLD - desk full`, `Outreach/Sent - waiting`, `Outreach/Replied`,
  `Outreach/Bounced`, `Outreach/CHECK - email or role`.

### A6. Tracker (spreadsheet) conventions
Per contact row: `#`, Name, **Location** (SF / NY / LA / Palo Alto / Menlo Park), Email (verified), **Position** (current title from LinkedIn),
**LinkedIn** (hyperlink), **Team**, Status, Comment (hook, experiment tags, send time, verification source). As of 10/1 every emailed person has
Location + Team filled in. Team `?` means "unknown, needs checking". The app must treat `?` like blank (unsorted), not as a team.

---

## Part B — Build: read each contact's team from the spreadsheet

**Goal:** every contact gets a normalized `team` even when the Team cell is empty, so coverage and filters work.

1. **Order of sources** (first non-empty wins; record which one in `teamSource: "sheet" | "position" | "comment" | "headline" | "manual"`):
   1. Team column (`HEADERS.team`); treat `?`, `-`, `n/a`, `unknown` as empty.
   2. Legacy combined `Location/Team` cell (`splitLocationTeam`, already exists).
   3. **Position/title text**, e.g. "Analyst - Tech M&A", "VP - Software IB", "Associate - Healthcare M&A", "MD - Head of Consumer & Retail",
      "IB Analyst - Debt Advisory & Restructuring".
   4. Comment/notes, then LinkedIn headline / captured profile.
2. **`inferTeam(text): {team, confidence}`** in `src/lib/locationTeam.ts`. Keyword map → canonical `DEFAULT_TEAMS` value:
   - **Tech:** tech, technology, software, internet, semis/semiconductor, fintech, SaaS, AI, cyber, data infra, TMT-tech, "digital infrastructure"
   - **TMT:** TMT, media, telecom, entertainment, sports, "media, entertainment & sports" (keep TMT distinct, but `teamMatches("Tech")` already accepts TMT)
   - **Healthcare:** healthcare, HC, life sciences, biotech, medtech, pharma
   - **Consumer:** consumer, retail, CR, food & beverage, restaurants
   - **Industrials:** industrials, metals & mining, aerospace, A&D, transportation, chemicals, "global industrials"
   - **FIG:** FIG, financial institutions, banks, insurance, asset management
   - **Energy:** energy, power, utilities, oil & gas, renewables, natural resources
   - **Real Estate:** real estate, REIT, lodging, gaming & leisure
   - **RX:** restructuring, RX, debt advisory, liability management, "special situations"
   - **Sponsors:** financial sponsors, FSG, private capital, growth capital, PE & VC coverage
   - **LevFin:** leveraged finance, levfin, DCM-HY
   - **M&A:** M&A (only when nothing more specific matches)
   - **Generalist:** generalist, strategic advisory (PJT), "investment banking analyst" at a known generalist-pool firm (Moelis, Evercore NY M&A, Centerview, PJT SA, Lazard FA NY), and nothing else matched
   - Office words (SF, NY, Menlo Park…) are never teams.
   Return `confidence: "high"` for an explicit team word and `"low"` for the generalist-pool fallback.
3. **Show it, don't silently write it.** Contacts table: the Team cell shows an inferred value in italic with a "from title" tooltip and a one-click
   ✓ (accept → manual patch to the Team column) and ✗. "Accept all high-confidence" button. Accepted values become normal cell patches, so the
   sheet round-trip rules in CLAUDE.md still hold (never rewrite cells the user didn't change).
4. The `noteam` filter (`/sheet?view=contacts&filter=noteam`) should list contacts with no sheet team **and** no high-confidence inference.
5. **Regression:** extend `npm run check:workbook` to print a team table (sheet / inferred / none counts, plus the 10 lowest-confidence inferences).
   On the owner's workbook every contact with "Tech", "TMT", "Software" or "Internet" in Position must come out as Tech/TMT.

---

## Part C — Build: coverage that reacts to the desks you check, plus "what am I missing" insights

### C1. The bug (verified in the code)
`app/coverage/page.tsx` computes the scoreboard (`counts.reached / ready / cold`, the "x of N banks reached" bar, "Banks that replied", the three
columns and the "Next moves" cards) from `CoverageRow.bucket`. `buildCoverage` (`lib/coverage.ts`) sets `bucket` from **all** of a bank's contacts
and **never looks at `coverage.plan`**. Checking or unchecking desks only changes `r.desks`, which feeds the "N of M desks in your plan emailed"
line and `DeskChecklist`. So checking SF Tech, NY Generalist, both, or none shows the same numbers.

### C2. Fix: one "active scope", driven by the checked desks
1. Add `scope.ts` (or extend `desks.ts`):
   ```ts
   /** The desks currently checked in the plan (enabled). Empty = no filter = whole list (today's behaviour). */
   activeDesks(plan): DeskTarget[]
   /** Does this contact belong to at least one active desk (location + team match, via locationMatches/teamMatches)? */
   inScope(c, desks): boolean
   /** Does this bank fall under at least one active desk's scope (all / tiers / picked banks, via targetAppliesTo)? */
   bankInScope(row, desks): boolean
   ```
2. In `buildCoverage`, when ≥1 desk is active:
   - Drop banks where no active desk applies (`bankInScope` false). Those banks aren't part of this view.
   - Compute `reached / replied / live / withEmail / due / quiet / lastOutreach / regions` from **in-scope contacts only**.
   - **bucket** = reached if an in-scope contact was reached, ready if an in-scope active contact exists, otherwise cold. A bank with
     NY Generalist contacts but nobody on SF Tech is **cold** in an "SF Tech only" view.
   - Keep the unfiltered numbers on the row too (`all: {reached, contacts}`) so the bank card can say "+3 contacts on other desks".
   - With 0 desks checked, behave exactly as today.
3. **Unit toggle on the scoreboard: "Banks" | "Desks".** In Desks mode every (bank × active desk) pair counts once, using `deskStatus`:
   reached = emailed/replied, ready = ready/needs_email, cold = empty. That makes "SF Tech + NY Generalist" at 30 banks a 60-desk denominator.
   Default to Desks whenever more than one desk is checked.
4. Everything below the plan reads from the same scoped rows: scoreboard, "Banks that replied", "Emails this week" (`outreachBetween` over
   in-scope contacts), the Next-moves cards (cold-bank deep links pass `&desk=<location>|<team>`, which `/find` already understands), and the
   three columns. Add a header chip: "Showing: SF · Tech, NY · Generalist (2 desks) — clear".
5. Remember the checked desks per browser (they already live in `coverage.plan.enabled`; make sure toggling is instant and doesn't rebuild
   anything unrelated). The zustand v5 selector warning in CLAUDE.md applies: select `s.coverage.plan` and default outside the selector.

### C3. "What am I missing" insights panel (top of /coverage)
For the active desks, or for all desks of `PRESETS` if none are checked, show ranked, direct statements. No charts needed:
1. **Uncovered desks:** the biggest-tier banks with **0 contacts** on a desk, e.g. "NY · Generalist: no one at Goldman Sachs, Citi, Barclays,
   Centerview, Rothschild." Link: `/find?banks=…&desk=NY|Generalist`.
2. **Contacts but no email:** "SF · Tech: 3 people at UBS/Deutsche Bank need verified emails." Link to the needs-email filter.
3. **Thin desks:** exactly 1 live person (room under the 2-cap): "add a second person".
4. **Gone quiet:** reached 21+ days ago, nobody live, no reply: "try someone new".
5. **Unsorted:** "12 contacts have no team. Their teams may hide coverage you already have" → the Part B review.
6. **Office reality check** (from the recruiting-coverage research, stored as data, not hard-coded logic): warn when a desk targets an office the
   bank doesn't hire summer analysts into (e.g. LA at Morgan Stanley / RBC / Centerview / Qatalyst / Raine; SF at Raine / Rothschild / Truist / Macquarie).
   Put this in `banks.ts` as `OFFICES: Record<canonBank, {SF?, LA?, NY?: {hires: boolean, teams: string[], note?}}>` so the owner can edit it.
   Show "not offered" instead of "cold" for those cells.

### C4. Acceptance checks (do these before calling it done)
- Check only **SF · Tech** → the numbers change. Banks with only NY people show as cold, or drop out if the desk scope excludes them.
- Check **SF · Tech + NY · Generalist** → Desks mode, denominator ≈ 2 × in-scope banks, and the numbers differ from either desk alone.
- Uncheck everything → identical to today's page.
- Toggling a desk updates the scoreboard, columns, Next moves and insights at the same time (no reload).
- `npm run build`, `npm run typecheck && npm run lint` pass. Add `scripts/check-coverage.mts` that loads a workbook and prints the scoreboard
  for: no desks / SF Tech / NY Generalist / both. The four outputs must differ.
- Click-test on a separate origin (127.0.0.1 + `next start`) as CLAUDE.md describes. Don't touch the owner's IndexedDB on localhost.

---

## Part D — Prompt to paste into Claude Code

```
Read CLAUDE.md and docs/outreach-rules.md first.

1) Part C first (it's a bug): make /coverage react to the desks checked in the recruiting plan. The cause is that buildCoverage sets
   CoverageRow.bucket and all counts from every contact and ignores coverage.plan. Implement activeDesks/inScope/bankInScope, scope
   buildCoverage to the checked desks, add the Banks|Desks unit toggle, the "Showing: …" chip and the "What am I missing" panel (C3).
   Add scripts/check-coverage.mts and show me its output for: no desks, SF·Tech, NY·Generalist, both.
2) Part B: inferTeam from Team → Location/Team → Position → Comment → headline, with teamSource + confidence, an inline review UI
   (accept/reject, accept-all-high), '?' treated as blank, and the check:workbook team table.
3) Part A: go rule by rule. For each one, say whether the app already enforces it (file:line), or make the change (defaults, filters, warnings).
   Seniority filter, Arial default, 3-paragraph base, tech-hook text, subject/hook table, E3 80/20 and E4 70/30 weighted assignment, send
   times NY 5pm PT / SF-LA 7pm PT, 2 follow-ups at 7-day spacing, verified-only emails with LinkedIn/city cross-check, no google.com/url
   redirects in signatures.
Keep the owner's data rules: never commit .xlsx/.pdf/.env, never rewrite untouched sheet cells. Run build + typecheck + lint before
finishing, and list anything you couldn't verify.
```
