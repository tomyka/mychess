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
| The sheet over its `scrim` (2026-11-27, #381 part 5; `Sheet`'s `::backdrop`): the sheet's `surface` against the scrimmed `bg` / scrimmed `surface`. Not text and not a control state, so no AA minimum; the sheet reads by its place (bottom edge on a phone, centred from `md`), its rounded top, its heading and the dimmed page. In dark the scrim cannot lift it further (`surface` on pure black is 1.27), only an edge can | 2.70 / 2.52 | 1.19 / 1.16 |
| The selected radio card (2026-11-27, #381 part 5, dark finding 15): the `accent` ring on `surface`; the `accent-subtle` fill against `surface` (a tint, not the signal: the ring and the checked radio carry the state) | 5.82; 1.17 | 7.33; 1.11 |
| Coach screens (2026-11-27, #381 part 5): Needs attention's 3px edges on `surface`, `error` / `due` / idle `border-strong` (graphic, 3:1) | 6.54 / 5.86 / 3.70 | 7.40 / 8.49 / 3.55 |
| Coach screens: the due count (`due`) on `surface`; the Done pill (`success` on `success-subtle`); the Overdue pill (`error` on `error-subtle`); `fg-muted` in the comment strip (`accent-subtle`) | 5.86; 5.29; 5.58; 5.38 | 8.49; 6.87; 6.98; 6.01 |

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

### Coach screens (#381 part 5), 2026-11-27

Production build of 910e9a13, persona seeds, coach Rimantas; 390x844,
375x667, 1280x800 and 1440x900, light and dark, plus 640x400 (1280 at
200%). Spec `docs/superpowers/specs/2026-11-27-coach-screens-design.md`.

**Signed off, except finding 16** (fix 1 below, which blocks). Fixes 2 to 5
are small and may follow.

Measured: dashboard player rows 65 / 65 / 70px on a phone (about 64
budgeted); group page Progress at y = 144 at both phone widths (budget 140
to 160; 273 before); group grid player column 170px at 1280; shared
repertoire at 375x667 with the comment and the note strip: scroller 155px
(budget 155), 3 whole move rows, board 252px; at 390x844 4 rows, board
390px; the note strip 44px; the desktop note card heading at y = 361 at
1280x800, beside the board (finding 6); the new invite link at y = 395 to
439 inside the sheet at 375x667 (finding 11); no sideways scroll at 200%.
Focus is visible on every control (the stretched row and card links ring
the whole card); focus stays in the sheets (initial focus on the note's
textarea); DOM order matches the visual order.

Findings 1 to 13, 15 and 17 pass. Fails and fixes (component code,
`web-dev`):

1. **Finding 16, desktop shared repertoire still scrolls:** 876px at the
   chapter root, 1006 with a commented move selected, 1112 with the note
   editor open (1280x800); 1054 at 1440x900. The owner's page also scrolls
   (840). Cause: the panel grows with its content and the move list is
   capped at `50dvh` (`MOVES_BOX`, `repertoire-view/repertoire-panel.tsx`)
   rather than taking the room left. Fix: from `lg`, give the frame's grid
   a fixed height (`lg:h-[calc(100dvh-var(--shell-chrome,0px))]` on `GRID`
   in `repertoire-view/repertoire-frame.tsx`, the card's rows then
   `auto_minmax(0,1fr)`), make `PANEL_CELL` `lg:min-h-0 lg:overflow-hidden`
   and the move box `lg:min-h-40 lg:flex-1 lg:overflow-y-auto` without the
   `50dvh` cap. The board is sticky meanwhile, so it never leaves the
   screen; the spec's "no page scroll" is what fails.
2. **My repertoires, the coach's forked "Naidorfo variantas":** off Today
   (teaching material) and without a bar, but its card has no "Assigned to
   1", while its Repertoire screen lists Dovydas ("Own copy"). The count
   (`assignedCounts`) and the teaching test (`assignedByAccount`) in
   `apps/web/src/server/repertoires.ts` disagree; count a forked
   assignment as an assignee, as the Repertoire screen does.
3. **Group page, phone cards:** the player name link is 24px tall
   (touch target 44px). Give it `min-h-touch` with `inline-flex
   items-center`, or stretch it over the card's name row.
4. **Group grid (desktop):** the player and Last trained cells sit at the
   top while the progress cell's 44px link centres its content, so a row
   reads about 10px out of line. Align the row's cells to the middle
   (`align-middle`), or the link to the start.
5. **Invite a player sheet:** after Create link, Create link stays the
   primary button under the new link, so Copy (secondary) competes with
   making a second link. Make Create link secondary once a link is shown.

Not failing, noted: the sheet's edge in dark is 1.19:1 against the
scrimmed page (see Contrast; a `border-t border-card-edge` on `Sheet` in
`apps/web/src/app/sheet.tsx` would draw it); a fork's title in `text-2xl`
takes four lines at 390 on its progress page; the Change panel's
date label reads "Dec 20, 2026" (the app's `MEDIUM_DATE`) beside the
native field, which follows the browser's locale.

### Secondary screens (#381 part 6), 2026-11-28

Dev server on bcd755c4 with `FIDE_DUMP_FIXTURE_DIR` (the E2E broadcast
fixture), persona seeds (Gabija with two coaches, the coach Rimantas) and
three throwaway accounts (deleted afterwards); 390x844, 375x667, 1280x800
and 1440x900, light and dark, plus 640x400 (1280 at 200%). Spec
`docs/superpowers/specs/2026-11-28-secondary-screens-design.md`.

**Signed off.** All 32 findings in scope pass (17 and 31 are out of scope
or kept). Fixes 1 to 3 below were found at sign-off, applied, and
rechecked the same day.

Measured: Settings 2,206px tall on a phone and 2,118 on desktop (2,530
before), My coaches heading at y = 611 at 390 (1,116 before), Training Save
at y = 509 at 390x844, above the tab bar; one secondary Save per card, 72px
wide, "Saved" beside it; desktop text field 360px, number fields 128px;
Unlink and Leave group in the error tone (#B3261E light, #FF8A80 dark),
right-aligned on desktop, full rows on a phone; `#coaches` reached from the
account menu lands 16px under the top bar (72 at 1280, bar 56). The back
link follows `?from=` (Today, Repertoires, Opponents, Coach). The Opponents
field error sits 8px under the field (y = 296 under 244 + 44 at 390). The
welcome card does not move when the delete sheet opens (h1 at 107 / 227 /
245 before and after). Two open invites read 15:08 and 15:09, and only one
Revoke confirmation is ever open. The linked notice's Dismiss is 93x44. No
sideways scroll at 200%. Focus is visible on every control (2px outline);
the delete dialog keeps focus inside and gives it back to "Delete account…"
on Escape.

Fixes (component code, `web-dev`), applied and rechecked at 390 and 1280,
light and dark:

1. **Opponents results, the Drew label** had no fill, where Won and Lost are
   tinted pills. Now the neutral pill (`bg-sunken`, `text-fg-muted`). It
   reads in dark as a darker well: fill against the card 1.15:1 (Won 1.19,
   Lost 1.06), text 7.66:1; light: fill 1.18:1 (Won 1.16), text 5.34:1.
2. **Quiet full-row actions** (Unlink and Leave group on a phone, "Delete
   account…" at every width) started their text 12px in from the card's
   content edge. Now pulled out by their padding (`-mx-3`, width
   `calc(100% + 1.5rem)`; the right-aligned desktop variant ends at the
   content edge): text at x = 33 at 390, as the headings, with a 44px tall
   hit area from 21 to 369; at 1280 "Delete account…" starts at 377, as the
   headings, and Unlink and Leave group end at 903, the content edge, as
   Connect Lichess does. No sideways scroll.
3. **Loading skeletons** (read from code; the dev server does not show
   them): Settings drew four blocks of 192/160/128/128px for five cards of
   about 470/varies/400/170/220px, Opponents one 144px card for an uncarded
   form and a 100px empty-state card. Now five Settings blocks (about
   `h-[29rem]`, `h-40`, `h-96`, `h-44`, `h-56`) and, on Opponents, a
   field-sized block and an `h-24` card; checked against the change
   summary, not on screen.

Not failing, noted: reloading `/settings#coaches` scrolls to the section
only some of the time on desktop (the streamed page arrives after the
browser's anchor jump; the menu link always works); the phone 404 has no
top bar, so no account menu (the tabs and Go to Today remain); the delete
dialog's first focus is the "download your data" link rather than the name
field; the desktop entry frame sits about 18vh from the top rather than
centred, so the group invite card reaches the bottom edge at 1280x800
(Accept stays in view).
