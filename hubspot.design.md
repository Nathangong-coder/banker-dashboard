---
version: alpha
name: HubSpot
website: "https://www.hubspot.com"
description: >-
  A warm CRM-platform canvas anchored on a cream page floor (`#f8f5ee`) carrying near-black ink (`#1f1f1f`) — not pure black — and HubSpot Orange (`#ff4800`) reserved for the rectangular primary CTA, the link underline, and the focus number on every statistic. Hero headlines run a custom serif (`HubSpot Serif Page Header Human`) at 80px / weight 500 over a photographic top band; every other word on the page runs HubSpot Sans at weight 300 body, weight 500 CTA. The signature move is the orange-bordered secondary button — every secondary CTA carries a 1px Orange stroke that pairs with the filled Orange primary right next to it.

seo:
  title: "HubSpot Design System for React — Orange #ff4800, HubSpot Serif, and 19 components"
  metaDescription: "HubSpot's design system as a DESIGN.md file. Orange #ff4800, HubSpot Serif Page Header Human, HubSpot Sans, 19 components. For React, Next.js, and AI tools."
  highlights:
    - "Single brand voltage — HubSpot Orange (`#ff4800`) carries every primary CTA, every link underline, every active statistic number, and both secondary button strokes"
    - "Custom serif display — `HubSpot Serif Page Header Human` runs the hero at 80px / weight 500 / 95px line-height while HubSpot Sans handles the entire 12–18px body scale"
    - "Cream page floor (`#f8f5ee`) — the `--cl-color-background-02` token sits on every section between the dark hero band and the `#1f1f1f` footer, never pure white"
    - "Orange-bordered secondary CTA — every Get-started-free button ships with a 1px `#ff4800` stroke over white, paired in-line with the filled Orange primary"
    - "Body weight 300 — `--cl-font-weight-p-medium`, `--cl-font-weight-display-01`, and `--cl-font-weight-light` all resolve to 300, so paragraph copy and 7rem display tier share the same light weight"
  tags:
    - "Marketing & CRM"
  lastUpdated: "2026-05-13"
  author:
    name: "Dov Azencot"
    url: "https://x.com/dovazencot"
  opening: |
    HubSpot's customer-platform surface is the rare CRM marketing canvas that pairs a photographic hero band with a custom-cut editorial serif. The opening h1 runs `HubSpot Serif Page Header Human` at 80px / weight 500 / 95px line-height over a portrait photograph; below it, the page floor turns cream (`#f8f5ee`) and the rest of the system runs HubSpot Sans at light weights — 300 for body copy and the large display tier, 500 for CTAs, navigation, and h3 cards. The chromatic voltage is HubSpot Orange (`#ff4800`), and it appears in four exact roles — primary button fill, secondary button stroke, link underline, and active statistic-number fill — and nowhere else as a section background.

    This DESIGN.md packages the spec into one machine-readable file. Inside: 22 color tokens grouped into one brand voltage (`#ff4800` orange with its `#c93700` hover and `#9f2800` pressed steps), the cream surface ladder (`#f8f5ee` page floor, `#ffffff` cards, `#fcfcfa` modal), the `#1f1f1f` near-black ink ladder, two accent decorations (the `#b9cdbe` Sage card tint, the `#d6c2d9` Lilac card tint), plus semantic success / warning / error tokens; 11 typography tokens running the custom serif at 80px / 48px / 40px display and HubSpot Sans at 24px / 18px / 16px / 14px / 12px; 4 corner radii anchored on the `16px` container default and the `8px` button rectangle; 9 spacing tokens; and 19 components including the dual orange CTA pair, the product-hub feature card, the dark hero band, and the cream stats card. Format follows the Google Labs DESIGN.md spec.

    Feed the file to Claude, Cursor, or Copilot and the agent will reproduce HubSpot's pairing — Orange filled primary right next to Orange-bordered secondary, cream page floor never pure white, body type at weight 300 — instead of a generic shadcn theme. Reference the tokens directly inside Tailwind config, CSS variables, or your own component library. The discipline worth studying is the in-line dual-CTA: where most CRM marketing sites ship a single solid primary and a ghost or text-link secondary, HubSpot puts the orange-filled "Get a demo" right next to the orange-bordered "Get started free" on the same row, so the secondary inherits the brand voltage instead of fading into the page.
  related:
    - href: "/design"
      title: "Browse all design systems"
      description: "The full directory of DESIGN.md files on shadcn.io, with live mockups for each."
    - href: "https://www.hubspot.com"
      title: "HubSpot — official site"
      description: "HubSpot's customer platform marketing surface, the source for every token in this spec."
    - href: "https://github.com/google-labs-code/design.md"
      title: "The DESIGN.md specification"
      description: "Google Labs' open spec for machine-readable design system files — the format this page is built on."
  questions:
    - id: "primary-color"
      title: "What is HubSpot's primary brand color?"
      answer: "HubSpot Orange at `#ff4800` is the brand voltage. The CSS variable `--cl-color-hubspot-brand-01` resolves to this exact hex, and so do `--color-brand01`, `--light-theme-button-primary-fill-idle`, `--light-theme-text-brand-01`, `--light-theme-text-link-underline-01`, `--light-theme-number-fill-active`, and `--light-theme-button-secondary-border` — 32 declared aliases pointing at one hex. It carries the filled primary CTA, the 1px stroke around the secondary CTA, the inline link underline color, and the active-state numeric fill on every statistic. Hover steps to `#c93700` (`--cl-color-button-primary-fill-hover`) and pressed to `#9f2800` (`--cl-color-button-primary-fill-pressed`). The system primary for text is `#1f1f1f` near-black, not orange — Orange never carries body copy."
    - id: "typography"
      title: "What fonts does HubSpot use, and what should I substitute?"
      answer: "Two families. `HubSpot Serif Page Header Human` (with `HubSpot Serif` as fallback) carries the hero h1 at 80px / weight 500 / 95px line-height; the same serif drops to 48px and 40px for h2 / large h3. HubSpot Sans carries every other tier — 24px h3 / 18px subhead / 16px body / 14px secondary / 12px nav — at weight 300 for body and display, weight 500 for CTAs, h3 cards, and nav. Both are proprietary, served via `--cl-font-family-display` and `--cl-font-family`. The closest open substitutes are GT Sectra or Tiempos Headline for the serif and Inter at weight 300/500 for the sans. Note the unusual choice: the 7rem display tier (`--cl-font-size-display-01`) runs at weight 300, so the largest hero text is the lightest weight on the page."
    - id: "cream-canvas"
      title: "Why does HubSpot use a cream page floor instead of white?"
      answer: "The cream (`#f8f5ee`, `--cl-color-background-02`, `--light-theme-background-03`) carries every interior section between the dark photographic hero band at the top and the `#1f1f1f` footer at the bottom. White (`#ffffff`, `--cl-color-container-01`) is reserved for the feature-card and product-hub tiles that lift off the cream floor — 33 background occurrences as a card surface, never as a page floor. The cream-to-white step is the system's primary depth cue, replacing the drop shadows other CRM marketing sites lean on. A second off-white at `#fcfcfa` (`--color-background-modal`) is the modal background, slightly cooler than the page cream."
    - id: "button-geometry"
      title: "Why does HubSpot put two orange buttons side-by-side?"
      answer: "The hero ships a paired CTA row: a filled `#ff4800` primary (`button-primary`) reading 'Get a demo' next to an orange-bordered, white-filled secondary (`button-secondary`) reading 'Get started free'. The CSS variable `--cl-color-button-secondary-border` resolves to `#ff4800` — the secondary inherits the brand voltage through its stroke rather than fading into a neutral ghost button. Both buttons use the same `8px` radius (`--cl-border-radius-medium`), the same `16px 40px` padding, and the same HubSpot Sans weight 500 label. Where most CRM marketing sites ship one solid primary plus a text-link secondary, HubSpot doubles the orange — one filled, one outlined — so both CTAs read as equally weighted brand actions."
    - id: "dark-mode"
      title: "Does HubSpot have a dark mode?"
      answer: "The marketing site does not ship a togglable dark theme, but it does ship two dark bands. The top photographic hero uses `#1f1f1f` background with `#f8f5ee` text (`--dark-theme-text-01`), and the footer uses the same `#1f1f1f` background (`--cl-color-background-footer-01`) for the entire site closing band. The full `--dark-theme-*` token set is declared (`--dark-theme-background-01: #042729`, `--dark-theme-text-01: #f8f5ee`) and powers HubSpot's product surfaces, but the public marketing page only invokes the dark tokens on the hero and footer. This DESIGN.md captures the dark band as `band-inverse` so you can render it, but no other component flips to a dark variant."
    - id: "use-in-project"
      title: "How do I use this DESIGN.md to build a React CRM marketing site?"
      answer: "Feed the file to Claude, Cursor, or any agent that reads structured tokens — the AI will reproduce HubSpot's pairing (cream page over photographic hero, dual Orange CTAs, body at weight 300) instead of a generic shadcn theme. You can also reference the 22 color tokens, 11 type styles, and 19 components directly: every value is a quoted hex or size you can paste into Tailwind config, CSS variables, or your own component library. Pair the spec with shadcn/ui primitives for fastest setup — the `8px` button radius and 1px brand-color stroke map cleanly to a `Button` variant pair."

colors:
  primary: "#ff4800"
  primary-hover: "#c93700"
  primary-pressed: "#9f2800"
  on-primary: "#ffffff"
  ink: "#1f1f1f"
  ink-soft: "#292929"
  ink-muted: "#9b9897"
  canvas: "#f8f5ee"
  canvas-modal: "#fcfcfa"
  surface-1: "#ffffff"
  inverse-canvas: "#1f1f1f"
  inverse-ink: "#f8f5ee"
  hairline: "#cfcccb"
  accent-sage: "#b9cdbe"
  accent-lilac: "#d6c2d9"
  accent-peach: "#fcc6b1"
  accent-pink: "#fcc3dc"
  link-underline: "#ff4800"
  focus: "#2f7579"
  semantic-success: "#00823a"
  semantic-warning: "#eeb117"
  semantic-error: "#d9002b"

typography:
  display-hero:
    fontFamily: "\"HubSpot Serif Page Header Human\", \"HubSpot Serif\", Georgia, serif"
    fontSize: 80px
    fontWeight: 500
    lineHeight: 1.19
    letterSpacing: "0px"
  display-lg:
    fontFamily: "\"HubSpot Serif\", Georgia, serif"
    fontSize: 48px
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "0px"
  display-md:
    fontFamily: "\"HubSpot Serif\", Georgia, serif"
    fontSize: 40px
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "0px"
  heading-h3:
    fontFamily: "\"HubSpot Sans\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: 24px
    fontWeight: 500
    lineHeight: 1.42
    letterSpacing: "0px"
  subhead:
    fontFamily: "\"HubSpot Sans\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "0px"
  body-lg:
    fontFamily: "\"HubSpot Sans\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: 18px
    fontWeight: 300
    lineHeight: 1.77
    letterSpacing: "0px"
  body-md:
    fontFamily: "\"HubSpot Sans\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: 16px
    fontWeight: 300
    lineHeight: 1.75
    letterSpacing: "0px"
  body-sm:
    fontFamily: "\"HubSpot Sans\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: 14px
    fontWeight: 300
    lineHeight: 1.57
    letterSpacing: "0px"
  label:
    fontFamily: "\"HubSpot Sans\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.57
    letterSpacing: "0px"
  button:
    fontFamily: "\"HubSpot Sans\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: 18px
    fontWeight: 500
    lineHeight: 1.77
    letterSpacing: "0px"
  nav-link:
    fontFamily: "\"HubSpot Sans\", \"Helvetica Neue\", Arial, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.66
    letterSpacing: "0px"

rounded:
  none: "0px"
  sm: "4px"
  md: "8px"
  lg: "16px"
  full: "9999px"

spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "40px"
  section: "64px"
  hero: "96px"

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    borderColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "16px 40px"
    height: "56px"
    border: "1px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    borderColor: "{colors.primary-hover}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "16px 40px"
    height: "56px"
    border: "1px"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
    borderColor: "{colors.primary-pressed}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "16px 40px"
    height: "56px"
    border: "1px"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.primary}"
    borderColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "16px 40px"
    height: "56px"
    border: "1px"
  button-secondary-hover:
    backgroundColor: "{colors.accent-peach}"
    textColor: "{colors.primary-hover}"
    borderColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "16px 40px"
    height: "56px"
    border: "1px"
  hero-heading:
    backgroundColor: "{colors.inverse-canvas}"
    textColor: "{colors.inverse-ink}"
    typography: "{typography.display-hero}"
    rounded: "{rounded.none}"
    padding: "0"
  section-heading:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-md}"
    rounded: "{rounded.none}"
    padding: "0"
  top-nav:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    rounded: "{rounded.none}"
    height: "128px"
    padding: "0px 40px"
    border: "0"
  nav-link:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    rounded: "{rounded.sm}"
    padding: "0"
    height: "32px"
    border: "0"
  link-inline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.link-underline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.none}"
    padding: "0"
    border: "0"
  feature-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "32px 32px 24px"
    border: "1px"
  product-hub-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "24px 24px 32px"
    border: "1px"
  stats-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-lg}"
    rounded: "{rounded.lg}"
    padding: "32px"
    border: "0"
  band-inverse:
    backgroundColor: "{colors.inverse-canvas}"
    textColor: "{colors.inverse-ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.none}"
    padding: "64px 0px"
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    borderColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
    height: "44px"
    border: "1px"
  badge-brand:
    backgroundColor: "{colors.accent-peach}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    border: "0"
  accent-tile-sage:
    backgroundColor: "{colors.accent-sage}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "40px"
    border: "0"
  accent-tile-lilac:
    backgroundColor: "{colors.accent-lilac}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "40px"
    border: "0"
  footer:
    backgroundColor: "{colors.inverse-canvas}"
    textColor: "{colors.inverse-ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: "64px 40px"
    border: "0"
---

## Overview

HubSpot's customer-platform surface is the rare CRM marketing canvas that opens with a portrait photograph behind a custom-cut editorial serif and closes the rest of the page in cream sans-serif. The hero band runs `#1f1f1f` near-black with a 6-person photographic group portrait; centered over it, the h1 reads "Where go-to-market teams go to grow" in `HubSpot Serif Page Header Human` at 80px / weight 500 / 95px line-height. Below the band the page floor switches to cream (`{colors.canvas}` `#f8f5ee`), the rest of the type swaps to HubSpot Sans, and every section sits between two off-white-to-white card lifts.

**Dual-orange voltage**: where most CRM marketing pages ship one filled primary plus a text-link or ghost secondary, HubSpot puts a filled `{colors.primary}` `#ff4800` primary right next to a 1px-`#ff4800`-bordered, white-filled secondary on the same hero row. The CSS variable `--cl-color-button-secondary-border` resolves directly to `#ff4800`, so the secondary inherits the brand voltage through its stroke rather than fading into the page. Both buttons share the `8px` radius and the `16px 40px` padding — the only difference is fill versus border. The pair turns Orange into a system property of the action row, not just the primary action.

**Custom-cut hero serif**: the display family is `HubSpot Serif Page Header Human`, a typeface variant that exists for one purpose — the largest h1 on the home page. It runs at 80px / weight 500 / 95px line-height, then drops to a plain `HubSpot Serif` at 48px h2 and 40px section h2. Where Stripe pulls a single Sohne-var weight 300 across every tier and Mailchimp pairs Means Web serif with Graphik Web sans, HubSpot ships a serif tier specifically for the page-header context, then hands everything else to a 12–24px sans at weight 300 body and 500 display.

**Key Characteristics:**
- **Dual orange CTAs** — filled `{colors.primary}` `#ff4800` primary paired with `{colors.surface-1}` white + 1px `{colors.primary}` stroke secondary, same `8px` radius and `16px 40px` padding.
- **Custom hero serif** (`{typography.display-hero}`) — `HubSpot Serif Page Header Human` at 80px / weight 500, dropping to `HubSpot Serif` at 48px and 40px.
- **HubSpot Sans body at weight 300** — `--cl-text-font-weight` is 300, so paragraph copy is lighter than the CTA labels at weight 500.
- **Cream page floor** (`{colors.canvas}` `#f8f5ee`) — applied via `--cl-color-background-02`, never pure white between the dark hero and the dark footer.
- **Two photographic dark bands** — the top hero and the `{colors.inverse-canvas}` `#1f1f1f` footer; both invert text to cream, no other section flips to dark.
- **Container radius 16px** — `--cl-border-radius-container` is 16px on cards, 8px on buttons (`--cl-border-radius-medium`), 4px on inputs (`--cl-border-radius-input`).
- **One brand orange, one hover, one pressed** — `#ff4800` → `#c93700` → `#9f2800`, all declared on `--cl-color-button-primary-fill-*`. No tint scale, no orange surfaces.

## Colors

HubSpot's palette is one brand voltage on a cream surface ladder, with two muted card accents and a full semantic triad held in reserve. The 22 tokens fall into one brand orange, the cream-to-white surface ladder, a near-black ink ladder, and four accent decoration tiles used inside product imagery.

- **HubSpot Orange (`#ff4800`)** — frequency 11. Used as text (3), bg (4), border (3), gradient (1). The brand voltage. 32 CSS-variable aliases resolve to this hex (`--cl-color-hubspot-brand-01`, `--cl-color-button-primary-fill-idle`, `--cl-color-text-link-underline-01`, `--cl-color-number-fill-active`, `--cl-color-button-secondary-border`). Carries the filled primary CTA, the secondary CTA stroke, every link underline, and every active-state statistic-number fill — nothing else.
- **Hover Orange (`#c93700`)** — declared on `--cl-color-button-primary-fill-hover` and `--cl-color-play-button-fill-hover`. The single hover step for every Orange interactive surface.
- **Pressed Orange (`#9f2800`)** — `--cl-color-button-primary-fill-pressed`. The pressed-state step, also the focused secondary-button text color (`--cl-color-button-secondary-text-color-pressed`).
- **Ink (`#1f1f1f`)** — frequency 876. Used as text (449), border (424), bg (3). The system primary. 32 declared aliases (`--cl-color-text-01`, `--cl-color-link-01`, `--cl-color-border-01`, `--cl-color-icon-01`, `--cl-color-container-inverse-01`, `--cl-color-background-footer-01`). Not pure black — a very dark gray that doubles as both body-text color and the inverse-canvas color for the hero and footer bands.
- **Ink-soft (`#292929`)** — frequency 0 raw but declared on `--light-theme-icon-02` and `--cl-color-social-button-fill-idle`. A slightly lifted near-black for secondary icons and social-button fills.
- **Ink-muted (`#9b9897`)** — declared on `--light-theme-neutral-01` and `--cl-color-accent-decoration-01`. The muted gray for tertiary labels and inactive nav items.
- **Cream canvas (`#f8f5ee`)** — frequency 244. Used as text (118), bg (9), border (117). The page floor. `--cl-color-background-02`, `--light-theme-background-03`, and `--dark-theme-text-01` all resolve here — the same hex carries the light-mode page background AND the cream text-on-dark for the hero h1 over the photographic band.
- **Modal canvas (`#fcfcfa`)** — declared on `--color-background-modal` and `--cl-color-background-01`. A cooler cream used only for modal dialogs.
- **Surface-1 white (`#ffffff`)** — frequency 138. Used as text (55), bg (33), border (50). The card surface — every feature card, product-hub tile, and pricing card lifts off the cream floor onto white via `--cl-color-container-01`.
- **Hairline (`#cfcccb`)** — declared on `--cl-color-neutral-background-01` and `--cl-color-accent-fill-01`. A warm-gray 1px card border that pairs with the cream-to-white step.
- **Accent Sage (`#b9cdbe`)** — declared on `--cl-color-background-accent-01` and `--cl-color-accent-fill-04`. The pale sage-green tile used inside one product illustration.
- **Accent Lilac (`#d6c2d9`)** — declared on `--cl-color-background-accent-02`. The pale lilac tile in another product visual.
- **Accent Peach (`#fcc6b1`)** — frequency 0 raw but declared on `--cl-color-badge-brand-fill-01` and `--cl-color-button-secondary-fill-pressed`. The pale-peach badge background for the brand-tinted chip.
- **Accent Pink (`#fcc3dc`)** — declared on `--cl-color-background-accent-03` and `--light-theme-accent-decoration-08`. A pale pink tile, paired with a deep magenta on the dark theme (`--dark-theme-accent-fill-08`).
- **Focus Teal (`#2f7579`)** — declared on `--cl-color-focus-01` and `--cl-color-free-01`. The focus-ring color and the 'free tier' indicator on pricing rows.
- **Semantic Success (`#00823a`)** — declared on `--cl-color-success-01`. The green check / success state.
- **Semantic Warning (`#eeb117`)** — declared on `--cl-color-warning-01`. The amber inline warning.
- **Semantic Error (`#d9002b`)** — declared on `--cl-color-error-01`. The system red for inline errors.

## Typography

HubSpot runs two families, never blended within a tier. `HubSpot Serif Page Header Human` (with `HubSpot Serif` as the in-family fallback) carries the hero h1; HubSpot Sans carries every other word on the page.

**HubSpot Serif** anchors three display tiers — 80px / weight 500 / 95px line-height for the hero h1, 48px / weight 500 / 55px line-height for h2, and 40px / weight 500 / 44px line-height for the section h2 on cards and stats. All three sit at letter-spacing 0 — the serif's proportions carry the visual rhythm without negative tracking. The serif is never set in HubSpot Sans territory (body, labels, captions) and the sans never crosses into hero display territory.

**HubSpot Sans** carries the 24px h3 / weight 500, the 18px subhead / weight 500, the 16px body / weight 300, the 14px secondary / weight 300, the 14px label / weight 500, the 12px nav link / weight 500, and the 18px button label / weight 500. The unusual choice: body copy runs at weight 300 — lighter than the CTA labels at weight 500 — through `--cl-font-weight-p-medium: 300` and `--cl-text-font-weight: 300`. Even the largest display sans tier (`--cl-font-size-display-01: 7rem`) ships at weight 300 via `--cl-font-weight-display-01`, so when sans does need to grow to display size, it gets lighter, not heavier.

**Light-weight body as signature**: where most CRM marketing systems set body type at weight 400 and CTAs at weight 600 to widen the contrast, HubSpot inverts the convention. Body type sits at 300, CTAs at 500 — a narrower 200-point spread, with the visual emphasis carried by the orange voltage and the serif headline rather than by typographic muscle.

## Layout

The page runs on a 4px/8px spacing grid amplified by `64px` and `96px` section gutters. The most-used token is `{spacing.sm}` `8px` (53 occurrences) — the inline gap between nav items, the card-interior text rows, and inline icon-and-label pairs. `{spacing.md}` `16px` (48) handles button row gaps and the standard between-paragraph rhythm. `{spacing.lg}` `24px` (26) is the card-interior padding step, and `{spacing.xs}` `4px` (22) is the tight inter-element gap inside dense rows.

Section padding lives at `{spacing.section}` `64px` (`--cl-section-padding-medium`) and `{spacing.hero}` `96px` (`--cl-section-padding-large`). The container max-width is fixed at `1080px` via `--cl-section-content-max-width` and `--global-nav-content-max-width` — HubSpot never goes wider than 1080px, even on `1440px+` viewports. Asymmetric padding shows up on feature cards: `32px 32px 24px` (10 occurrences) and `24px 24px 32px` (9) — the top-bottom asymmetry signals where the card's headline anchors versus where the card's CTA sits.

The grid is also unusually wide on top-nav: the header runs `128px` tall (`--global-nav-header-height`), nearly double the 68–80px most CRM marketing sites ship. The extra height makes room for the two-row navigation (utility row at the top, product menu below).

## Elevation & Depth

**Hairline-and-surface-ladder**: HubSpot prefers a 1px `{colors.hairline}` `#cfcccb` border plus a cream-to-white surface step to a drop shadow. The CSS variable `--cl-card-border-width` resolves to `0px` for the inner card and `--cl-card-border-color: transparent` — instead, cards lift off the `{colors.canvas}` `#f8f5ee` page floor via the `{colors.surface-1}` `#ffffff` surface contrast and a 1px hairline.

The one declared shadow is `--shadow-light: 0 0.063rem 0.313rem rgba(240, 246, 251, 0.12)` — a faint cool cast at 12% alpha used on the floating help-widget pill in the bottom-right corner. Outside that widget, the system runs flat: no drop shadows on cards, no blur on the top-nav, no shadow under the hero CTAs.

The deep band is the photographic hero at `{colors.inverse-canvas}` `#1f1f1f` with `{colors.inverse-ink}` `#f8f5ee` cream text — a deliberate inverse moment that is repeated only by the footer at the bottom of the page. Both dark bands use the same `--cl-color-background-footer-01` token, so the system treats them as one inverse surface.

## Shapes

**Rectangular-rounded-rectangle voltage**: the brand owns the `16px` and `8px` corners. `--cl-border-radius-container` resolves to `16px` (31 occurrences) — every feature card, product-hub tile, stats card, and accent decoration uses this radius. `--cl-border-radius-medium` resolves to `8px` (27 occurrences) — every interactive button uses this. Inputs step down to `4px` via `--cl-border-radius-input` and `--cl-border-radius-small` (4 occurrences). The only `50%` circular treatment (8 occurrences) is the customer-logo dots and the floating chat widget.

The system avoids `9999px` pill geometry on buttons entirely — there is no pill CTA anywhere in the HubSpot marketing surface. The `8px` rectangle on both filled and outlined orange buttons is the brand's button signature, distinguishing the system from the pill-heavy CRM neighbors (Mailchimp's 26px pill, HubSpot's 8px rectangle).

## Components

The system documents 19 components, each anchored to declared tokens. The dual-orange CTA pair and the cream-to-white card ladder carry the identity.

- `button-primary` — the filled rectangular CTA. `{colors.primary}` `#ff4800` fill, `{colors.on-primary}` `#ffffff` text, 1px `{colors.primary}` stroke, `8px` radius, `16px 40px` padding, 56px height, 18px / weight 500 label.
- `button-primary-hover` — fill steps to `{colors.primary-hover}` `#c93700`; text and geometry hold.
- `button-primary-pressed` — fill steps to `{colors.primary-pressed}` `#9f2800`; text and geometry hold.
- `button-secondary` — the orange-bordered counterpart. `{colors.surface-1}` `#ffffff` fill, `{colors.primary}` `#ff4800` text, 1px `{colors.primary}` stroke. Same `8px` radius and `16px 40px` padding as the primary, paired with it in-row in the hero.
- `button-secondary-hover` — fill steps to `{colors.accent-peach}` `#fcc6b1`, the pale-peach pressed surface; stroke and text shift to `{colors.primary-hover}`.
- `hero-heading` — the custom serif h1 at 80px / weight 500 over the `{colors.inverse-canvas}` dark photographic band. Renders in `{colors.inverse-ink}` `#f8f5ee` cream.
- `section-heading` — `HubSpot Serif` at 40px / weight 500, `{colors.ink}` text on `{colors.canvas}` floor. The h2 on stats cards and "Remarkable results for every size business."
- `top-nav` — `{colors.surface-1}` white surface, 128px tall (twice the normal nav height), `0px 40px` horizontal padding, `{typography.nav-link}` 12px / weight 500 labels.
- `nav-link` — 32px hit area, 12px / weight 500 sans, `{colors.ink}` `#1f1f1f` text on white, no underline at rest.
- `link-inline` — `{colors.ink}` text with a `{colors.link-underline}` `#ff4800` 2px underline (`--cl-text-link-underline-thickness: 2px`). The orange is the underline color, not the text color — Orange enters at the link without dominating the paragraph.
- `feature-card` — white card on cream floor, `{rounded.lg}` `16px` corners, `32px 32px 24px` asymmetric padding, 1px `{colors.hairline}` `#cfcccb` border. The product-hub tile (Marketing Hub, Sales Hub, Service Hub, Content Hub).
- `product-hub-card` — same `16px` radius and white fill as feature-card but `24px 24px 32px` inverted asymmetric padding — the headline sits higher, the CTA sits lower.
- `stats-card` — cream-fill stats tile carrying `{typography.display-lg}` 48px serif number (`12` months, `5` point NPS). No border, no hairline — the cream surface itself is the card.
- `band-inverse` — `{colors.inverse-canvas}` `#1f1f1f` background with `{colors.inverse-ink}` `#f8f5ee` text, `64px 0px` section padding. The dark photographic hero and the closing footer band both use this.
- `text-input` — white fill, 1px `{colors.ink}` stroke, `4px` radius (`--cl-border-radius-input`), `12px 16px` padding, 44px height.
- `badge-brand` — `{colors.accent-peach}` `#fcc6b1` fill with `{colors.primary}` `#ff4800` text, `4px` radius, `2px 8px` padding. The "New" or product-tier indicator chip.
- `accent-tile-sage` — pale sage tile (`#b9cdbe`) used inside one product illustration. `16px` radius, `40px` padding.
- `accent-tile-lilac` — pale lilac tile (`#d6c2d9`) used inside the dashboard mockup. Same geometry as the sage tile.
- `footer` — `{colors.inverse-canvas}` background with `{colors.inverse-ink}` cream text, `64px 40px` padding, no radius. The bottom inverse band carrying the link sitemap.

## Do's and Don'ts

**Do** pair the filled `{colors.primary}` primary right next to the orange-bordered `{colors.surface-1}` + 1px `{colors.primary}` secondary on the same row. The dual-orange pairing is the signature — a ghost or text-only secondary breaks the rule that both CTAs share the brand voltage.

**Do** set body type at HubSpot Sans weight 300, not weight 400. `--cl-text-font-weight` is `300`; bumping body to 400 collapses the typographic contrast with the weight-500 CTA labels and h3 cards.

**Do** use `{colors.ink}` `#1f1f1f` for text, not pure black. The system primary text color is a very dark gray, declared on `--cl-text-color` and `--cl-color-text-01` — the same hex doubles as the dark-band background, so the cream text-on-dark stays consistent with the dark text-on-cream.

**Do** apply the `16px` container radius (`--cl-border-radius-container`) on cards and the `8px` medium radius (`--cl-border-radius-medium`) on buttons. The two-radius split is what keeps cards distinct from buttons at a glance.

**Don't** swap the `8px` rectangular button radius for a `9999px` pill or a `0px` square corner. HubSpot's CTA shape is a rectangular-rounded-rectangle — the pill geometry belongs to Mailchimp and Stripe, the square belongs to Linear, and the `8px` rectangle belongs to HubSpot.

**Don't** use HubSpot Orange `#ff4800` as a section background or a full-width band. It appears only on the filled primary CTA (4 background occurrences), the secondary stroke (3 border), the link underline (3 text), and one gradient. A full-band Orange section breaks the rule that Orange marks the action, not the canvas.

**Don't** set `HubSpot Serif` below 40px. The smallest serif tier in the extracted typography is 40px / weight 500; dropping the serif into 24px h3 or 18px subhead territory collides with the sans-only mid-tier rule and turns the editorial gesture into ornament.

**Don't** use weight 700 or above on any HubSpot Sans tier. Every sans tier in the extracted typography sits at 300 or 500 — pushing to 600/700 widens the weight ramp the brand deliberately avoids and pulls the system closer to a generic enterprise SaaS feel.

**Don't** rely on drop shadows for card elevation. `--cl-card-border-width` is `0px` and `--cl-card-border-color` is `transparent` — depth comes from the cream-to-white surface step plus a 1px `{colors.hairline}` border, not Y-offset blur.

## Known Gaps

- The home page does not render a visible text input, so the `text-input` component is constructed from the inspected pricing-form rows and the global search field.
- Form-field error and focused states beyond the `{colors.focus}` teal ring are not captured.
- The Lexend Deca tier declared in `--font-lexend-deca` is a legacy fallback inside `--font-family`; the live page renders HubSpot Sans across the entire body, so Lexend Deca is not surfaced as a token here.
- Dark-mode product surfaces (`--dark-theme-background-01: #042729` deep teal) are declared but only invoked on the photographic hero and the footer in the public marketing site — the full dark theme lives on app.hubspot.com and was not extracted.
- Motion timing was partially captured (`--button-transition: 0.15s color ease-out, 0.15s background-color ease-out, 0.15s border-color ease-out`) — a 150ms ease-out is the safe default.
- `HubSpot Serif Page Header Human` and HubSpot Sans are proprietary; the open substitutes (GT Sectra / Tiempos Headline for the serif, Inter for the sans) preserve proportions but not the page-header serif's specific cut.
