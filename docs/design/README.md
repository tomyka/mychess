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
5. **Lithuanian first.** LT is the default locale (R-1). Design every label
   for LT length, then check EN (see below).
6. **Tokens only.** Colours, radii, type sizes and the named spacings come
   from `apps/web/src/app/tokens.css`. A raw hex value or a Tailwind palette
   colour (`bg-blue-600`) in a component is a review finding.
7. **Accessible by default.** WCAG 2.2 AA: text contrast >= 4.5:1, control
   and focus contrast >= 3:1, touch targets >= 44px (`h-touch`,
   `min-w-touch`), visible focus everywhere, the board and drills fully
   usable from the keyboard, motion off under `prefers-reduced-motion`.

## Lithuanian text length

Lithuanian runs roughly 20-40% longer than English and has long compound
words that do not break (opening names, verb forms). So:

- No fixed widths on anything holding text: buttons, chips, tabs and badges
  size to content and may wrap to two lines on a phone.
- Never truncate a label with an ellipsis on a primary action. Long
  secondary text (an opening name in a list) may clamp to two lines, with the
  full text available on focus or tap.
- Leave 40% headroom over the English string when sizing a component; check
  the LT screenshot first in every sign-off.
- Diacritics (ą č ę ė į š ų ū ž) need the full line height; do not set
  `leading-none` on text that can contain them.
- Numbers and dates are formatted by locale (`Intl`), never by hand.
- Copy itself comes from `i18n-content`; design notes show layout, not final
  wording.

## Tokens

All tokens are in `apps/web/src/app/tokens.css` (imported by `globals.css`)
inside Tailwind 4's `@theme`, so each one is also a utility class.

| Group | Tokens (utility examples) | Use |
| --- | --- | --- |
| Surfaces | `bg`, `surface`, `sunken`, `border`, `border-strong` (`bg-surface`, `border-border`) | page, cards, wells; `border` is also the progress-bar track; `border-strong` for inputs (3:1) |
| Text | `fg`, `fg-muted` (`text-fg-muted`) | body, secondary |
| Interactive | `accent`, `accent-fg`, `focus` | primary buttons, links, focus ring |
| States | `success`, `error`, `due`, `learned`, each with `-subtle`, plus `on-state` and `skipped` (a bar segment only) | see below |
| Board | `board-light`, `board-dark`, `board-last-move`, `board-selected`, `board-target`, `board-check`, `board-arrow`, `board-correct`, `board-wrong`, `board-badge-{correct,wrong,glyph}`, `board-focus`, `board-hint`, `board-hint-edge`, `board-mark-{green,red,yellow,blue}` | the board only; a separate `@theme static` block |
| Piece glyphs | `piece-white`, `piece-black`, `piece-outline` (`fill-piece-white`, `stroke-piece-outline`) | a side's king off the board (Mano repertuarai headings): the fill is the side's colour in both themes, the outline follows the theme |
| Type | `font-sans`, `font-mono`, `text-xs` ... `text-4xl` | system UI stack, 12-36px |
| Spacing | 4px scale, plus `touch` (44px), `gutter` (16px), `gutter-wide` (32px), `panel` (360px) | `min-h-touch`, `px-gutter`, `w-panel` |
| Radii | `control`, `card`, `board`, `pill` | `rounded-control`, ... |
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
a future theme switch) overrides it. Tailwind's `dark:` variant follows the
same rule, but prefer tokens: a component should need no `dark:` class.

### Contrast (checked 2026-10-16)

| Pair | Light | Dark |
| --- | --- | --- |
| `fg` on `bg` / `surface` | 15.9 / 17.4 | 15.5 / 14.1 |
| `fg-muted` on `bg` / `surface` | 6.7 / 7.3 | 7.5 / 6.9 |
| `accent` on `bg`; `accent-fg` on `accent` | 6.2; 6.8 | 8.0; 7.8 |
| `success` / `error` / `due` / `learned` on `bg` | 5.6 / 6.0 / 5.4 / 6.4 | 8.9 / 8.1 / 9.3 / 8.5 |
| each state on its `-subtle` | 5.2 - 5.9 | 6.9 - 7.3 |
| `on-state` on each solid state | 5.9 - 6.9 | 8.2 - 9.4 |
| `border-strong` on `bg` / `surface` | 3.3 / 3.6 | 3.5 / 3.2 |
| `border` (bar track) on `bg` / `surface` (2026-10-27) | 1.4 / 1.5 | 1.7 / 1.5 |
| `skipped` on `border`; on `learned` (2026-10-27; bar segments, the counts carry the meaning) | 1.8; 2.6 | 2.1; 2.4 |
| `board-focus` on light / dark square | 9.0 / 3.9 | 7.2 / 3.2 |
| `board-mark-green` / `-red` / `-blue` on light square | 4.1 / 6.7 / 8.6 | 3.3 / 5.4 / 6.9 |
| `board-mark-yellow` on light square | 1.8 | 1.5 |
| `piece-outline` on `bg` (king glyph, 2026-10-18) | 19.0 | 15.5 |
| `board-badge-glyph` on `board-badge-correct` / `-wrong` (2026-10-26; static, both themes) | 6.1 / 6.5 | 6.1 / 6.5 |
| `board-hint-edge` on light / dark square (2026-10-26; static, both themes; the amber `board-hint` ring alone is 1.0 - 2.2, a hue cue only) | 10.7 / 4.7 | 8.6 / 3.8 |
| `board-hint` on `board-hint-edge` | 8.2 | 8.2 |

Board coordinates (opposite square colour on a square, about 2.3:1), the
mark colours on dark squares (1.2 - 3.8) and yellow marks are supplementary,
as on every chess site; the move list and the screen-reader labels (which
list each move's arrows and circles) carry the same information.

## Sign-off

For every visible change: screenshots at 390px and 1280px, LT and EN, light
and dark (8 per screen), plus a keyboard pass and a 200% zoom check. The
report lists what matches the screen note, what does not, and the fix.
