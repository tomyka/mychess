# Design

How mychess looks and behaves. Owned by the `ux-designer` role
(`docs/agent-team.md`). Screen notes live next to this file, one per screen
(`training-screen.md`, `repertoire-screen.md`, ...); the lead attaches the
relevant note to a slice plan, `web-dev` builds from it, and `ux-designer`
signs off the result with screenshots.

## References

- **chessbook.com**: the board fills the screen; a review session is a run of
  single moves with no dialog between them; the due count is the headline.
- **chessreps.com**: calm, uncluttered drill screen; the opening name and the
  line so far sit quietly beside the board, never over it.
- **openingtree.com**: the repertoire as a tree you can read; statistics as
  compact bars, not tables.

We take the feel, not the pixels: no copied layouts, colours or assets.

## Principles

1. **The board dominates.** On a phone the board is full width and nothing
   above it scrolls it off screen. On desktop it takes the largest square that
   fits the viewport height; everything else is a side panel.
2. **One move, one action.** In a drill the player makes their move (tap the
   piece then the square, or drag) and the app answers at once: feedback on
   the square, the opponent's reply, the next prompt. No "Next" button between
   moves, no modal on a correct move.
3. **Progress reads at a glance.** Due, learned and to-learn are three
   numbers and a bar, in the same three colours everywhere (`due`, `learned`,
   neutral). A player should know whether to train today without reading a
   sentence.
4. **Mobile-first.** Design at 390px first, then widen (ruling R-7). Primary
   actions sit in the thumb zone (bottom of the screen on a phone). Installable
   as a PWA, so no layout may depend on browser chrome.
5. **Text can grow.** The site is English only for now (R-217), but labels
   must not depend on their English length (see below).
6. **Tokens only.** Colours, radii, type sizes and the named spacings come
   from `apps/web/src/app/tokens.css`. A raw hex value or a Tailwind palette
   colour (`bg-blue-600`) in a component is a review finding.
7. **Accessible by default.** WCAG 2.2 AA: text contrast >= 4.5:1, control
   and focus contrast >= 3:1, touch targets >= 44px (`h-touch`,
   `min-w-touch`), visible focus everywhere, the board and drills fully
   usable from the keyboard, motion off under `prefers-reduced-motion`.

## Shell

Every signed-in page but training sits in one frame (R-218, #381; spec
`docs/superpowers/specs/2026-11-25-app-shell-and-visual-refresh-design.md`).
The code is in `apps/web/src/app/shell/`.

- **Tabs:** Today (`/`), Repertoires, Opponents (`/fide`), and Coach for an
  account with the coach capability. One `<nav aria-label="Main">`: fixed to
  the bottom of a phone over the home indicator's inset, centred in the
  sticky top bar from `md` (768px). The current tab has `aria-current`.
  Today carries an amber `due` badge (99+ above 99); its accessible name is
  "Today, N due".
- **Account menu:** the avatar (initials on `accent-subtle`) opens a
  disclosure with the name, Settings, My coaches, the theme switch (System /
  Light / Dark, kept in the `theme` cookie so the first paint is right) and
  Sign out.
- **Top row on a phone:** wordmark and avatar on a tab's own page only. An
  inner page's `PageHeader` (back arrow to an explicit parent, "Back to
  Repertoires", plus the title and the avatar) is its only top row; board
  pages keep their compact header so the board stays high.
- **Focus mode:** `/training` has no shell. Sign-in, welcome and invite
  pages have none either.
- **Width:** list and form pages use `CONTENT` (`max-w-content`, 1040px,
  `apps/web/src/app/surfaces.ts`); board pages use the full width.
  `--shell-chrome` (set on `#content`) is the height the shell takes, so a
  full-height page sizes itself with `calc(100dvh - var(--shell-chrome))`.
- **Cards:** `CARD`: `shadow-card` lifts them; the `card-edge` hairline shows
  only in dark, where shadows do not read.

## Today

The Today tab (`/`, #381 part 2, R-221, R-222; spec
`docs/superpowers/specs/2026-11-25-today-design.md`). The code is in
`apps/web/src/app/today/`.

- **Phone (below `md`):** one column: the muted greeting line, the hero
  card, the "My repertoires" card, then "Copies you can keep" when there is
  any offer. The page's `h1` ("Today") is visually hidden; the hero's count
  is the visual headline.
- **Desktop (`md` and up):** inside `CONTENT`, the greeting over a two
  column grid, about 40 / 60. Left: the hero, the offers card right under
  it (the first grid row is the hero's height, `grid-rows-[auto_1fr]`, so a
  long list never pushes the offers down). Right: the list. Top aligned,
  nothing sticky. In the `empty` state the hero stands alone in the left
  column.
- **Hero card ("Today's review"):** an `accent` card with `accent-fg` text;
  the `h2` stays "Today's review" in every state (R-148).

  | State | When | Shows | Buttons |
  | --- | --- | --- | --- |
  | `due` | due > 0 | "N due" (`text-4xl`), "about N min" | Start review; Learn N new moves (secondary) when any |
  | `learn` | nothing due, new moves left today | "Nothing due now.", the next review time | Learn N new moves |
  | `done` | nothing due, no new moves today | "All done for today", the next review time | none |
  | `empty` | no trained repertoire | the welcome line | Create a repertoire; Import a PGN (secondary) |

  Buttons on the card: the main one inverted (`surface` fill, `accent`
  text), the second outlined (`accent-fg` border and text, no fill); both
  44px and with an `accent-fg` focus ring, as the page's `focus` ring is the
  card's own colour.
- **Row anatomy (one per trained repertoire, own and assigned, paused
  included):** the name as an `accent` underlined link (wraps, never
  truncates; its hit area reaches 44px) to the repertoire, or the assigned
  repertoire page; the side, muted, beside it; for an assignment the
  `AssignmentFacts` (assigned by, deadline, Overdue / Paused / Updated
  badges); the learned bar (`learned` on the `border` track, decorative,
  `aria-hidden`) and "N% learned" (`fg-muted`, R-177), then the Mastered
  badge (R-178); no bar or percentage for a repertoire without own moves.
  On the right, the row's action, a secondary `accent-subtle` button at
  least 44px: "Review N" when due, else "Learn" when it can learn today,
  else none (a paused assignment never has one). It is described by the
  row's name, so it reads "Review 8, Sicilian Najdorf". Rows are divided by
  `border` hairlines; due rows come first (R-207), then the R-145 order.
- **Copies you can keep:** `ForkOffers` in a `CARD`; Keep a copy (primary)
  and No, thanks (secondary).
- **Keyboard order:** the shell, the hero's buttons, each row's name then
  its button, the offers. On desktop the offers come after the list though
  they sit under the hero: the DOM follows the phone's reading order.

## Text length

- No fixed widths on anything holding text: buttons, chips, tabs and badges
  size to content and may wrap to two lines on a phone.
- Never truncate a label with an ellipsis on a primary action. Long
  secondary text (an opening name in a list) may clamp to two lines, with the
  full text available on focus or tap.
- Names may carry diacritics (ą č ę ė į š ų ū ž); do not set `leading-none`
  on text that can contain them.
- Numbers and dates are formatted with `Intl`, never by hand.

## Tokens

All tokens are in `apps/web/src/app/tokens.css` (imported by `globals.css`)
inside Tailwind 4's `@theme`, so each one is also a utility class.

| Group | Tokens (utility examples) | Use |
| --- | --- | --- |
| Surfaces | `bg`, `surface`, `sunken`, `border`, `border-strong`, `card-edge` (`bg-surface`, `border-border`) | Ocean (R-220): page, cards, wells; `card-edge` is a card's hairline, transparent in light; `border` is also the progress-bar track; `border-strong` for inputs (3:1) |
| Text | `fg`, `fg-muted` (`text-fg-muted`) | body, secondary |
| Interactive | `accent`, `accent-fg`, `accent-subtle`, `focus`, `comment-edge` | primary buttons, links, focus ring; `accent-subtle` behind the avatar and a chosen option; `comment-edge` is the repertoire comment strip's 2px left edge, the accent in dark, transparent in light |
| States | `success`, `error`, `due`, `learned`, each with `-subtle`, plus `on-state` and `skipped` (a bar segment only) | see below |
| Board | `board-light`, `board-dark`, `board-last-move`, `board-selected`, `board-target`, `board-check`, `board-arrow`, `board-correct`, `board-wrong`, `board-badge-{correct,wrong,glyph}`, `board-focus`, `board-hint`, `board-hint-edge`, `board-mark-{green,red,yellow,blue}`, `board-coord-on-{light,dark}` | the board only; a separate `@theme static` block |
| Piece glyphs | `piece-white`, `piece-black`, `piece-outline` (`fill-piece-white`, `stroke-piece-outline`) | a side's king off the board (Mano repertuarai headings): the fill is the side's colour in both themes, the outline follows the theme |
| Type | `font-sans`, `font-mono`, `text-xs` ... `text-4xl` | Inter (self-hosted through next/font, R-219), then the system UI stack; 12-36px |
| Spacing, containers | 4px scale, plus `touch` (44px), `tabbar` (56px), `gutter` (16px), `gutter-wide` (32px), `panel` (360px); `container-content` (1040px) | `min-h-touch`, `px-gutter`, `w-panel` |
| Radii | `control` (12px), `card` (14px), `board` (8px), `pill` | `rounded-control`, ... |
| Elevation, motion | `shadow-card`, `shadow-sheet`, `ease-standard`, `duration-move`, `duration-feedback`, `animate-reveal-late` | `animate-reveal-late` shows a slow wait's line after about 1s by CSS alone, so it also works in a streamed loading page React never hydrates |

### Semantic states

| State | Means | Looks like |
| --- | --- | --- |
| `success` | a correct move, a saved change | green text or flash; `success-subtle` behind a message |
| `error` | a Lapse (wrong move in a drill), a failed request | red; always paired with an icon or words, never colour alone |
| `due` | Reviews whose time has come (CONTEXT.md "Due") | amber count and bar segment |
| `learned` | Moves past their Learn pass, in Review | violet count and bar segment |

To-learn Moves are the bar's grey track, `border` (not `sunken`: about
1.1:1 on the page in both themes, it would vanish), with `fg-muted` text.
The coach's four-state bar (R-151) adds `skipped` for "I know this": a
muted violet between `learned` and the track in both themes (about
1.8 - 2.1:1 to the track, 2.4 - 2.6:1 to `learned`). `learned-subtle` is
not a bar colour: it is lighter than the track in light and darker in dark,
so a skipped segment in it reads as a gap. So the segments are always
learned (violet), skipped (muted violet), due (amber) and to-learn (grey).
Colour is never the only signal: each segment also has its number and
label, and Mastered is a `success-subtle` pill with the word.

### Themes

Light and dark. Each colour token is `light-dark(<light>, <dark>)`; the theme
follows the system, and `data-theme="light"` or `"dark"` on `<html>` (set by
the account menu's theme switch) overrides it. Tailwind's `dark:` variant follows the
same rule, but prefer tokens: a component should need no `dark:` class.

### Contrast (checked 2026-10-16; Ocean values 2026-11-25)

| Pair | Light | Dark |
| --- | --- | --- |
| `fg` on `bg` / `surface` | 16.0 / 17.4 | 15.4 / 13.9 |
| `fg-muted` on `bg` / `surface` | 5.8 / 6.3 | 7.4 / 6.7 |
| `accent` on `bg`; on `accent-subtle`; `accent-fg` on `accent` | 5.3; 5.0; 5.8 | 8.1; 6.6; 8.0 |
| `success` / `error` / `due` / `learned` on `bg` | 5.6 / 6.0 / 5.4 / 6.4 | 9.1 / 8.2 / 9.4 / 8.6 |
| each state on its `-subtle` | 5.2 - 5.9 | 6.9 - 7.3 |
| `on-state` on each solid state | 5.9 - 6.9 | 8.2 - 9.4 |
| A disabled primary button (2026-11-26, #381 part 4): `fg-muted` on `sunken` at full opacity, so a pending label ("Importing") keeps 4.5:1; the `sunken` fill against `bg` / `surface` is 1.1 / 1.2 (light) and 1.0 / 1.2 (dark), so the button reads as off, which a disabled control may (WCAG 1.4.11 exempts it) | 5.34 | 7.66 |
| A disabled (pending) danger button's label, the button at 85% over `bg` / `surface` (2026-11-16; the secondary and tonal buttons fade the same way) | 5.1 / 5.0 | 6.2 / 6.2 |
| The builder's draw swatches (2026-11-26, #381 part 4): the inset 1px `border-strong` ring on the panel's `surface`; the swatch fill alone on dark `surface` is green 3.0, red 1.8, blue 1.4, yellow 6.7 (light: 5.6, 9.2, 11.8, 2.5), so the ring carries the edge; the chosen one has the 2px `fg` ring and a check | 3.70 | 3.55 |
| Today's hero (2026-11-25): main button, `accent` text on its `surface` fill; the fill against the `accent` card | 5.8; 5.8 | 7.3; 7.3 |
| Today's hero: heading and text, the secondary button's `accent-fg` outline and text, and the `accent-fg` focus ring, all on `accent` | 5.8 | 8.0 |
| Today's row button: `accent` on `accent-subtle` | 5.0 | 6.6 |
| Today's learned bar: `learned` on its `border` track (decorative; "N% learned" carries the value) | 4.7 | 5.2 |
| `border-strong` on `bg` / `surface` | 3.4 / 3.7 | 3.9 / 3.6 |
| `border` (bar track) on `bg` / `surface` (2026-11-25) | 1.4 / 1.5 | 1.7 / 1.5 |
| `skipped` on `border`; on `learned` (2026-10-27; bar segments, the counts carry the meaning) | 1.8; 2.6 | 2.1; 2.4 |
| `board-focus` on light / dark square (2026-11-25; static, both themes; dark-theme squares `#d7c2a0` / `#946f4f`) | 11.2 / 4.9 | 8.9 / 3.4 |
| `board-mark-green` / `-red` / `-blue` on light square (dark theme re-measured 2026-11-25 on `#d7c2a0`; drawn at full opacity since 2026-11-26, board.css lifting chessground's 0.6 on the shapes layer, #381) | 4.1 / 6.7 / 8.6 | 3.2 / 5.3 / 6.8 |
| `board-mark-yellow` on light square (dark theme re-measured 2026-11-25 on `#d7c2a0`) | 1.8 | 1.5 |
| `piece-outline` on `bg` (king glyph, 2026-10-18) | 19.0 | 15.5 |
| `board-badge-glyph` on `board-badge-correct` / `-wrong` (2026-11-26, owner choice D, #381; static, both themes; graphic, 3:1) | 3.9 / 3.9 | 3.9 / 3.9 |
| `board-hint-edge` on light / dark square (2026-10-26, dark theme re-measured 2026-11-25 on `#d7c2a0` / `#946f4f`; static, both themes; the amber `board-hint` ring alone is 1.0 - 2.5, a hue cue only) | 10.7 / 4.7 | 8.5 / 3.3 |
| `board-hint` on `board-hint-edge` | 8.2 | 8.2 |
| Board coordinates (2026-11-26, #381 part 4; `board.css`, bold, 0.75rem, 0.875rem from `lg`, inside the corner squares; static, both themes): `board-coord-on-light` (`#7a5232`) on a light square / `board-coord-on-dark` (`#ffffff`) on a dark square | 4.97 / 3.15 | 3.93 / 4.52 |

`apps/web/src/app/tokens.test.ts` enforces the text, control and focus
pairs above (AA, both themes) on every run, so a token change that drops
one fails the gate. The board rows are measured by hand at sign-off.

Board coordinates reach 3:1 on their square in both themes since #381
part 4 (two static colours, the squares untouched). The mark colours on
dark squares (1.2 - 3.8) and yellow marks are supplementary, as on every
chess site; the move list and the screen-reader labels (which list each
move's arrows and circles) carry the same information.

## Sign-off

For every visible change: screenshots at 390px and 1280px, light
and dark (4 per screen; English only, R-217), plus a keyboard pass and a 200% zoom check. The
report lists what matches the screen note, what does not, and the fix.
