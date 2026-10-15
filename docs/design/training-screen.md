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

```
+--------------------------------------+  390 x 844
| [<]  Sicilian, Najdorf     12 / 30   |  top bar, 56px; back = 44x44
| [=========-----------------------]   |  session progress, 4px, accent
+--------------------------------------+
|                                      |
|                                      |
|            B O A R D                 |  full width, 390 x 390,
|         8 x 48.75px squares          |  no side gutter, radius 0
|                                      |
|                                      |
|                                      |
+--------------------------------------+
|  ( ) White to move                   |  side-to-move dot + prompt,
|  Your move                           |  text-lg; 2 lines allowed (LT)
|                                      |
|  1. e4 c5 2. Nf3 d6 3. d4 cxd4 ...   |  line so far, text-sm,
|                                      |  scrolls horizontally, newest
|                                      |  move kept in view
|                                      |
+--------------------------------------+
|  [ End session ]                     |  bottom bar, thumb zone,
+--------------------------------------+  h-touch, safe-area inset
```

- The board is the first thing under the top bar and never scrolls off on a
  390 x 664 viewport or taller. Below that height the panel scrolls, the
  board does not.
- Squares are 48.75px, above the 44px target. At 320px wide they shrink to
  40px; tap-tap still works there, which is the accepted floor.
- The opening name is the Chapter's name (šachmatai.lt taxonomy, R-1); it
  clamps to one line in the top bar, full name on tap.
- Nothing overlays the board (no banners, toasts or dialogs). Messages go in
  the panel.

## Desktop, 1280px

```
+------------------------------------------------------------------------------+
| mychess                                                       [user menu]    |  app header, 56px
+------------------------------------------------------------------------------+
|                                                                              |
|    +--------------------------------------+  +--------------------------+    |
|    |                                      |  | Sicilian, Najdorf        |    |  text-xl
|    |                                      |  | Review  12 / 30          |    |
|    |                                      |  | [=========-------------] |    |
|    |                                      |  |                          |    |
|    |            B O A R D                 |  | ( ) White to move        |    |
|    |     largest square that fits:        |  | Your move                |    |  text-lg
|    |     min(100dvh - 56 - 2*32,          |  |                          |    |
|    |         100vw - panel - gutters)     |  | 1. e4    c5              |    |  move list, two
|    |     = 680px at 1280 x 800            |  | 2. Nf3   d6              |    |  columns, tabular
|    |                                      |  | 3. d4    cxd4            |    |  numbers
|    |                                      |  | 4. Nxd4  ...             |    |
|    |                                      |  |                          |    |
|    |                                      |  |                          |    |
|    |                                      |  | [ End session ]          |    |
|    +--------------------------------------+  +--------------------------+    |
|      <-------------- 680 -------------->  32  <---- panel 360 ------->       |
+------------------------------------------------------------------------------+
```

- Board and panel are centred as one block (1072px at 1280); gutters are
  `gutter-wide`. The panel (`w-panel`, `bg-surface`, `rounded-card`) is the
  board's height and scrolls inside itself.
- Between 640 and 1024px the panel moves under the board, as on the phone,
  but the board is capped at the viewport height minus the top bar.

## Move feedback (both widths)

| Moment | Board | Panel |
| --- | --- | --- |
| Waiting for the move | last move highlighted (`board-last-move`) | prompt |
| Piece selected | `board-selected` on the square, `board-target` dots on legal squares | unchanged |
| Correct | piece lands, `board-correct` flash on the target square for `duration-feedback`, check icon in the square corner | prompt changes to "correct" in `success` for the same time |
| Opponent replies | reply slides in (`duration-move`); input locked meanwhile | move appended to the line |
| Lapse (wrong move) | wrong piece snaps back, `board-wrong` flash, cross icon; then the expected move shown with a `board-arrow` | "not this move" in `error` with an icon; the player then replays the expected move (R-59) |
| Learn pass, shown | expected move as a `board-arrow` | "play the arrow move" |
| Learn pass, blind retest | no arrow | "now without the arrow" |

Colour is never the only signal: correct and lapse also carry an icon on the
square and words in the panel, and the panel line is an `aria-live="polite"`
region so screen readers hear each result and the opponent's reply.

## States

### Loading

```
+--------------------------------------+
| [<]  ░░░░░░░░░░░░          ░░ / ░░   |
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
Desktop: the same, board left, skeleton panel right.

### Empty: nothing due

```
+--------------------------------------+
| [<]  Sicilian, Najdorf               |
+--------------------------------------+
|                                      |
|   board: the Repertoire's start      |  dimmed (opacity), not
|   position, not interactive          |  focusable
|                                      |
+--------------------------------------+
|  Nothing due now                     |  text-xl
|  Next review in 3 h                  |  text-base fg-muted; time in
|                                      |  the user's time zone
|  [ Learn 8 new moves ]               |  only if to-learn > 0; accent
|  [ Free play ]                       |  secondary button
+--------------------------------------+
```

A Repertoire with no own-side Moves at all is a different empty state: the
panel says so and offers the builder or PGN import instead (wording from
i18n-content). Desktop: the same content in the side panel.

### Error

Two cases, both in the panel, never over the board:

1. **The session could not load.** Board as in Loading, panel shows an
   `error` icon, one line of what failed, and `[ Try again ]` (accent) plus
   `[ Back ]`. Focus moves to the message.
2. **A result could not be saved** (drilling is online-only, R-7). An
   `error-subtle` banner at the top of the panel says so; the drill does not
   continue until the result is saved or the player retries. See open
   question 2.

### Done

```
+--------------------------------------+
| [<]  Sicilian, Najdorf     30 / 30   |
+--------------------------------------+
|                                      |
|          Session done                |  text-2xl; focus moves here
|                                      |
|      30        27         3          |  text-4xl numbers:
|   reviewed   correct    lapses       |  fg / success / error
|                                      |
|   Next review: tomorrow 09:00        |  fg-muted
|                                      |
|   [=====learned=====|==due==|--new--]|  repertoire progress bar:
|   142 learned · 6 due · 18 to learn  |  learned / due / to-learn
|                                      |
+--------------------------------------+
|  [ Done ]        [ Learn new moves ] |  bottom bar; LT labels may
+--------------------------------------+  stack to two rows
```

On the phone the summary replaces the board (it has nothing left to show).
On desktop the board keeps the final position, dimmed, and the summary fills
the panel.

## Keyboard and screen readers

- The board is one tab stop. Inside it the arrow keys move a cursor
  (`board-focus` outline, inset so it stays inside the square), Enter or
  Space picks up the piece and again drops it, Escape cancels.
- A move can also be typed: a text field under the board (desktop: in the
  panel) takes SAN or coordinates (`Nf3`, `g1f3`). It is the fastest path for
  keyboard users and the fallback for screen readers.
- Each square has an accessible name in the current locale ("e4, white
  knight"); the side to move and each result are announced through the live
  region.
- Focus never jumps after a move: it stays on the board. It moves only for
  the Error and Done states, to their heading.
- "End session" and every panel button are reachable with Tab after the
  board, in visual order.

## Behaviour decided by the owner (#233)

1. **After a lapse** (R-59): the expected move is shown with an arrow and the
   player must play it before the drill continues.
2. **Failed save** (R-60): results queue locally and retry in the background;
   the drill continues and a banner shows unsynced results. The blocking
   error state drawn above must be redrawn as that banner.
3. **Hint button** (R-61): review has one; it highlights the piece to move and
   counts as a lapse.
4. **Session size** (R-62): 20 Due Moves by default (player setting 10-100),
   with "continue"; new moves have a separate daily limit (default 10). The
   "12 / 20" counter uses that known total.
