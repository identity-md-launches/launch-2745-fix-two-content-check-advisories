# PolyHamster design system

Taken from the final source: `app/globals.css` (all tokens and component classes), `app/layout.tsx` (fonts,
metadata), `app/components/App.tsx` (components), `app/components/DotText.tsx` (LED lettering).

## Overview

A play-points prediction market on one hamster's night. The audience checks the wheel, picks an outcome and
places a bet in seconds, often on a phone. The look is a dark LED scoreboard after Squeekchain's identity:
near-black surfaces, a gold dot emblem, blue "idle" tiles, dot-matrix lettering for the logo and the big
status readout, condensed headings, monospace data. Density is high and flat: thin borders and 4px corners,
no shadows except the glow of a live LED.

Hierarchy on every screen: brand and language switch, one plain line of what this is, the live board
(wheel status and the three key numbers), then the night tabs and the market cards; the player card,
leaderboard and how-it-works sit in a side column on desktop and below the markets on mobile.

## Colors

Defined once in `:root` (`app/globals.css:3-21`), hex notation. Components reference the tokens; the few raw
values are listed below.

| Token | Value | Job |
|---|---|---|
| `--bg` | `#1a1a20` | page background (with a 14px dot grid in `#2a2a33`, `body`) |
| `--panel` | `#131317` | cards, stats, tabs, market cards |
| `--panel-2` | `#1d1d24` | inputs, outcome rows, amount chips |
| `--line` | `#2c2c36` | every border and row divider |
| `--text` | `#f5f5f7` | body text; fill of the primary button and the active language |
| `--muted` | `#8b8b98` | secondary text, labels, not-live readout |
| `--gold` | `#f8a838` | brand accent: logo, active tab, hover/picked outlines, focus ring, spinning LED |
| `--gold-hi` | `#ffd06a` | numbers that matter: payout multipliers, countdown, your leaderboard row |
| `--gold-lo` | `#a8501a` | bet-slip dashed border, spinning board border |
| `--blue` | `#5b7cfa` | links, idle LED and "ZZZ" readout, block progress, pool share bars (16% alpha) |
| `--blue-lo` | `#2a3fa8` | liquidity slip border |
| `--coral` | `#f44a5e` | errors: not-live LED, connection warning, error toast, lost bets |
| `--green` | `#35d07f` | winning outcome, won bets |
| `--dot-off` | `#26262f` | unlit LED dots, empty progress track |

Raw values: `#0d0d10` (board and slip background), `#17171b` (dark text on light/gold/coral fills),
`#3a2a10` (date under the active gold tab). Measured contrast: the design probe found every measured text pair at
or above 4.5:1 (3:1 large) at 320, 390 and 1440; text over the board's scanline gradient was not measured.

## Typography

Self-hosted at build time with `next/font/google` (`app/layout.tsx:5-8`), exposed as CSS variables and wrapped
in tokens with fallbacks (`app/globals.css:18-20`):

| Token | Family, weights | Role |
|---|---|---|
| `--mono` | IBM Plex Mono 400/600 | default UI and data: numbers, outcomes, chips, inputs, lists (`html, body` 13px/1.5) |
| `--sans` | IBM Plex Sans 400/600 | sentences: tagline, board sentence, help text, rules, warning, night info |
| `--cond` | Barlow Condensed 600 | headings and labels: board label, stat values, tabs, market and card titles |

Scale (six sizes, no others): 11px (labels, captions, links, `.small`), 13px (body), 16px (tabs, board label,
card `h4`, inputs on mobile), 20px (market `h4`, card `h3`, stat values on mobile), 22px (market emoji), 24px
(stat values on desktop). Weights 400 and 600 only (`b, strong` are 600). Letter-spacing stays within
0.01-0.02em on condensed headings and 0 elsewhere; text is written in sentence case, never uppercased by CSS.
Headings are `line-height: 1.1`. Changing numbers (stats, countdown) use `font-variant-numeric: tabular-nums`.
The logo and big readout are SVG dot-matrix glyphs (`DotText`, 5x7 grid, `role="img"` with the text as label).

## Layout

- `.page`: max 1180px, centered, padding 20px 16px 80px.
- Desktop: `.board` is a 1.4fr / 1fr grid (readout, three stats); `.layout` is `minmax(0, 1fr) 320px` with a
  sticky `aside`; `.markets` auto-fills cards of at least 330px.
- At `max-width: 900px` everything is one column: the board stacks (readout above the three stats, which stay in
  three equal columns), the aside becomes static under the markets, the logo drops to 24px, the readout to 54px,
  stat values to 20px, inputs to 16px (no iOS zoom).
- Grids use `minmax(0, 1fr)` so long labels wrap instead of widening the page; the night tabs are a 3-column grid
  capped at 520px. Checked with no horizontal scroll at 320, 390 and 1440.
- Amount rows (`.chips`) wrap with a 6px gap. The number field uses `flex: 1 1 90px` and `min-width: 90px`;
  it moves below the presets when needed. At 320px the expanded bet field is 236px wide and shows six digits.
- Spacing steps in use: 6, 8, 10, 12, 14, 16, 18, 22px; groups are separated by 14-22px, items inside by 6-10px.

## Elevation & Depth

Flat. Surfaces are tonal (`--bg` < `--panel` < `--panel-2`, board at `#0d0d10`) with 1px `--line` borders.
The only glows: the LED (`0 0 8px` in its color) and the spinning board (`0 0 40px -20px var(--gold)`). The
board has a non-interactive scanline overlay (`.board::after`, `pointer-events: none`). The toast is the only
fixed layer (`z-index: 10`).

## Shapes

4px radius on every box (cards, buttons, inputs, tabs, chips, toast); 3px on the progress track; circles for LEDs.
Dashed borders mark a pending action (bet slip in gold-lo, liquidity slip in blue-lo). A 2px left border in blue
marks a rule note.

## Components

All in `app/components/App.tsx`, styled in `app/globals.css`.

- **Live board** (`section.board`): LED + label (`Live`/`En direct` only when the reading is fresh, else
  `Not live`/`Pas en direct`), `DotText` readout (`RPM` in gold when spinning, `ZZZ` in blue when idle, `---` muted
  when not live), a sentence (`aria-live="polite"`), and three `Stat` tiles (value then label; `accent` turns the
  value gold-hi). Freshness rules: `app/components/wheelStatus.ts`. After any refresh with no usable reading,
  `App.loadState` immediately invalidates the previous status, preserving block values and stopping motion.
  A new fresh reading restores Live; the 90-second age limit also applies.
- **Language switch** (`.lang`): two buttons with `aria-pressed`; the active one is filled `--text`. Sets
  `<html lang>`.
- **Night tabs** (`nav.tabs`): buttons with `aria-pressed`; active is filled gold.
- **Market card** (`article.market`): emoji (decorative), title, `Rule` disclosure (`.link`, `aria-expanded`),
  verdict line, outcome rows, slips, footer with the pool. Outcome rows (`button.outcome`) show a share bar, %, and
  multiplier; states: hover/picked (gold border), win (green), lose (55% opacity), disabled when closed.
- **Bet slip / liquidity slip** (`.slip`, `.seedslip`): amount chips (`.chips button.on`), a number input with an
  `aria-label`, and one primary action. Both share a per-market submit guard. While pending, submit has
  `disabled` and `aria-busy="true"`, with `Pari en cours…` / `Placing bet…` or `Ajout en cours…` /
  `Adding liquidity…`. Amount, outcome and slip-switch controls are disabled; amount controls and primary
  buttons use 0.4 opacity. Success closes the slip; rejection keeps it editable for retry. The guard resets in
  `finally`.
- **Buttons**: `.primary` (filled light, gold on hover; `.blue` variant for liquidity), `.ghost` (outlined),
  `.link` (underlined text action). One primary per group.
- **Cards** (`.card`): join form, player card (balance in `DotText`, claim, copy key, my bets), leaderboard,
  how-it-works.
- **Toast** (`.toast` inside a persistent `role="status"` region): success closes after 3.5 s; errors (coral) stay
  until dismissed with their button.
- **Warning** (`.warn`, coral outline): shown when the game state cannot be refreshed.
- Focus: `:focus-visible` draws a 2px gold outline, offset 2px (0 on inputs).
- Motion: wheel spin and LED blink run only under `prefers-reduced-motion: no-preference`; outcome share bars
  transition `width` 0.4s.

## Do's and Don'ts

- Do reuse the tokens; add a role token in `:root` before introducing a new color.
- Do keep sentences in `--sans`, data in `--mono`, headings in `--cond`, and stay on the six sizes above.
- Do write copy in both `fr` and `en` in `app/components/i18n.ts`; never hard-code UI text.
- Do show a status as live only through `displayStatus`/`isLive`; never render "Live" from a cached value.
- Don't uppercase or track text with CSS, and don't put a small label above a heading.
- Don't add shadows to cards; depth comes from tone and borders.
- New page recipe: wrap it in `.page`, start with the `.top` header, use `.card` sections with `h3` titles,
  `.primary` for the single main action, `.row` for button groups, and the 900px breakpoint for one column.
