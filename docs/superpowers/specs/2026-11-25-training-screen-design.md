# Training screen (#381, part 3)

Issue #381, sub-project 3 of 6 (order in
`2026-11-25-app-shell-and-visual-refresh-design.md`). Parts 1 (shell, Ocean,
Inter) and 2 (Today) are on main. This spec restyles the training screen
(`/training`) to the Ocean style and fixes what the ux-designer audit of
2026-11-25 found. The scope is **restyle and fix** (owner, 2026-11-25): the
frame's structure, the drills' behaviour and the states stay as
`docs/design/training-screen.md` describes them, except where this spec
says otherwise. No new training capability.

## Audit findings this spec answers

From the ux-designer audit (390x844, 375x667, 1280x800 and 1440x900, both
themes, persona u1400):

1. The typed-move field takes the phone panel's best space; on 375x667 it
   pushes Hint behind the bottom bar, and tapping it opens the keyboard over
   the board.
2. The counter changes under the player (0/9, 1/9, 2/10, 3/11) and the
   header ends at 13/13 while Done says 9 reviewed.
3. Every session from Today is titled "Several repertoires"; what is being
   trained is only a small subtitle.
4. Done does not read as an ending: flat on the page, 60% empty on a phone,
   two equal outline buttons, and a learn pass's Done uses review wording.
5. Feedback is too short and weak: "correct" lasts 400ms, a wrong move is
   gone from the board at once, the lapse arrow is thin and translucent.
6. The desktop panel is half empty, the move list spreads White's and
   Black's moves 150px apart, and at 1440 the block sits left of centre with
   the board capped at 680px.
7. The phone's line so far is clipped mid-move at the left edge.
8. The side-to-move dot inverts between themes.
9. "Nothing due" is weaker than Today's hero card saying the same thing.
10. Board coordinates sit under the pieces and vanish on the dimmed board.
11. A used Hint button still looks tappable.

And the owner's own finding: the check and cross badges on the board are
deep and saturated, out of tune with the pastel Ocean UI.

Not in scope: the `next dev` reload loop on `/training`, added to #382.

## Rulings applied

New, given by the owner in this brainstorm (recorded in
`docs/owner-rulings.md`):

- **R-223:** The counter counts moves, not answers. "3 / 9" is the moves
  finished (answered, with no repeat owed) of the moves the session holds;
  that total is fixed when the session starts. The session size (R-62)
  counts moves; repeats (R-78) come on top and never push a move out.
  Amends R-78's "these repeats count toward the session size".
- **R-224:** The header names the session ("Today's review", "Learn new
  moves") and, under it, the current item's repertoire, side and chapter. A
  session scoped to one repertoire is titled by that repertoire. Refines
  R-207.

Unchanged and applied: R-22, R-54, R-59 (replay the arrow move after a
lapse), R-60 (sync banner), R-61 (hint counts as a lapse), R-62 (session
size, Continue, daily limit), R-78 (repeats until it sticks, apart from the
size), R-142, R-143, R-144, R-145, R-146, R-174 (coach note holds the
drill, Next), R-205 (arrows setting), R-207, R-217 (English, catalogue),
R-218 (a drill runs full-screen without the tabs), R-219, R-220.

## The review counter (R-223)

### Chess (`packages/chess/src/training/review-session.ts`)

- `ReviewBounds.size` is the number of **first asks** (moves) the session
  takes. `room` becomes `size - order-asked-so-far`: repeats no longer use
  it. The session's moves are therefore the first `size` items of the
  queue's order (fewer when the queue is shorter), fixed at the start.
- A repeat (R-78) is still asked when its step runs out, however many there
  are; the session ends when no first ask and no repeat is left.
- `reviewProgress` returns `{ done, total }` where `total` is the number of
  moves the session holds (`min(size, order.length)`) and `done` is the
  moves with an outcome, not owed a repeat and not being asked again now.
  `done` never goes down; `total` never changes within a session.
- The panel's "Again" pill reads the current item's existing `repeat`
  flag (`ReviewItemView.repeat`).
- `reviewCounts` is unchanged (first answers only); Done's "reviewed" now
  equals the header's total when the session runs to the end.
- Continue (R-62) starts a new session over the rebuilt queue with a new
  fixed total, as today.

Tests: property tests (fast-check) that `total` is constant across any
sequence of answers, hints and lapses; that `done` is monotonic and ends
equal to `total`; that no first ask is dropped by a lapse; that repeats are
still asked until they stick. The existing R-78 tests that assert a repeat
takes a slot change to the new rule.

### Learn pass

`learnCounts` already counts planned new moves learned of a fixed plan; it
stays.

## The header (R-224)

The top bar shows:

- **Title:** the session's name: "Today's review" for a review over every
  repertoire, "Learn new moves" for a learn pass over every repertoire, or
  the repertoire's name for a session scoped to one.
- **Context line** (muted, `text-sm`, one line, truncates): the current
  item's repertoire name, its side and its chapter, as
  "Caro-Kann (Black) · Main line". For a scoped session the repertoire is
  already the title, so the line is the side and chapter. With no current
  item (an empty state, Done), there is no context line.
- The same title and context line at every width (one `h1`): the
  desktop eyebrow variant in the brainstorm mockup was dropped while
  planning, so a phone and a desktop read alike.

The chapter label is the repertoire page's (`chapterLabelOf`, R-158,
R-216): the server adds `chapterTitles: Record<chapterId, string>` to each
`TrainingData` entry, and the drill reads the current item's chapter from
its line (`LineTo.chapterId`). The `title.mixed` key ("Several
repertoires") is removed.

## Layout and style

The frame's grid (`frame-classes.ts`), its tree order and its keyboard
order stay. Changes:

### Top bar and progress

- Back is the shell's icon button (44px target, chevron, labelled "Back"),
  on desktop too (today an underlined text link in the card).
- The counter is `text-base`, semibold, tabular, "3 / 9" at every width.
  The mode word before it on desktop ("Review") goes: the title says it.
- The progress bar is Today's 6px rounded track (`border` track, `accent`
  fill), with gutters on a phone.

### Panel (both drills)

- Prompt: the side-to-move dot and words, then the ask ("Your move", "Play
  the arrow move", "Now without the arrow") in `text-lg` bold.
- The side-to-move dot uses fixed colours in both themes: White a white
  disc with a `#141a26` ring, Black a `#141a26` disc with a `#cfd5df` ring.
- Buttons: Hint and Type are **tonal** buttons (`accent-subtle` fill,
  `accent` text, as Today's row buttons), a new `TONAL_BUTTON` in
  `buttons.ts`. A used or unavailable Hint is visibly disabled (50% opacity,
  `cursor-not-allowed`), not only `aria-disabled`.
- A repeat's existing "again" status ("Once more: you missed this move
  earlier.") becomes a `due-subtle` / `due` pill, like the result pills
  below.
- Coach note (R-174): a soft card (`accent-subtle` background, no border,
  `rounded-card`) with the eyebrow "Coach note".
- Two-answers notice and the sync banner keep their content; the notice
  becomes the same soft card style, the banner stays as specified (R-60).
- End session moves from an outline button to a quiet text button
  (`QUIET_BUTTON` weight but `text-base font-semibold`, 44px), so it does
  not compete with the drill. Next (R-174) stays primary.

### Typed move on phones (owner, 2026-11-25)

Below `lg`, the move field is hidden behind a **Type** tonal button
(keyboard icon and the word) next to Hint. Pressing it shows the field in
place and moves focus into it; the field closes after a move is accepted
or on Escape, and focus returns to the Type button. At `lg` and up (and `tall`)
the field is always shown, as now. Screen-reader users reach it through
the button, which is in the tab order after the board.

### Line so far

- Phone: the line wraps (no sideways scroll) and shows at most the last
  six full moves; when earlier moves exist it starts with "…" and a move
  number, never mid-move. The full line is in the accessible text.
- Desktop: the move list's columns are fixed (`2.5rem 5rem 5rem`), so a
  move pair reads as one row.

### Desktop width

- The board's cap rises from 42.5rem to 50rem, so a 1440x900 screen gets
  a larger board (the height rule still wins on shorter screens).
- The board and card block is centred in the viewport at every width from
  `lg`.
- The panel's spare height goes to the move list (as now); with the
  prompt, buttons and context the card no longer reads as empty.

### Board

- **Move badges (owner choice D):** a filled glyph (lichess's shape, from
  `chessground/src/glyph.ts`), no white ring, a soft drop shadow
  (`0 1px 3px rgb(0 0 0 / 0.45)`), the badge about 38% of the square over
  its top-right corner. Colours `--color-board-badge-correct: #279257` and
  `--color-board-badge-wrong: #d65a50` (white glyph 3.9:1, above the 3:1
  non-text minimum). The square flash drops to 30% of the same colours
  (`--color-board-correct`, `--color-board-wrong`).
- **Coordinates:** smaller (`10px`, semibold), tucked into the square's
  corner with a 2px inset, so they read at the piece's edge rather than
  under it; on the dimmed board they keep the board's opacity (no further
  fade).
- **Lapse arrow:** thicker and opaque (`--color-board-arrow` alpha 0.8 to
  0.95, chessground line width up by about half).

### Feedback timing

- `--duration-feedback` and `FEEDBACK_MS` go from 400ms to **700ms**: the
  correct flash and badge, and the hold before the next item.
- After a lapse, the wrong move **stays on the board** with its cross badge
  for 700ms, then the piece goes back and the arrow appears (R-59). Input is
  locked during those 700ms.
- The panel shows results as tinted pills with an icon: Correct
  (`success-subtle` / `success`), Not this move, play the arrow move
  (`error-subtle` / `error`, stays until the move is played), Move the
  highlighted piece (`due-subtle` / `due`). The live region is unchanged.
- Reduced motion: the durations stay (they are holds, not motion); the
  piece slide is already instant.

## States

### Done

- The summary is a card (`bg-surface`, shadow, `rounded-card`) at the top
  of the panel, with a success tick in a `success-subtle` circle, "Session
  done" (`text-2xl`), the stats, the day line and the repertoire bar, as
  today.
- Stats labels: review "reviewed", "first try" (was "correct"), "lapses";
  learn "learned" (unchanged).
- A learn pass's Done no longer says "Today's review is done": it shows
  the moves still due when there are any, else only the next review time.
  A review's Done keeps its text.
- The bottom bar has **one primary** next step, the first that applies:
  Continue (the queue has more, R-62), Start review (moves due now, after a
  learn pass), Learn new moves (today's allowance has room), else Done.
  The labels stay as today.
  Done is a quiet button when another action is primary. On a phone the
  primary is full width with Done under it.
- On a phone the board stays hidden (as now); on desktop it stays beside
  the card, dimmed.

### Nothing due

The panel shows the same accent hero card as Today's `learn` and `done`
states (`TodayHero`'s look, not its component): the eyebrow "Today's
review" (or the repertoire), "Nothing due now.", the next review time, and
the inverted "Learn N new moves" button when there are new moves. On a
phone the dimmed start board shrinks to a strip (40% of its height,
cropped) so the card is in view; on desktop the dimmed board stays.
"No moves", "limit reached" and "nothing left" use the same card in its
plain (`bg-surface`) form with their existing text and buttons.

### Loading and error

Loading keeps its skeleton, restyled to the new top bar and track. The
error state keeps its behaviour; its panel content becomes a plain card.

## Architecture

| Unit | Change |
| --- | --- |
| `packages/chess/src/training/review-session.ts` | size counts first asks; `reviewProgress` counts finished moves of a fixed total |
| `apps/web/src/server/training*.ts` and `lib/training-data.ts` | each entry carries `chapterTitles` |
| `training-screen.tsx` | `title` and `context` from the scope and the current item (`sessionHeader`, a pure function in `session-header.ts`, tested) |
| `training-frame.tsx`, `frame-classes.ts` | icon Back, title and context line, counter, 6px track, centring, board cap |
| `drill-panel.tsx` | dot colours, "Again" pill, result pills, phone line (`phoneLine`, pure, tested), move list columns |
| `move-entry.tsx` (new) | the Type button and the field on phones, the field alone at `lg` |
| `done-summary.tsx` | card, labels, learn day line, `primaryAction` (pure, tested) choosing the one primary |
| `empty-panel.tsx` | hero card for nothing due, plain card for the rest |
| `buttons.ts` | `TONAL_BUTTON`; End session's quiet style |
| `board/board.css`, `tokens.css` | badges, flash alpha, coordinates, arrow |
| `drill-input.ts` | `FEEDBACK_MS` 700; the lapse hold |
| catalogue | new keys (Type, side words, first try, coach-note eyebrow); `title.learn` reads "Learn new moves"; `title.mixed` and the `mode.*` counter prefix removed |
| `docs/design/training-screen.md` | updated to this spec (sketches, feedback table, states) |

## Testing

- Chess: the property and example tests above for R-223.
- Web unit: `sessionHeader`, `phoneLine`, `primaryAction`; component tests
  for the Type button (opens, focuses, closes after a move, Escape), the
  disabled Hint, the Again pill, the Done primary in each case, the
  nothing-due hero.
- E2E: the review and learn journeys updated for the new header text, the
  Type button on Pixel 7, and the counter staying fixed across a lapse.
- Contrast: the new badge colours, the tonal and pill colours in both
  themes added to the contrast test.
- ux-designer sign-off at 390, 375x667, 1280 and 1440, light and dark,
  every state above.

## Error handling

- An item whose chapter has no title in `chapterTitles` (a race with an
  edit): the context line shows the repertoire and side only.
- A session whose queue is shorter than the size: the total is the queue's
  length, as now.
