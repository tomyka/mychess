# Repertoire screens

The three S3 screens (#253): **Mano repertuarai** (`/repertuarai`), the
repertoire page (`/repertuarai/[id]`, browsing and builder on one page) and
the PGN import (`/repertuarai/importuoti`). Built by web-dev in Tasks 13 to 19
of `docs/superpowers/plans/2026-10-17-s3-repertoires.md`; signed off in Task
23. Vocabulary from `docs/CONTEXT.md` (Repertoire, Chapter, Move, Answer,
Line, Transposition, Comment, Personal note); tokens from
`apps/web/src/app/tokens.css` (see `README.md`); shared classes from
`apps/web/src/app/buttons.ts` (`PRIMARY_BUTTON`, `SECONDARY_BUTTON`,
`DANGER_BUTTON`), `nustatymai/styles.ts` (`SECTION`, `SECTION_TITLE`,
`TEXT_LINK`) and `status-line.tsx` (`StatusLine`).

Sketches use English placeholders; the copy comes from i18n-content (Task
20). Every label is sized for Lithuanian, which runs 20-40% longer
(`Juodaisiais`, `Atsisiųsti PGN`, `Transpozicijos`).

## Rules for all three screens

- **Nothing overlays the board** (`training-screen.md`): no menus, toasts,
  dialogs or confirmations over it. Confirmations, the promotion choice and
  every message sit in the panel, inline, pushing content down.
- **One status line per screen** (`StatusLine`, `role="status"`) for
  refusals and outcomes of board actions; on the repertoire page it sits
  under the board row and the builder row, outside the scrolling panel. Field saves (the
  comment, the personal note, a rename) have their own status line under
  the field. Refusals are catalogue keys, shown in the `error` tone with the
  words, never colour alone.
- **Touch targets** are at least 44px everywhere (`min-h-touch`,
  `min-w-touch`), including move chips in the move list, chapter rows and
  the four draw colours.
- **No fixed widths on text.** Buttons may wrap to two lines on a phone;
  primary actions never truncate. Repertoire names clamp to two lines in
  lists (one line in the phone top bar) with the full name on focus or tap
  (`title` plus the full name in the accessible name). Chapter titles are
  never clamped (R-158): a title shared with another chapter ends in what
  tells them apart, "Karo-Kano gynyba (B12, 3. e5)", and a clamp would cut
  exactly that off. They wrap in full (`break-words`), in the disclosure,
  the chapter rows, the import preview and the change summary.
- **Tokens only;** no `dark:` classes are needed on these screens.
- **Times** (last change) are formatted with `Intl` in the account's time
  zone (Europe/Vilnius by default): today as a time, this year as day and
  month, older with the year.

## 1. Mano repertuarai (`/repertuarai`)

### Phone, 390px

```
+--------------------------------------+
| < Home                               |  TEXT_LINK, 44px
| My repertoires                       |  h1 text-2xl bold
| Build your openings or import PGN.   |  intro, fg-muted, may be 2 lines
+--------------------------------------+
| (K) WHITE                            |  h2 text-lg semibold; king glyph
|  +--------------------------------+  |  aria-hidden
|  | London System                  |  |  one link per repertoire:
|  | 2 chapters · 148 moves         |  |  name text-lg semibold, clamp 2;
|  | Changed 12 Oct                 |  |  meta text-sm fg-muted
|  +--------------------------------+  |  card: bg-surface, border-border,
|  +--------------------------------+  |  rounded-card, p-4, min-h-touch
|  | Catalan                        |  |  gap-3 between cards
|  | 5 chapters · 412 moves         |  |
|  | Changed 2 Sep 2025             |  |
|  +--------------------------------+  |
|                                      |
| (k) BLACK                            |
|  No Black repertoire yet.            |  empty group: one fg-muted line
+--------------------------------------+
| New repertoire                       |  SECTION, SECTION_TITLE
| Name                                 |
| [______________________________]     |  input as NameField, min-h-touch
| Side                                 |  fieldset, two radio cards as
| [ (o) White ]  [ ( ) Black ]         |  LanguageField (grid-cols-2)
| [ Create ]                           |  PRIMARY_BUTTON, full width
| (status line: refusal)               |
|                                      |
| Have a PGN file?                     |  text-fg-muted
| [ Import PGN ]                       |  SECONDARY_BUTTON, full width
+--------------------------------------+
```

- Groups in the order White, Black; items sorted by name with
  `Intl.Collator(locale)`. The whole card is the link (one tab stop per
  repertoire); its accessible name is the repertoire name, the meta is read
  after it.
- Counts use ICU plurals (LT has three forms, `glossary-lt.md`). "Changed"
  is the repertoire's `updatedAt` (`RepertoireListItem`).
- A group with no items keeps its heading and says so in one line, so the
  player sees both sides at a glance.
- The create form is always on the page (no disclosure): creating is one
  screen, one submit. On success the page navigates to the new repertoire,
  which opens in builder mode (plan decision 18).

### Desktop, 1280px

```
+------------------------------------------------------------------------------+
|   < Home                                                                     |
|   My repertoires                                       text-3xl              |
|   Build your openings or import PGN.                                         |
|                                                                              |
|   (K) WHITE                              (k) BLACK                           |
|   +-------------------------------+      +-------------------------------+   |
|   | London System                 |      | Sicilian, Taimanov            |   |
|   | 2 chapters · 148 moves        |      | 6 chapters · 233 moves        |   |
|   | Changed 12 Oct                |      | Changed 10:42                 |   |
|   +-------------------------------+      +-------------------------------+   |
|   | Catalan ...                   |                                          |
|   +-------------------------------+                                          |
|                                                                              |
|   +-------------------------------+      +-------------------------------+   |
|   | New repertoire                |      | Import PGN                    |   |
|   | Name [__________________]     |      | Upload a PGN file and see     |   |
|   | Side [(o) White] [( ) Black]  |      | what it holds before saving.  |   |
|   | [ Create ]                    |      | [ Import PGN ]                |   |
|   +-------------------------------+      +-------------------------------+   |
+------------------------------------------------------------------------------+
     max-w-4xl, centred, px-gutter-wide; two columns, gap-8
```

- From `sm` up the two side groups sit in two columns; the create and import
  cards below them, in two columns, as `SECTION` cards. Buttons size to
  content.

### States

- **Loading** (`loading.tsx`): the header, then three card skeletons
  (`bg-sunken`, rounded-card, the card's height) per group. No spinner.
- **Empty** (no repertoire at all): the two groups collapse to one line,
  "You have no repertoires yet", and the create form and import card follow
  directly under the intro, so both are visible without scrolling on a
  390 x 664 screen.
- **Refusal** (blank or too long name): the create form's status line, the
  name field `aria-invalid` and pointed at it (`NameField` pattern); the
  typed name stays.

## 2. The repertoire page (`/repertuarai/[id]`)

One page, two modes: **browse** (default) and **builder** (a switch). A new
repertoire with no chapters opens in builder mode.

### Phone, 390px, browse

```
+--------------------------------------+  390 x 844
| [<]  London System        [Edit o ]  |  top bar 56px: back to the list
|                                      |  (44x44); name text-lg semibold,
+--------------------------------------+  1 line clamp; mode switch
|                                      |
|                                      |
|            B O A R D                 |  full width 390 x 390, radius 0,
|        White at the bottom           |  flipped for a Black repertoire;
|        (Black: Black at bottom)      |  squares 48.75px
|                                      |
|                                      |
+--------------------------------------+
| [Type a move   ][>]  [|<] [<] [>]    |  board row 56px: move field +
+--------------------------------------+  submit, then start/back/forward
|  (status line, when there is one)    |  fixed too; the panel scrolls below
|                                      |
|  Chapter 2 of 6                  [v] |  chapter disclosure, 44px+:
|  Sicilian, Taimanov: 5.Nc3           |  chapter title, wraps in full
|                                      |
|  COMMENT                             |  text-sm semibold fg-muted label
|  The main idea is ...Qc7 and ...a6,  |  comment text-base fg;
|  keeping the knight flexible.        |  at the root: the chapter intro
|                                      |
|  [lock] MY NOTE  Only you see this   |  personal note: bg-sunken well,
|  [______________________________]    |  rounded-card, p-3; textarea
|  [ Save note ]                       |  3 rows; SECONDARY_BUTTON
|                                      |
|  1. e4 c5 2. Nf3 e6 3. d4 cxd4       |  move list (see below)
|  4. Nxd4 Nc6 5. Nc3 [Qc7] 6. Be2 a6  |  [ ] = current move
|  |  6. f4 a6 7. Nxc6 bxc6            |  variation: indented, border-l
|  |  6. g3 a6 ...                     |
|                                      |
|  REPERTOIRE                          |  actions section (phone only):
|  [ Rename ]  [ Download PGN ]        |  SECONDARY_BUTTONs, wrap
|  [ Add from PGN ] [ Delete ]         |  Delete: secondary with error text;
+--------------------------------------+  confirm step uses DANGER_BUTTON
```

- **Fixed region:** the top bar, the board and the board row never scroll
  (56 + 390 + 56 = 502px); the panel below scrolls in the remaining height
  (342px on 390 x 844, 165px on 375 x 667). This keeps the board in view
  while reading comments and editing, as `training-screen.md` requires.
- **Board row:** the typed-move field (SAN or coordinates, `enterKeyHint`
  "go", `autoCapitalize="off"`, `autoCorrect="off"`, `spellCheck={false}`,
  text-base so iOS does not zoom) with a 44x44 submit button, then start,
  back and forward (44x44 icon buttons with accessible names). The nav
  buttons sit at the right edge, under the right thumb. Back and start are
  disabled at the chapter root; forward is disabled at the end of the line.
- **Chapter disclosure:** a button with `aria-expanded` showing "Chapter n
  of m" and the chapter title. Open, it lists every chapter inline, pushing
  the panel down (never over the board); choosing one selects it, closes the
  list and returns focus to the disclosure. Closed by default on a phone.
  Rows are `min-h-touch` with `py-2`, so a title that wraps to two lines
  still reads as its own row next to one-line rows; the list scrolls inside
  itself past `max-h-72`, which holds five rows with three of them wrapped.
- **Position section,** in this order:
  - at the chapter root: the chapter intro (R-66), or nothing if it has none;
  - on a move: its comment, or "No comment" in `fg-muted`;
  - for screen readers only, the move's arrows and circles as text ("arrows:
    g1 to f3 green; circles: d4 red"), so the marks are not colour-only
    (`sr-only`, read with the position section);
  - on a move: the **personal note**, always editable in both modes (R-21:
    the note is the player's own). It is visually distinct from the comment
    so nobody mistakes one for the other: `bg-sunken` well, a lock icon, the
    label "My note" and the hint "Only you see this" (the hint is the
    field's `aria-describedby`). Saving shows "Saved" in its own status
    line; an empty note deletes it. There is no note at the chapter root (a
    note belongs to a move).
- **Repertoire section** (phone only; desktop has these in the header):
  rename, download PGN (a plain `<a download>` as in settings), add from PGN
  (link to `/repertuarai/importuoti?i=<id>`), delete.

### Phone, 390px, builder

```
+--------------------------------------+
| [<]  London System        [Edit o=]  |  switch on (aria-checked="true")
+--------------------------------------+
|            B O A R D                 |  playing a move adds it
+--------------------------------------+
| [Type a move   ][>]  [|<] [<] [>]    |  board row
+--------------------------------------+
| [ Remove move ]        [ Draw ]      |  builder row 56px, fixed too:
+--------------------------------------+  remove (on a move only), draw
|  (status line)                       |  toggle (aria-pressed)
|  Chapter 1 of 2                  [v] |  open: rows with rename / delete,
|  London System: 2...Nf6              |  and [ + Add chapter ] at the end
|                                      |
|  COMMENT                             |  textarea, 4 rows, full width
|  [______________________________]    |  hint: "One paragraph; line breaks
|  [ Save comment ]                    |  become spaces" (R-105)
|  [lock] MY NOTE ...                  |  as in browse
|  1. d4 d5 2. Bf4 ...                 |  move list
|  REPERTOIRE ...                      |
+--------------------------------------+
```

- The builder row is part of the fixed region (558px; the panel keeps 286px
  on 390 x 844), so remove and draw are reachable while looking at the board.
- **Adding a move:** in builder mode the board accepts every legal move
  (tap-tap or drag). A move the chapter already has navigates to it, as in
  browse; a new move is saved, appears in the move list as the current move
  and the board stays on the new position. No toast and no "Next".
  While saving the board is not movable; the piece stays on its target
  square. If saving takes more than about one second, the status line says
  "Saving" (`info`). A refusal (a second Answer, an illegal move) shows in
  the status line and the piece goes back.
- **At an empty chapter root** the position section says "Play the first
  move on the board" instead of the intro. In a repertoire with no chapters,
  the first move played creates "Chapter 1" and adds the move to it, in one
  save; there is no separate "Add chapter" step first.
- **Chapter intros are read-only in S3:** the builder shows an imported
  intro (R-66) at the root but has no field to edit it.
- **Comment:** a textarea labelled "Comment", 4 rows, with the R-105 hint
  and, from 1,800 characters, a count "1,850 / 2,000" (`fg-muted`, `error`
  at the limit). Save sends it; "Saved" shows in its own status line.
- **Chapters in builder mode:** each chapter row gains Rename and Delete
  (44x44 icon buttons, accessible names that include the chapter title).
  Rename turns the row into a name field with Save and Cancel; Escape
  cancels. Delete turns the row into an inline confirmation, "Delete
  chapter {title}? Its moves no other chapter uses go too.", with
  [ Delete chapter ] (`DANGER_BUTTON`) and [ Cancel ]. [ + Add chapter ]
  (`SECONDARY_BUTTON`) ends the list; the new chapter is selected and the
  list closes. A built chapter's title follows R-104: "Chapter N" until its
  moves classify, then the taxonomy name; a rename makes it fixed.

#### Remove move, inline confirmation

```
+--------------------------------------+
| Remove 6...a6 and the 14 moves       |  the builder row grows to fit
| after it that only it reaches?       |  (pushes the panel down; the
| [ Remove ]   [ Cancel ]              |  board does not move)
+--------------------------------------+
```

- The count is the number of moves the remove would drop (plan Task 17).
  With a count of 0 the text drops the second clause.
- Focus moves to [ Cancel ] (the safe choice); Escape cancels and returns
  focus to [ Remove move ]. [ Remove ] is `DANGER_BUTTON`. After removal the
  board goes to the position before the removed move and the status line
  says "Removed" (`success`).

#### Draw mode (phones and keyboards)

Chessground draws only with the right mouse button or Shift, so builder mode
has a draw mode for touch and keyboard (plan decision 16).

```
+--------------------------------------+
|            B O A R D                 |  first tapped square shows
|                                      |  board-selected until the second
+--------------------------------------+
| [Type a move   ][>]  [|<] [<] [>]    |
+--------------------------------------+
| (G) (R) (Y) (B)          [ Done ]    |  builder row in draw mode: four
+--------------------------------------+  44x44 colour buttons + Done
|  Tap a square, then another for an   |  hint, first line of the panel
|  arrow; the same square twice for a  |  (info tone, not the status line)
|  circle. Tap a mark again to remove. |
```

- [ Draw ] switches the builder row to the four colours and [ Done ]; Done
  (or Escape on the board) switches back and returns focus to [ Draw ].
- **Colour buttons:** a filled swatch in the mark token (below), 44x44, in
  the PGN order green, red, yellow, blue; accessible name is the colour name;
  `aria-pressed` on the chosen one, which also shows a 2px `fg` ring and a
  check mark (not colour alone). Both widths show the swatch only, with the
  colour name as accessible name and tooltip (`title`): names beside the
  swatches wrapped the 360px desktop panel's row to three lines.
  Green is chosen when draw mode opens.
- While draw mode is on, the board takes no moves (empty dests): a tap
  chooses a square. First tap: `board-selected` on that square and the live
  region says "From e4". Second tap: a different square toggles an arrow, the
  same square toggles a circle, in the chosen colour; the same mark in
  another colour is recoloured. Each change saves at once (`setMarks`).
- At the chapter root draw is disabled, with the hint "Choose a move first:
  marks belong to a move".
- With a mouse, right-drag draws in builder mode whether or not draw mode is
  on (chessground's modifier colours); the result saves the same way.

### Desktop, 1280px (both modes)

```
+------------------------------------------------------------------------------+
|  < My repertoires                                                            |  TEXT_LINK
|  London System  [Rename] [Download PGN] [Add from PGN] [Delete]   [Edit o ]  |  h1 text-3xl;
+------------------------------------------------------------------------------+  actions wrap
|                                                                              |
|  +------------------------------------------+  +--------------------------+  |
|  |                                          |  | [Move      ][>][|<][<][>] |  |  board row
|  |                                          |  | [Remove move] [Draw]     |  |  builder only
|  |                                          |  | (status line)            |  |
|  |                                          |  | Chapter 1 of 2       [^] |  |  open by default;
|  |                                          |  |  > London System: 2..Nf6 |  |  max 5 rows tall,
|  |              B O A R D                   |  |    King's Indian Attack  |  |  scrolls inside
|  |   min(100dvh - header - 2*32,            |  |--------------------------|  |
|  |       100vw - panel - 3*32)              |  | COMMENT                  |  |
|  |   = 664px at 1280 x 800                  |  | Solid: ...e6 and ...c5.  |  |
|  |                                          |  | [lock] MY NOTE           |  |
|  |                                          |  | [______________________] |  |
|  |                                          |  | [ Save note ]            |  |
|  |                                          |  |--------------------------|  |
|  |                                          |  | 1. d4 d5 2. Bf4 Nf6      |  |  move list:
|  |                                          |  | 3. e3 [e6] 4. Nf3 c5     |  |  flex-1, scrolls
|  |                                          |  | |  3... c5 4. c3 Nc6     |  |  inside, current
|  |                                          |  |                          |  |  move kept in view
|  +------------------------------------------+  +--------------------------+  |
|    <---------------- 664 ----------------->  32  <---- panel 360 ----->      |
+------------------------------------------------------------------------------+
```

- Board and panel are centred as one block (1056px at 1280); gutters
  `gutter-wide`; the board has `rounded-board`. The panel (`w-panel`,
  `bg-surface`, `rounded-card`, `shadow-card`) is the board's height; only
  the chapter list and the move list scroll inside it, so the board row,
  the builder row and the comment stay put.
- **Header:** the back link, then the name (h1) with the four actions as
  `SECONDARY_BUTTON`s that wrap under the name when LT labels do not fit,
  and the mode switch at the right end. Rename turns the h1 into a name
  field with Save and Cancel, in place. Delete opens its two-step
  confirmation under the header row (below).
- The board row heads the panel, so the typed-move field follows the board
  in tab order at both widths (plan Task 11).
- The panel's order is the same at both widths, and the DOM follows it:
  status line, chapter disclosure, comment and note, move list. (The first
  draft put the move list above the comment on desktop with CSS `order`,
  which made Tab reach the comment before the moves, WCAG 2.4.3.) On
  desktop the move list is its own scroller (`flex-1`, at least `min-h-40`),
  so stepping scrolls the moves and the comment above them stays in view;
  the panel as a whole scrolls only when the builder's fields leave the
  list less than that.
- Draw mode on desktop: the builder row becomes the four colours, then
  Done; the hint is the first line under it.
- **640-1024px:** the panel moves under the board as on the phone; the board
  is capped at the viewport height minus the top bar.

### The move list

```
1. d4  d5  2. Bf4  Nf6  3. e3  [e6]  4. Nf3  c5
|  3... c5  4. c3  Nc6
|  |  4... Qb6  5. Qb3
4... Nc6  5. c3
```

- The chapter's tree (`chapterTree`): the main line (R-79: the first move
  added at each position) flows as inline chips; each variation is its own
  indented block (`pl-3`, `border-l border-border`) starting with its move
  number (`3...` for a Black move). Indentation stops growing after 3 levels
  (depth may reach 64); deeper levels keep the 3-level indent and their move
  numbers show where they are.
- Every move is a button chip: `min-h-touch min-w-touch`, `rounded-control`,
  `px-2`, `text-base`, `tabular-nums`. Move numbers are plain text in
  `fg-muted`. **Own-side moves** (the repertoire's Answers) are `font-semibold`,
  opponent moves regular, so the player's choices read at a glance.
- **Current move:** `bg-accent text-accent-fg`, `aria-current="true"`, and
  scrolled into view (`block: 'nearest'`) after every step.
- A move with a comment shows a small comment glyph after the SAN; a move
  with the player's personal note shows a lock glyph. Both are `aria-hidden`
  with the meaning in the chip's accessible name ("6. Be2, has a comment").
- The moves are plain buttons in reading order and Tab walks them; each
  variation block is a `<div>` with no extra role. It is not an ARIA tree
  widget (that would take the moves out of the Tab order and needs more
  than S3 needs).
- Empty chapter: "No moves yet" (browse) or "Play the first move on the
  board" (builder), `fg-muted`.

### The promotion choice

```
+--------------------------------------+
| Promote to:                          |  replaces the board row (phone)
| [ Q ] [ R ] [ B ] [ N ]   [ Cancel ] |  or the panel's board row
+--------------------------------------+  (desktop): always in view
```

- Four 56x56 buttons with the cburnett piece image of the moving side and the
  piece name as the accessible name; a `role="group"` labelled "Promote to".
  Focus moves to the queen; Escape or Cancel puts the pawn back and returns
  focus to the board. Nothing appears over the promotion square.

### Deleting the repertoire

```
| Delete London System? Its chapters, moves, comments and your  |
| notes on it are deleted. This cannot be undone.               |
| [ Delete for good ]   [ Cancel ]                              |
```

- Two steps without typing the name (plan decision 18). Inline: under the
  header row on desktop, in place of the repertoire section's buttons on the
  phone. Focus moves to Cancel; [ Delete for good ] is `DANGER_BUTTON`;
  success goes to `/repertuarai`, whose status line says the repertoire was
  deleted.

### States

| State | Board | Panel |
| --- | --- | --- |
| **Loading** (`loading.tsx`) | the real board frame with `board-light`/`board-dark` squares and no pieces, not focusable | top bar with a skeleton name; skeleton lines (`bg-sunken`) for the chapter row, comment and move list; after about 1s one "Loading" line (`text-sm fg-muted`), revealed by CSS (`animate-reveal-late`) so a first, server-streamed load shows it too; the live region gets the text from the client timer |
| **Not found** (another account's id, a bad id) | none | the app's 404 page: "This repertoire does not exist or is not yours" and a link to My repertoires. Same text for both cases (plan decision 12) |
| **Empty repertoire** (no chapters; opens in builder) | start position, movable in builder mode | "Play the first move on the board, or add games from PGN." with [ Add games from PGN ] (`SECONDARY_BUTTON`). The first move played creates "Chapter 1" on its own (R-111) and saves the move in it; the chapter disclosure then appears with that chapter selected. Draw and remove are hidden until there is a move. Browse mode shows "This repertoire has no moves yet" and offers "Switch to builder" |
| **Empty chapter** | start position (or the chapter root) | browse: "No moves yet"; builder: "Play the first move on the board" |
| **Saving** | not movable, piece on its target square | after about 1s, "Saving" in the status line (`info`) |
| **Saved** | new position, last move highlighted | the move list shows the move as current; no message for a move; "Saved" for a comment, note or rename; "Removed" for a removal |
| **Refusal** (illegal move, second Answer, name too long, ...) | piece goes back (`reset`) | the status line in `error` with the catalogue text; the board keeps focus |
| **Not in the repertoire** (browse: a move the chapter does not have) | piece goes back | status line, `info` tone: "This move is not in the chapter. Switch to builder to add it." |
| **Stale version** (`repertoire.stale`: changed in another tab) | not movable | status line in `error`: "This repertoire changed in another window. Reload to see the latest version." with [ Reload ] (`SECONDARY_BUTTON`) inside the line. Every edit control (builder row, comment save, chapter actions) is disabled until reload; browsing and the personal note stay usable. Focus moves to [ Reload ] |
| **Failed request** (network, server) | as before the action | status line in `error` with "Try again"; nothing is lost from the field being edited |

### Keyboard and screen readers

Tab order follows the visual order at both widths:

- **Phone:** back, mode switch, board, move field, submit, start, back,
  forward, [builder row], panel top to bottom.
- **Desktop:** back link, rename, download, add from PGN, delete, mode
  switch, board, move field, submit, start, back, forward, [builder row],
  status line action (Reload, when stale), chapter disclosure and list,
  comment, note, move list. The status line is only focusable when it holds
  a button, and focus moves to that button when it appears.

The board itself:

- **One tab stop** (`role="application"`, accessible name "Chess board,
  {repertoire name}, {chapter title}"). Arrow keys move the cursor
  (`board-focus`, inset 3px), relative to the board's orientation; Enter or
  Space picks up the piece under the cursor and, on a legal square, drops
  it; Escape cancels the pick-up (and, in draw mode, the first square).
- **The cursor is the board's focus indicator:** it shows whenever the board
  has keyboard focus and hides when focus leaves; on desktop the board host
  also gets the global 2px `focus` outline. On the full-width phone board
  the outline would be clipped, so the cursor alone marks focus there.
- **In draw mode** Enter or Space on a square is a tap: the same two-step
  arrow and circle choice as touch.
- **Announcements** (one polite live region for the board, the status line
  for outcomes): the cursor square and its piece ("e4, white knight"); after
  each step, the move with its number ("6. Be2") and, at a line end, "end of
  line"; in draw mode "From e4", then "Arrow e4 to e6, green, added" or
  "removed". Refusals are read from the status line.
- **Focus never jumps after a move or a step;** it stays where the action
  was. It moves only to: an inline confirmation (its Cancel), the promotion
  choice (the queen), the stale message (Reload), and back to the trigger
  when a disclosure, rename or confirmation closes.
- Inline forms (rename, comment, note) submit with Enter in a single-line
  field; the comment and note textareas use their Save button (Ctrl/Cmd +
  Enter also saves).

## 3. PGN import (`/repertuarai/importuoti`)

One column of steps on one page, no board. Each finished step collapses to a
one-line summary with a "Change" button, so the page stays short. Opened
from a repertoire (`?i=<id>`), the side is fixed to that repertoire's and
"Add to {name}" is preselected in step 3.

### Phone, 390px

```
+--------------------------------------+
| < My repertoires                     |  TEXT_LINK
| Import PGN                           |  h1 text-2xl
| Up to 2 MB and 200 games.            |  intro, fg-muted: the limits
+--------------------------------------+  are stated before the upload
| 1  File and side                     |  SECTION_TITLE with step number
|  +--------------------------------+  |
|  |  [ Choose PGN file ]           |  |  file input styled as a dashed
|  |  or drop it here (desktop)     |  |  border-border-strong zone,
|  +--------------------------------+  |  rounded-card, min-h 96px;
|  taimanov.pgn · 84 KB                |  chosen file name and size
|  Side                                |
|  [ (o) White ]  [ ( ) Black ]        |  radio cards (LanguageField)
|  [ Show what is inside ]             |  PRIMARY_BUTTON, full width
|  (status line)                       |
+--------------------------------------+
```

After the preview:

```
+--------------------------------------+
| 1  taimanov.pgn · Black   [ Change ] |  collapsed step 1
+--------------------------------------+
| 2  What the file holds               |  focus moves to this heading
|  +-------------+ +-------------+     |  counts: 2-column grid of
|  |      6      | |     6       |     |  tiles, number text-2xl
|  |  chapters   | |   lines     |     |  tabular-nums, label text-sm
|  +-------------+ +-------------+     |  fg-muted; bg-sunken,
|  +-------------+ +-------------+     |  rounded-card
|  |     88      | |     3       |     |
|  |  positions  | |transpositions|    |  label may wrap to 2 lines
|  +-------------+ +-------------+     |
|  +-------------+                     |
|  |    233      |                     |
|  |   moves     |                     |
|  +-------------+                     |
|                                      |
|  Chapters                            |  h3 text-base semibold
|  1. Sicilian, Taimanov: 5.Nc3        |  ordered list, names wrap
|  2. Sicilian, Taimanov: 5.Nb5        |
|  ...                                 |
|                                      |
|  Skipped games (1)                   |  h3; the list sits in an
|  +--------------------------------+  |  error-subtle box with an
|  | (!) Game 7: illegal move       |  |  icon, rounded-card, p-3
|  |     12...Nxe4                  |  |
|  +--------------------------------+  |
+--------------------------------------+
| 3  Where to                          |
|  ( ) New repertoire                  |  radio cards, full width
|      Name [_____________________]    |  field shows under the choice
|  (o) Add to an existing one          |
|      [ Sicilian, Taimanov      v ]   |  native select, min-h-touch
|      Adds 2 chapters and 41 moves    |  the merge's `added`, fg
|      to Sicilian, Taimanov.          |
+--------------------------------------+
| [ Import ]                           |  sticky bottom bar on the phone
+--------------------------------------+  (thumb zone, safe-area inset)
```

- **Step 1:** the file input accepts `.pgn`, `application/x-chess-pgn` and
  `text/plain`; the visible control is a real `<input type="file">` with a
  styled label, so it is keyboard and screen-reader native. A file over 2 MB
  is refused at once, before any upload, in the step's status line.
- **Step 2, the summary:** the five counts from `summarize`, the chapter
  names (translated: an untitled chapter shows "Chapter N"), and the
  skipped games (R-64) as "Game {n}: {reason}", with the move when the
  reason has one. When nothing was skipped: one `success` line, "All 6 games
  are valid". More than 10 skipped games: the first 10 and a "Show all {n}"
  disclosure.
- **Renamed chapters (R-159):** when a merge gives an existing chapter a
  namesake, a block after the chapter list names each one: an h3 (same
  `text-base font-semibold` as "Chapters") over a bulleted list, one item
  per chapter, old title and new in one sentence from the catalogue. Plain
  `fg` text, no box: it is information, not a warning. Both titles wrap in
  full, never clamped (R-158); the distinguishing suffix at the end of the
  new title must show at 390px. No interactive content, so it adds no tab
  stop. Hidden when nothing is renamed.
- **Step 3, the target:** "New repertoire" with a name field (empty), or
  "Add to an existing one" with a select of the account's repertoires of
  the chosen side. With none of that side, that option is disabled and says
  "You have no {side} repertoire yet". Choosing an existing repertoire
  re-runs the preview against it: the summary tiles, chapters and skipped
  list (now with second Answers against it, R-54) are replaced by the merged
  ones, and the "Adds N chapters and M moves to {name}" line appears. While
  it re-runs, step 2 is dimmed (`opacity-60`, `aria-busy="true"`) and the
  status line says "Updating".
- **Confirm:** [ Import ] (`PRIMARY_BUTTON`), disabled while a preview or the
  import runs, keeps its label (no spinner swap); after about 1s the status
  line says "Importing". Success opens the repertoire in browse mode on its
  first new chapter.
- **Sticky bar (phone only):** once step 2 shows, [ Import ] sits in a
  bottom bar (`bg-surface`, `shadow-sheet`, `px-gutter`, safe-area inset)
  so it is reachable without scrolling the summary. It is last in the DOM,
  after step 3, which is also where it sits in reading order.

### Desktop, 1280px

```
+------------------------------------------------------------------------------+
|   < My repertoires                                                           |
|   Import PGN                                           max-w-5xl, centred    |
|   Up to 2 MB and 200 games.                                                  |
|                                                                              |
|   1  taimanov.pgn · Black                                   [ Change ]       |
|                                                                              |
|   +--------------------------------------------+  +----------------------+  |
|   | 2  What the file holds                     |  | 3  Where to          |  |
|   | [ 6 ] [ 6 ] [ 88 ] [ 3 ] [ 233 ]           |  | ( ) New repertoire   |  |
|   |  chapters lines positions transp. moves    |  |     Name [_______]   |  |
|   |                                            |  | (o) Add to existing  |  |
|   | Chapters                                   |  |     [ Taimanov  v ]  |  |
|   | 1. Sicilian, Taimanov: 5.Nc3               |  |     Adds 2 chapters  |  |
|   | ...                                        |  |     and 41 moves     |  |
|   |                                            |  |                      |  |
|   | Skipped games (1)                          |  | [ Import ]           |  |
|   | (!) Game 7: illegal move 12...Nxe4         |  | (status line)        |  |
|   +--------------------------------------------+  +----------------------+  |
|                                                    w-panel, sticky top-8      |
+------------------------------------------------------------------------------+
```

- Step 1 alone (before the preview) is a single `SECTION` card,
  `max-w-2xl`. After the preview, the summary is the wide left card and the
  target with Import is the right `w-panel` card, sticky so Import stays in
  view; no bottom bar. The five count tiles sit in one row (`grid-cols-5`);
  the labels may wrap to two lines in LT.

### States and refusals

| State | Shown |
| --- | --- |
| **Loading** (page) | header and the step 1 card skeleton |
| **Reading / previewing** | the step 1 button disabled, its label kept; after about 1s "Reading the file" in the status line |
| **Refused file** | step 1 stays open, the file stays chosen, the status line in `error` names the limit: "The file is larger than 2 MB", "The file has more than 200 games", "Variations are nested deeper than 64", "No valid game was found in the file". Focus stays on the button; the status line is announced |
| **Nothing of the side** | the "Add to existing" option disabled with its reason (step 3) |
| **Stale target** (`repertoire.stale` at confirm: the repertoire changed since the preview) | status line in `error` with [ Preview again ], which re-runs the preview against the current version |
| **Not found / side mismatch** | status line in `error` with the catalogue text; the target select is reset |
| **Done** | navigation to the repertoire; no extra screen |

### Keyboard and screen readers

- Tab order is the visual order: step 1 (file, side, submit), then step 2's
  disclosure (if any), then step 3 (choice, name or select), then Import.
- After a preview, focus moves to the step 2 heading so the summary is read
  next; after "Change", focus moves to the file input.
- Each count tile is one text run ("6 chapters"), not a number and a
  separate label, so it reads correctly.

## Board styling (all screens with a board)

Chessground's `chessground.base.css` lays the board out and
`chessground.cburnett.css` provides the pieces; `chessground.brown.css` is
**not** imported. `apps/web/src/app/board/board.css` colours the same
selectors with tokens (plan Task 13):

| Board element | chessground selector | Token |
| --- | --- | --- |
| Light / dark squares | `cg-board` background (a8 and h1 light) | `board-light`, `board-dark` |
| Last move | `square.last-move` | `board-last-move` |
| Selected piece; draw mode's first square | `square.selected` | `board-selected` |
| Legal destination (dot), capture (ring) | `square.move-dest`, `square.move-dest.oc` | `board-target` |
| King in check | `square.check` | `board-check` |
| Keyboard cursor | `square.cursor` (`highlight.custom`) | `board-focus`, inset 3px |
| Coordinates | `coords` | opposite square colour, `text-xs` |
| Arrows and circles: green, red, yellow, blue | `drawable.brushes` `g`, `r`, `y`, `b` | `board-mark-green`, `board-mark-red`, `board-mark-yellow`, `board-mark-blue` (to be added, below) |

- **Arrow and circle colours.** Chessground sets the brush colour as an SVG
  `stroke` / `fill` attribute and adds no class, so CSS cannot reach it
  cleanly. The board component reads the four mark tokens once at mount
  (`getComputedStyle(host).getPropertyValue('--color-board-mark-green')`,
  ...) and passes them as `drawable.brushes` for the keys `g`, `r`, `y`,
  `b` (opacity 1, line width 10, chessground's own), replacing the defaults.
  The tokens are therefore plain colours, not `light-dark()` pairs (as every
  board overlay already is), and the Learn pass `board-arrow` stays separate.
- **Mark tokens** (in `tokens.css`):

  | Token | Value | Contrast on light square, light / dark theme | On dark square |
  | --- | --- | --- | --- |
  | `--color-board-mark-green` | `#15781b` | 4.1 / 3.3 | 1.8 / 1.5 |
  | `--color-board-mark-red` | `#882020` | 6.7 / 5.4 | 2.9 / 2.4 |
  | `--color-board-mark-yellow` | `#e68f00` | 1.8 / 1.5 | 1.2 / 1.5 |
  | `--color-board-mark-blue` | `#003088` | 8.6 / 6.9 | 3.8 / 3.1 |

  These are the colours players know from lichess and from `[%cal]` / `[%csl]`
  PGN, kept on purpose. An arrow always crosses light squares, where green,
  red and blue reach 3:1; yellow does not and dark squares mostly do not.
  As with coordinates, the marks are supplementary: the panel carries the
  same marks as text for screen readers, and the move itself is in the
  move list.
- **Board tokens are `@theme static`.** Tailwind 4.3.3 emits only the theme
  variables a utility class uses (checked on a production build: no
  `--color-board-*` variable reached the CSS). The board group is read from
  `board.css` and from script, never through a utility, so `tokens.css`
  keeps it in its own `@theme static` block, which always emits every
  variable. Do not move board tokens back into the main `@theme` block.
- **Motion:** piece animation `duration-move` (150ms). Chessground animates
  in script, so the global reduced-motion CSS does not reach it: the board
  passes `animation.enabled: false` when `prefers-reduced-motion: reduce`
  matches.
- **Shape:** full-bleed with radius 0 on the phone; `rounded-board` on
  desktop. The board never dims except in states that say so (none on these
  screens).
- **Dark theme:** the square tokens are already dimmer; the mark colours do
  not change with the theme.

## Sign-off checklist (Task 23)

At 390px and 1280px, LT and EN, light and dark: the list (with items and
empty), the repertoire page in browse, builder, draw mode, the removal
confirmation, the promotion choice and the stale message, and the import
flow (file step, summary with a skipped game, add to existing with the
merged summary, a refused file). Plus a keyboard pass (board cursor, typed
move, panel order, draw mode by keyboard), a 200% zoom check, and the board
at 320px (40px squares, tap-tap still works).

## Decided after the first draft (owner, 2026-10-18)

1. **First move in an empty repertoire** creates "Chapter 1" on its own
   (R-111; Empty repertoire state and Builder, above).
2. **Chapter intros** stay read-only in S3 (R-112).

## Decided at the built-screen review (ux-designer, 2026-10-18)

Design decisions only; no product rule changes.

1. **Panel order** is one DOM order at both widths (desktop section above).
2. **Status line** sits under the board row and the builder row, outside the
   scrolling panel, at both widths: a refusal stays in view however far the
   panel has scrolled, and its place in Tab order is where it is seen.
3. **Repertoire actions render twice** (header from `lg`, panel below it),
   one of them `display: none`. Accepted: the hidden copy is out of the
   accessibility tree and Tab order, and choosing in script would flash on
   hydration.
4. **Desktop rename** replaces the h1 with the name field, Save and Cancel;
   the actions row hides meanwhile; focus returns to Rename on close.
   "Saved" shows under the actions.
5. **Mode switch on the phone** shows a pencil and the switch; the label is
   the accessible name only (`max-sm:sr-only`). "Kūrimo režimas" beside the
   switch left the repertoire name about 12 characters in the top bar. From
   `sm` the label shows, and on desktop the switch sits at the header's
   right end.
6. **Draw hint** stays in the builder row, in the fixed region, not in the
   scrolling panel: while drawing the player looks at the board, and a hint
   at the top of a scrolled panel would be out of view.
7. **Move list:** a move number and its move wrap as one (`whitespace-nowrap`
   pair), so "6." never ends a line alone.
8. **Switching mode** clears the status line (its message was about the
   other mode), except the stale message.
9. **Side headings** in Mano repertuarai show a king glyph (inline SVG,
   `piece-*` tokens, `aria-hidden`).
