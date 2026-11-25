# Training screen

The screen where a Player drills a Repertoire: a review session of Due
Moves, and the Learn pass for new Moves (arrows, then a blind retest, R-22).
Free play (R-22) reuses the same frame with a different panel and gets its
own note when it is built. Vocabulary is from `docs/CONTEXT.md`; tokens from
`apps/web/src/app/tokens.css` (see `README.md`).

## What the screen must do

- Show the position, the side to move and what is asked ("your move", or
  "play the arrow move" in the Learn pass).
- Take the player's move in one action (tap piece, tap square; or drag) and
  answer at once on the board.
- Play the opponent's reply automatically, then prompt again.
- Show session progress (done / total) and the line so far.
- Let the player leave at any time.

## Phone, 390px (designed first)

A drill runs full-screen, without the app's tabs (R-218).

```
+--------------------------------------+  390 x 844
| [<] Today's review            3 / 9  |  top bar, 56px; back = 44x44 icon
|     Caro-Kann (Black) · Main line    |  context line, text-sm fg-muted
|  [=========--------------------]     |  6px rounded track, gutters
+--------------------------------------+
|                                      |
|                                      |
|            B O A R D                 |  full width, 390 x 390,
|         8 x 48.75px squares          |  no side gutter, radius 0
|                                      |
|                                      |
+--------------------------------------+
|  (o) Black to move                   |  side-to-move dot + words, text-sm
|  Your move                           |  the ask, text-lg bold
|  [ Hint ] [ (kbd) Type ]             |  tonal buttons (accent-subtle)
|                                      |
|  … 4. Nc3 dxe4 5. Nxe4 Bf5 6. Ng3    |  line so far, text-sm, wraps;
|  Bg6 7. h4 h6 8. Nf3 Nd7 9. h5       |  last six full moves, from a
|                                      |  move number after "…"
+--------------------------------------+
|  End session                         |  bottom bar, quiet text button,
+--------------------------------------+  44px, safe-area inset
```

- The board is the first thing under the top bar and never scrolls off on a
  390 x 664 viewport or taller. Below that height the panel scrolls, the
  board does not.
- Squares are 48.75px, above the 44px target. At 320px wide they shrink to
  40px; tap-tap still works there, which is the accepted floor.
- **Title and context line (R-224).** The title (`text-lg`, semibold; `text-xl`
  on desktop) names the session: "Today's review", "Learn new moves", or the
  repertoire's name for a session scoped to one. Under it one muted
  `text-sm` line names the item being asked: its repertoire, side and
  chapter ("Caro-Kann (Black) · Main line"); in a scoped session only the
  side and chapter. The line is a row of parts: the repertoire name and the
  chapter each cut short with an ellipsis, the side never, so all three
  stay in view; a screen reader hears the whole line once (an `sr-only`
  copy). With no item (an empty state, Done) there is no context line. A
  chapter with no title yet shows the repertoire and side only. The same
  `h1` and line at every width.
- **Counter (R-223).** "3 / 9" in `text-base`, semibold, tabular: the moves
  finished of the moves the session holds. The total is fixed when the
  session starts and never moves; a repeat (R-78) is asked on top of it.
  No mode word before it: the title says what the session is.
- **Progress** is Today's track: 6px, `rounded-pill`, `border` track,
  `accent` fill, with the gutters on a phone.
- **Typed move.** Below `lg` the move field waits behind the **Type** button
  (keyboard icon and the word), so it neither takes the panel's room nor
  opens the phone keyboard over the board (see Keyboard below).
- **Line so far.** On a phone it wraps (no sideways scroll) and keeps the
  last six full moves; when earlier moves exist it starts "…" and a move
  number, never mid-move. The whole line is in the accessible text.
- Nothing overlays the board (no banners, toasts or dialogs). Messages go in
  the panel.

## Desktop, 1280px

```
+------------------------------------------------------------------------------+
|                                                                              |
|   +--------------------------------------+  +----------------------------+   |
|   |                                      |  | [<] Today's review   3 / 9 |   |  title text-xl
|   |                                      |  |     Caro-Kann (Black) · M… |   |  context, text-sm
|   |                                      |  | [=========---------------] |   |  6px track
|   |            B O A R D                 |  | (o) Black to move          |   |
|   |     largest square that fits:        |  | Your move                  |   |  text-lg bold
|   |     min(100dvh - 4rem, 50rem,        |  | [ Type a move       ][->]  |   |  field always shown
|   |         100vw - panel - 6rem)        |  | [ Hint ]                   |   |  tonal
|   |     = 736px at 1280 x 800            |  |                            |   |
|   |     = 800px at 1440 x 900            |  | 1.   e4     c6             |   |  move list, columns
|   |                                      |  | 2.   d4     d5             |   |  2.5rem 5rem 5rem,
|   |                                      |  | 3.   e5     Bf5            |   |  tabular
|   |                                      |  |                            |   |
|   |                                      |  | End session                |   |  quiet text button
|   +--------------------------------------+  +----------------------------+   |
|                                           32  <------- panel ------->        |
+------------------------------------------------------------------------------+
```

- Board and card are centred as one block at every width from `lg`; the
  board's cap is 50rem, so 1440 x 900 gets an 800px board (the height rule
  still wins on shorter screens). The card (`w-panel`, `bg-surface`,
  `rounded-card`, `shadow-card`) is the board's height; the move list takes
  its spare height and scrolls inside itself.
- Back is the same 44px icon button as on the phone, inside the card. It
  is the shell's back button (`BACK_BUTTON`, shared with the page header):
  an `accent` chevron with round caps, `sunken` on hover, `-ml-2` so the
  chevron lines up with the gutter.
- Between 640 and 1024px the panel moves under the board, as on the phone,
  but the board is capped at the viewport height minus the top bar.

## Portrait tablet, 1024 x 1366 (#334)

A screen 1024px or wider held upright (`tall:` in `tokens.css`: width at
least 64rem and portrait). Side by side, the board fitted at 568px and the
lower half of the screen was empty; stacked, it is 880px.

```
+--------------------------------------------------+  1024 x 1366
|  < Back  Katalonų pradžia          Review 0 / 20 |  top bar as one row
|  [=========-----------------------------------]  |  progress
|  +--------------------------------------------+  |
|  |                                            |  |
|  |               B O A R D                    |  |  min(100vw - 4rem,
|  |      880px at 1024 x 1366                  |  |      100dvh - 30rem)
|  |                                            |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  | ( ) White to move                          |  |  the card: panel and
|  | Your move                                  |  |  bottom bar, as wide
|  | [ Type a move           ][>]  [Hint]       |  |  as the board; the
|  | 12. Na3  Bf5 ...                           |  |  panel takes what is
|  | [ End session ]                            |  |  left (about 15rem)
|  +--------------------------------------------+  |  and scrolls inside
+--------------------------------------------------+
```

- One grid column of the board's width, centred, with `gutter-wide`
  padding; rows: top bar, board, panel, bottom bar. The tree order is
  unchanged, so Tab still goes back link, board, panel, bottom bar.
- The 30rem reserve is the padding, top bar, gaps, about 15rem of panel
  and the bottom bar. On 768-1023px portrait tablets the 640-1024 rule
  above still applies (board full width); phones and landscape screens are
  unchanged.

## Panel (both drills)

- **Prompt:** the side-to-move dot and its words (`text-sm`, `fg-muted`),
  then the ask in `text-lg` bold: "Your move", "Play the move the arrow
  shows", "Now without the arrow".
- **Side-to-move dot:** fixed colours in both themes, like the board: White
  a white disc (`side-white`) ringed `side-black` (#141a26), Black a
  `side-black` disc ringed `side-ring` (#cfd5df). The words carry the
  meaning; the dot never inverts with the theme.
- **Hint and Type** are tonal buttons (`TONAL_BUTTON`: `accent-subtle`
  fill, `accent` text, 44px). A used or unavailable Hint is visibly
  disabled: 50% opacity and `cursor-not-allowed`, not only `aria-disabled`.
- **Repeat (R-78):** "Once more: you missed this move earlier." is a
  `due-subtle` / `due` pill in place of the plain prompt.
- **Coach note (R-174)** keeps its own card (`CoachNoteCard`, as on the
  repertoire page) and holds the drill: the move field and Hint go, Next
  (primary) joins End session in the bottom bar.
- **Two-answers notice (R-54):** a soft card, `accent-subtle`, `rounded-card`,
  `text-sm`. The sync banner stays as in Error case 2.
- **End session** is a quiet text button (`QUIET_ACTION`: `fg-muted`,
  `text-base` semibold, 44px), so it does not compete with the drill.

## Move feedback (both widths)

| Moment | Board | Panel |
| --- | --- | --- |
| Waiting for the move | last move highlighted (`board-last-move`) | prompt |
| Piece selected | `board-selected` on the square, `board-target` dots on legal squares | unchanged |
| Correct | piece lands, `board-correct` flash (30%) on the target square and the check badge, both for `duration-feedback` (700ms); the next item waits the same 700ms | "Correct" as a `success-subtle` / `success` pill with a tick |
| Opponent replies | reply slides in (`duration-move`); input locked meanwhile | "Opponent played ..." over the prompt; move appended to the line |
| Lapse (wrong move) | the wrong move **stays on the board** for 700ms with the `board-wrong` flash and the cross badge, input locked; then the piece goes back and the expected move shows as a `board-arrow` | "Not that move. Play the move the arrow shows." as an `error-subtle` / `error` pill with a cross; it stays until the move is played (R-59). The side to move stays the asked side through the hold |
| Hint (review, R-61) | `board-hint` amber ring with a `board-hint-edge` inner edge on the piece to move | "Hint: move the highlighted piece." as a `due-subtle` / `due` pill; Hint disabled |
| Learn pass, shown | expected move as a `board-arrow` | "Play the move the arrow shows" |
| Learn pass, blind retest | no arrow | "Now without the arrow" |

The 700ms are holds, not motion, so reduced motion keeps them; the piece
slide is already instant there.

**Badges (owner choice D).** A filled glyph in lichess's shape, white on a
solid disc, about 38% of the square over its top-right corner, no white
ring, a soft drop shadow (`0 1px 3px rgb(0 0 0 / 0.45)`). The discs are
`board-badge-correct` #279257 and `board-badge-wrong` #d65a50, the same in
both themes like the board, not the theme's `success` / `error` (which turn
light in dark mode); the white glyph is 3.9:1 on both, above the 3:1
non-text minimum. The square flashes are the same colours at 30%
(`board-correct`, `board-wrong`).

**Arrow.** `board-arrow` at 0.95 alpha and about half again chessground's
line width, with the shapes layer at full opacity (chessground's own CSS
fades it to 0.6), so the lapse and learn arrows read at a glance.

**Coordinates.** 10px semibold, tucked 2px into the square's corner (ranks
on the right edge, files on the bottom), so they sit at the piece's edge
rather than under it; on the dimmed board they take the board's opacity
and no further fade.

Colour is never the only signal: correct and lapse also carry a badge on
the square and a pill with an icon and words in the panel, and the status
line is an `aria-live="polite"` region so screen readers hear each result
and the opponent's reply.

## States

### Loading

```
+--------------------------------------+
| [<]  ░░░░░░░░░░░░             ░░░░   |
+--------------------------------------+
|                                      |
|   empty board: board-light /         |  the real board, no pieces,
|   board-dark squares, no pieces      |  so nothing shifts when the
|                                      |  position arrives
+--------------------------------------+
|  ░░░░░░░░░░░░░░░░                    |  skeleton lines, bg-sunken
|  ░░░░░░░░░░                          |
+--------------------------------------+
```

No spinner over the board. If loading passes about one second, a single
"loading" line (text-sm, `fg-muted`) replaces the first skeleton line.
Desktop: the same, board left, skeleton panel right. The skeleton top bar
has the drill's header geometry (title and context line skeletons, the 6px
track and the gap under it on a phone), so the board does not move when
the drill arrives.

### Empty: nothing due

```
+--------------------------------------+
| [<] Today's review                   |  no counter, no context line
+--------------------------------------+
|  ░░ start position, dimmed ░░░░░░░░  |  a strip: the player's two back
|  ░░ (cropped, not squashed) ░░░░░░░  |  ranks (aspect 4/1), not focusable
+--------------------------------------+
|  +--------------------------------+  |
|  | Nothing due now                |  |  the accent hero card, as
|  | Next review: tomorrow at 09:00 |  |  Today's: bg-accent,
|  |                                |  |  text-accent-fg, shadow-card,
|  | [ Learn 8 new moves ]          |  |  text-xl heading; the button
|  +--------------------------------+  |  inverted (surface on accent),
|                                      |  only if to-learn > 0
+--------------------------------------+
```

- Nothing due is the same accent hero card as Today's learn and done
  states (`TodayHero`'s look, not its component; `HERO_PRIMARY_BUTTON`).
  The top bar's title already names the session, so the card carries no
  eyebrow. The time is in the user's time zone.
- On a phone the dimmed start board shrinks to a strip of exactly two
  ranks (4:1), anchored to the bottom so it shows the player's own back
  ranks; the board inside stays square and is clipped, so the card is in
  view. On desktop
  the dimmed board stays whole beside the card.
- **No moves**, **limit reached** and **nothing left** use the same card in
  its plain form (`CARD`: `bg-surface`, `rounded-card`, shadow) with their
  existing text and buttons. A Repertoire with no own-side Moves offers the
  repertoire page or PGN import (an assigned one only the way back).

### Error

Two cases, both in the panel, never over the board:

1. **The session could not load.** Board as in Loading, the panel shows a
   plain card with an `error` icon, one line of what failed, and
   `[ Try again ]` (accent) plus `[ Back ]`. Focus moves to the message.
2. **A result could not be saved yet** (R-60). The result waits in the
   browser's queue, which retries in the background, and the drill goes
   on. A quiet banner at the top of the panel (`bg-sunken`, `border`, a
   clock icon; not `error`, since nothing is lost or blocked) says how many
   results are not saved yet (`text-sm`, so the banner stays one row with
   its button and the prompt stays in view) and offers `[ Try now ]`
   (secondary). Its line is a `role="status"` region, always present and empty while every result
   is saved, so a screen reader hears it when results start to wait. Focus
   does not move. The banner goes when the queue is empty.

### Done

```
+--------------------------------------+
| [<] Today's review           9 / 9   |
| [==============================]     |
+--------------------------------------+
|  +--------------------------------+  |  a card: bg-surface,
|  |             ( v )              |  |  shadow-card, rounded-card;
|  |                                |  |  tick in a success-subtle circle
|  |         Session done           |  |  text-2xl bold; focus moves here
|  |                                |  |
|  |     9         7         2      |  |  text-4xl numbers:
|  |  reviewed  first try  lapses   |  |  fg / success / error
|  |                                |  |
|  |    Today's review is done.     |  |  day line (review only)
|  |  Next review: tomorrow at 09:00|  |  fg-muted
|  |  [====learned====|=due=|------]|  |  repertoire bar:
|  | 142 learned · 6 due · 18 to... |  |  learned / due / to-learn
|  +--------------------------------+  |
+--------------------------------------+
|  [        Learn new moves         ]  |  one primary, full width
|  Done                                |  quiet, under it
+--------------------------------------+
```

- **One primary next step**, the first that applies: Continue (the queue
  has more, R-62), Start review (moves due now, after a learn pass), Learn
  new moves (today's allowance has room), else Done. Any other next step
  offered is tonal; Done is a quiet text button whenever another step is
  primary. On a phone the primary is full width and the rest wrap under
  it; on desktop they share a row.
- **Stats:** a review shows "reviewed", "first try" and "lapses" (first
  answers only, so "reviewed" equals the counter's total when the session
  runs to the end); a learn pass shows "learned".
- **Day line:** after a review, the moves still due, else "Today's review is
  done." and the next review time. After a learn pass never the review
  wording: the moves still due when there are any, else only the next
  review time.
- On the phone the summary replaces the board (it has nothing left to show).
  On desktop the board keeps the final position, dimmed, beside the card.

## Keyboard and screen readers

- The board is one tab stop. Inside it the arrow keys move a cursor
  (`board-focus` outline, inset so it stays inside the square), Enter or
  Space picks up the piece and again drops it, Escape cancels.
- A move can also be typed: a text field in the panel takes SAN or
  coordinates (`Nf3`, `g1f3`). It is the fastest path for keyboard users
  and the fallback for screen readers.
  - At `lg` and up (and on a `tall` portrait tablet) the field is always
    shown, above Hint.
  - Below `lg` it waits behind the **Type** button (tonal, keyboard icon and
    the word, `aria-expanded`), next to Hint and in the tab order after the
    board. Type is a toggle: pressing it shows the field in place, above
    the buttons, and moves focus into it; pressing it again closes the
    field. The field also closes after a move is taken, or on Escape, and
    focus returns to the Type button.
- Each square has an accessible name ("e4, white knight"); the side to move
  and each result are announced through the live region.
- Focus never jumps after a move: it stays on the board (or, for a typed
  move on a phone, goes back to Type as above). It moves only for the
  Error and Done states, to their heading.
- Tab follows the screen at both widths: the back button, the board, then
  every panel button and "End session", in visual order.

## Behaviour decided by the owner (#233)

1. **After a lapse** (R-59): the expected move is shown with an arrow and the
   player must play it before the drill continues.
2. **Failed save** (R-60): results queue locally and retry in the background;
   the drill continues and a banner shows unsynced results (Error case 2
   above).
3. **Hint button** (R-61): review has one; it highlights the piece to move and
   counts as a lapse.
4. **Session size** (R-62): 20 Due Moves by default (player setting 10-100),
   with "continue"; new moves have a separate daily limit (default 10). The
   "12 / 20" counter uses that known total.
5. **The counter counts moves** (R-223, #381): "3 / 9" is the moves finished
   (answered, with no repeat owed) of the moves the session holds. The total
   is fixed when the session starts and never changes; the session size
   counts moves, and repeats (R-78) come on top and never push a move out.
   Continue starts a new session with a new fixed total.
6. **The header names the session** (R-224, #381): the title is "Today's
   review", "Learn new moves", or the repertoire's name for a session
   scoped to one; under it the current item's repertoire, side and chapter
   (the side and chapter only in a scoped session).

> Note (2026-11-25): Lithuanian language support was dropped (R-217, #378). References here to Lithuanian copy, `glossary-lt.md`, the i18n-content role or R-180 are historical.
