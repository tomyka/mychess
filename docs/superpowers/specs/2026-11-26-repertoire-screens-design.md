# Repertoire screens (#381, part 4)

Issue #381, sub-project 4 of 6 (order in
`2026-11-25-app-shell-and-visual-refresh-design.md`). Parts 1 (shell, Ocean,
Inter), 2 (Today) and 3 (training) are on main. This spec restyles My
repertoires (`/repertoires`), the repertoire page (`/repertoires/[id]`,
browse and builder), the assigned repertoire (`/repertoires/assigned/[id]`)
and PGN import (`/repertoires/import`) to the Ocean style, and fixes what
the ux-designer audit of 2026-11-26 found. The scope is **restyle and fix**
(owner, 2026-11-26): the screens keep their capabilities and the behaviour
`docs/design/repertoire-screen.md` describes, except where this spec says
otherwise. The one addition is showing training progress the app already
computes (R-225).

## Audit findings this spec answers

From the ux-designer audit (390x844, 375x667, 1280x800, 1440x900, both
themes; personas 1400-2000, u1400, 2000plus, coach):

1. Phone: the panel under the fixed board gets 286px (124px at 375x667) and
   one scroller holds everything: train buttons, chapters, intro, comment,
   note, training rows, move list, actions, share, assign.
2. Phone: stepping to a move scrolls its chip into view and pushes that
   move's comment (above the list) off screen.
3. The "I know this / learn again" control is a bare check-circle whose
   meaning is only in its accessible name; sighted players read it as done.
4. No training progress on these screens; Learn (0) and Review (0) are live
   links.
5. Phone: the top-bar name is clamped to one line and loses what tells
   repertoires apart.
6. Desktop: the header row lines up with nothing; a long name wraps the
   actions; the delete confirmation pushes the board down.
7. Desktop: the board is 552px at 1280x800 (150px of header above it); the
   phone board leaves a 6px strip.
8. The move list: 44px chips at every width, no White/Black columns,
   variations break the main line, a click scrolls the whole page.
9. The Edit switch is unlabelled on phone and far from the board on desktop.
10. The chapter disclosure is open by default on desktop, repeats the
    current title, scrolls inside the panel's scroller, and in Edit mode its
    icons squeeze titles to 3-4 lines.
11. Assigned: Pause, Download PGN and Make my own copy are three
    unexplained identical buttons; header Learn (10) differs from the
    chapters' 9 + 7; the phone top bar crams name, coach and deadline.
12. Coach: My repertoires does not show assignments; each assignee on the
    repertoire page takes about 280px with no progress.
13. Import, "Add to an existing one": the preview card is empty; the
    disabled Import button looks enabled.
14. Import: the stats are five pill-like tiles; positions repeat moves; the
    name is not suggested from the file.
15. Dark: the White and Black king icons on My repertoires swap.
16. Dark: red and blue draw swatches barely show; the share status looks
    like an input.
17. An empty repertoire shows Review (0), Learn (0) and Download PGN.
18. Delete looks like the routine actions.
19. My repertoires: own, assigned and fork cards carry different facts and
    look alike; the always-open create form weighs as much as the list.
20. Board coordinates are tiny and low-contrast.

Plus part 1's deferred item: the desktop repertoire header row does not line
up with the board and panel (finding 6).

Not in scope: move states in the move list (owner left it out); the
assigned view's changes-since-last-visit summary (unchanged); the `next dev`
reload loop (#382).

## Rulings applied

New, given by the owner in this brainstorm (recorded in
`docs/owner-rulings.md`):

- **R-225:** The repertoire screens show training progress in the R-177
  meaning: learned % on every My repertoires card, learned % and due count
  on each chapter row of the repertoire page, and, for the coach, each
  assigned player's learned % on the repertoire's Repertoire screen. Move
  states are not shown in the move list.
- **R-226:** The repertoire page's panel is for studying. Rename, Download
  PGN, Add from PGN, share, assign, pause, make my own copy and delete live
  on a separate Repertoire screen opened from the page's header, on phone and
  desktop alike.
- **R-227:** "I know this" is one labelled control under the move list
  that offers this move, this line and this chapter for the current
  position, each with its move count; chapter rows carry progress only.
  Refines R-58 and R-147 (the confirmation with the count stays).

Unchanged and applied: R-56/R-178/R-182 (Mastered), R-58, R-62 (daily new
limit), R-129/R-181, R-147, R-151, R-152, R-155 (a fork shows the coach no
progress), R-156, R-158 (chapter titles never clamped), R-177, R-206 (learn
one chosen chapter or line), R-217, R-218, R-219, R-220, R-221, R-222.

## My repertoires (`/repertoires`)

- **Header:** `PageHeader` title "My repertoires" with two buttons at its
  right: **Import PGN** (secondary) and **New** (primary). New opens the
  create form inline under the header, pushing the list down; its Cancel
  closes it. The form, its refusals and "a new repertoire opens in builder
  mode" stay as they are. An account with no repertoire at all sees the
  form open and the empty line above it.
- **Groups:** White and Black, as now (two columns from `sm`). The group
  icons are fixed glyphs that do not follow the text colour: White a white
  king with a `#141a26` outline, Black a `#141a26` king, in both themes
  (the training dot's colours).
- **One card for every kind** (own, assigned, fork):
  - name, `text-base` semibold, clamped to two lines, full name in `title`
    and the accessible name;
  - a tag after the name: **Assigned** (assigned), **Own copy** (fork),
    none for own; plus the existing Overdue and Paused pills;
  - one meta line: own and fork: "N chapters · N moves · changed <date>";
    assigned: "<coach> · due <date> · N chapters · N moves" ("no deadline"
    when it has none); a fork adds
    "Copy of <coach>'s repertoire" at the end of the meta line;
  - Today's `LearnedBar` (6px track), then "64% learned · 3 due", "New · N
    moves" when no move is started, the Mastered pill when mastered (R-178). The due count only
    when above zero.
- The whole card stays the link. Coach: an own card that is assigned to
  players adds "Assigned to N" to its meta line.
- Progress comes from the same read Today uses (training snapshot and
  `progressOf` / `percentLearned` in `@mychess/chess`), per repertoire.

## The repertoire page (`/repertoires/[id]`)

Phone keeps the fixed region (top bar, board, board row never scroll) and
the scrolling panel; desktop keeps the sticky board beside the panel.

### Header

- **Phone top bar:** one row above the board: back (44x44), the name
  (`text-base` semibold, never clamped: it wraps in full, so what tells two
  repertoires apart always shows), the **Edit** toggle (a labelled switch:
  the word "Edit" and the switch, one control), and a 44x44 **More** icon
  button (vertical dots, accessible name "Repertoire options") that opens
  the Repertoire screen.
- **Desktop:** no page header row above the board. The panel's first rows
  are back / Edit / More, then the name on its own full-width row,
  unclamped; their top is level with the board's top edge. The board takes
  the viewport height (`min(100dvh - app bar - gutters, panel column's
  space)`), so at 1280x800 it is at least 640px.
- **Board height on a phone:** the board gives up height before the panel
  (a container-query cap; the panel keeps at least 16.5rem: the board row,
  a one-line comment and the scroller), so a long name shrinks the board,
  not the panel, and the board never resizes while stepping. At 375x667 the
  summary, the chapter line and the first move row show (sign-off,
  2026-11-26; values in `docs/design/repertoire-screen.md`). On a phone
  this page's top bar has no account menu, so the name has the width.
- **Summary row**, first in the panel's scroller (after the board row and
  the comment strip, before the chapter line), at every width, one compact
  row: the learned share ("16% learned", "New · N moves" when nothing is
  started, or the Mastered pill), then **Review N** and **Learn N today** as small tonal
  buttons. A button whose count is zero is not rendered; Learn's N is what
  the daily limit allows today (R-62). Side and chapter count are not
  repeated (the board's orientation and "Ch n/m" show them). No summary row
  in builder mode or for an empty repertoire.
- **Assigned status strip** (assigned view only), the summary's second
  line: "<coach> · due <date> · in N days" (or the Overdue pill; "due today"
  on the day), and the Paused pill when paused. No urgency colour before the
  deadline.

### Chapter line

- Closed by default at every width: "Ch 2/6 · <chapter label>", one line,
  truncating, the full label in the accessible name. Opening it lists the
  chapters inline, pushing the panel down; no inner scroller (the panel
  scrolls). Choosing one selects it and closes the list (focus returns to
  the line).
- **Chapter rows:** the title (wraps in full, R-158), then a `LearnedBar`
  and "64% learned · 4 due" / "New · 18 moves" / the Mastered pill (the
  same words as the cards). No icons in browse
  mode. The current chapter's row is highlighted.

### Comment strip

The current move's comment, or the chapter intro at the root, sits in a
fixed strip between the board row and the panel's scroller at every width
(one place in the page order, so reading and Tab order match what is seen):
`accent-subtle` background with a 2px `accent` left edge in dark, the move
("5... Qc7") in semibold, then the text. Two lines, then "More" expands it
inline. No strip when there is no comment. Coach notes (assigned view)
keep their place under the comment, unchanged.

### Move list

- Numbered, two columns: number, White's move, Black's move; a line that
  starts with Black's move shows "n. ..." in White's column. Moves are
  numbered from the chapter root, as everywhere else on the page: a
  position key keeps no move counter (Q27), so a Black-first chapter starts
  at "1. ...".
- Variations: indented with the left rule, written inline ("6. f4 a6 7.
  Nxc6 bxc6"), each move still its own focusable chip; the main line
  continues after the variation in the same columns.
- Chips: compact (28px) on desktop, `min-h-touch` on phone. Own-side moves
  stay bold, the comment glyph stays, the current chip stays the accent
  fill.
- Selecting a move scrolls only its own scroller, never the page: the
  panel on a phone; on desktop the move list keeps its own box (at most
  half the viewport high, as since #331) so the comment strip and the
  summary above it stay in view while stepping.

### Train here (browse)

Under the move list:

- **Learn this line (N)** and **Learn this chapter (N)** (R-206), tonal,
  each shown only when N > 0.
- **I know this** (R-227): a labelled button with a chevron; open, it lists
  inline "This move, 5... Qc7", "This line, N moves", "This chapter, N
  moves", each with **Mark known** or, when already known, "Known" and
  **Learn again**. The line and chapter choices keep the R-147 confirmation
  with the move count. "This move" appears only on an own-side move.
- My note follows, unchanged.

### Empty repertoire

The empty message and **Add from PGN** first; no summary buttons, no Train
here, no Download (finding 17).

### Builder (Edit mode)

The same layout. Train here and the progress (summary %, chapter bars) are
replaced by the builder's own controls, unchanged in behaviour (remove
move, draw colours, comments). Chapter rename and delete move into the open
chapter row (shown only for the selected chapter, under its title), so
titles do not squeeze. Draw swatches get an inset `border-strong` ring
that passes 3:1 against the dark panel (3.55:1), so the board's arrow
colours stay as they are; the contrast is recorded in
`docs/design/README.md`.

### Board

The training board's coordinate fix (part 3: readable size and contrast,
off the pieces) is reused. On phone the board is the full viewport width.

## The Repertoire screen (`/repertoires/[id]/manage`, `/repertoires/assigned/[id]/manage`)

A page under the repertoire, `PageHeader` with the repertoire as its parent,
one content column. Sections as `SECTION` cards:

- **Own repertoire:** Rename (inline field, as today), Download PGN, Add
  from PGN; **Share with a coach** with its status as plain text ("Not
  shared", "Shared with 1 coach"); then **Delete repertoire** in a separate
  danger section (error-tone heading and button), with the existing
  two-step confirmation inline.
- **Assigned repertoire:** Pause (or Resume), Download PGN, Make my own
  copy, each with one muted line saying what it does (catalogue keys).
- **Coach, own repertoire assigned to players:** an **Assigned to**
  section: one compact row per player: name, `LearnedBar` with % (R-177;
  a fork shows the coach's forked badge, "Made their own copy", and no %,
  R-155; the player's own card calls the same thing "Own copy"), deadline
  or "No
  deadline", and **Change**, which opens deadline / clear / unassign inline
  in that row. The assign form (choose players or a group) stays, under the
  rows.

Refusals and outcomes use the screen's `StatusLine`. After delete, the
player lands on My repertoires as today.

## PGN import (`/repertoires/import`)

- **Preview stats:** one plain line, "6 chapters · 13 lines · 123 moves · 1
  transposition" (positions dropped). Not tiles.
- **Name prefill:** the Event tag when every game shares one (a blank or
  "?" Event counts as none), otherwise the file name without its
  extension, cut to the name maximum; decided in `packages/chess`. It
  replaces the field only while the field still holds the last
  suggestion, so a typed name is never overwritten; the existing name
  refusals apply.
- **Add to an existing one:** the file summary (step 2) is shown in this
  mode too.
- **Disabled primary buttons** everywhere: muted text on the sunken
  surface at full opacity (5.34:1 light, 7.66:1 dark, so a pending label
  keeps 4.5:1), `cursor-not-allowed`, a change to `PRIMARY_BUTTON`'s
  disabled state in `buttons.ts`.
- Kept: numbered steps, side detection, the collapsed step 1, the sticky
  Import bar on phone, full chapter titles, "All N games are valid".

## Testing

- Component tests: card (own, assigned, fork, zero/learned/mastered),
  summary line (hidden zero buttons, "Learn N today"), status strip
  (in N days, today, overdue, paused), chapter rows with progress, comment
  strip (expand), move list columns (Black-first line, variation inline,
  main line resumes), Train here and I know this (own-side only "This
  move", known state, confirm), assignee rows (fork without %), import
  stats line and name prefill.
- db tests for any new per-chapter and per-assignee progress read, with the
  access rules of Q26 (a coach reads only assigned or shared moves, R-156).
- E2E: journeys that rename, delete, share, assign, unassign, pause and copy
  now go through the Repertoire screen; a phone journey checks the comment
  strip stays visible while stepping.
- ux-designer sign-off at 390x844, 375x667, 1280x800 and 1440x900 in light
  and dark; contrast notes in `docs/design/README.md`;
  `docs/design/repertoire-screen.md` updated to the new layout.

## Acceptance

- Every audit finding above is answered as this spec says, at phone and
  desktop width in both themes.
- R-225 to R-227 are in `docs/owner-rulings.md`.
- Gate green, E2E green on desktop and Pixel 7, ux-designer signed off.
