# Repertoire screens

The repertoire screens: **My repertoires** (`/repertoires`), the repertoire
page (`/repertoires/[id]`, browse and builder on one page; the assigned one
at `/repertoires/assigned/[id]`; the coach's read-only view of a shared one
at `/coach/players/[playerId]/repertoires/[repertoireId]`), the
**Repertoire screen** (`.../manage`, R-226) and the PGN import
(`/repertoires/import`). First built in S3 (#253); sections 1 to 4 restyled
to Ocean in #381 part 4 (spec
`docs/superpowers/specs/2026-11-26-repertoire-screens-design.md`, rulings
R-225 to R-227), signed off 2026-11-26; the sign-off findings were fixed
the same day, and the phone board height and long names were decided then
(section 2, Board height and Long names). Vocabulary from
`docs/CONTEXT.md` (Repertoire, Chapter, Move, Answer, Line,
Transposition, Comment, Coach note, Personal note);
tokens from `apps/web/src/app/tokens.css` (see `README.md`); shared classes
from `apps/web/src/app/buttons.ts` (`PRIMARY_BUTTON`, `SECONDARY_BUTTON`,
`TONAL_BUTTON`, `COMPACT_TONAL`, `DANGER_BUTTON`), `settings/styles.ts` (`SECTION`,
`DANGER_SECTION`, `SECTION_TITLE`) and `status-line.tsx` (`StatusLine`).
The layout code is in `apps/web/src/app/repertoire-view/`
(`repertoire-layout.tsx` holds the grid).

Sketches use English placeholders; the copy is in the message catalogue
(English only, R-217). Labels must still not depend on their English length.

## Rules for all the screens

- **Nothing overlays the board** (`training-screen.md`): no menus, toasts,
  dialogs or confirmations over it. Confirmations, the promotion choice and
  every message sit in the panel, inline, pushing content down.
- **The panel is for studying** (R-226). Rename, Download PGN, Add from PGN,
  share, assign, pause, make my own copy and delete live on the Repertoire
  screen (section 3), opened from the page's More button.
- **One status line per screen** (`StatusLine`, `role="status"`) for
  refusals and outcomes; on the repertoire page it sits under the board row
  and the builder row, outside the scrolling panel. Field saves (comment,
  personal note, rename) have their own status line under the field.
  Refusals are catalogue keys, shown in the `error` tone with the words.
- **Touch targets** are at least 44px on a phone (`min-h-touch`,
  `min-w-touch`), including move chips, chapter rows and the four draw
  colours. From `lg` the move chips are compact (28px high): a pointer is
  precise there and the two-column list needs the rows.
- **No fixed widths on text.** Buttons may wrap to two lines on a phone;
  primary actions never truncate. A repertoire name may clamp to two lines
  in a list card, with the full name in `title` and the accessible name. In
  the page's own header it wraps in full, never clamped: the end of a name
  ("6.Be3 Ng4", "8.a4 sistema") is what tells a player's repertoires apart
  (section 2, Long names). Chapter titles are never clamped (R-158)
  except on the closed chapter line, which carries the full title in its
  accessible name and opens to the full titles.
- **Progress reads the same as on Today** (R-177, R-225): the `LearnedBar`
  (`learned` on the `border` track, 6px, decorative) and a text line, "64%
  learned · 3 due", "New · 15 moves" when nothing is learned, and
  **Mastered** as Today's pill (R-178). The due count shows only above
  zero. Move states are not shown in the move list. Paused and Own copy are
  neutral pills (a `border-strong` outline and `fg-muted` text, no fill, so
  they do not read as buttons); Overdue is `error-subtle`.
- **Tokens only;** no `dark:` classes are needed on these screens.
- **Times** are formatted with `Intl` in the account's time zone
  (Europe/Vilnius by default): today as a time, this year as day and month,
  older with the year.

## 1. My repertoires (`/repertoires`)

### Phone, 390px

```
+--------------------------------------+
| MyChess                         (GN) |  shell top row (tab page)
+--------------------------------------+
| My            [Import PGN] [ New ]   |  PageHeader: h1 text-2xl bold;
| repertoires                          |  Import PGN SECONDARY, New PRIMARY
| Build your openings or import PGN.   |  intro, fg-muted
|                                      |
| (K) White                            |  h2 text-lg semibold; king glyph,
|  +--------------------------------+  |  fixed colours (below)
|  | Valdoves gambitas  [Assigned]  |  |  CARD, the whole card one link;
|  | R. Vaitkus · due Dec 15 ·      |  |  name text-base semibold, clamp 2;
|  | 6 chapters · 125 moves         |  |  tag pill; one meta line, fg-muted
|  | =============================  |  |  LearnedBar, 6px
|  | Mastered                       |  |  progress line
|  +--------------------------------+  |
|  +--------------------------------+  |
|  | Londono sistema                |  |  own: no tag
|  | 2 chapters · 29 moves ·        |  |
|  | changed Apr 12                 |  |
|  | -----------------------------  |  |
|  | New · 15 moves                 |  |
|  +--------------------------------+  |
| (k) Black                            |
|  ...                                 |
+--------------------------------------+
| Today   Repertoires   Opponents      |  tab bar
+--------------------------------------+
```

**New** opens the create form inline under the header, pushing the list
down:

```
| My repertoires  [Import PGN] [ New ] |
|--------------------------------------|  rule
| New repertoire                       |  h2
| Name [______________________________]|
| Side [(o) White      ] [( ) Black   ]|  radio cards
| [             Create               ] |  PRIMARY, full width
| Cancel                               |  QUIET, closes the form
| (K) White ...                        |
```

### Desktop, 1280px

```
+------------------------------------------------------------------------------+
|  MyChess          Today  Repertoires  Opponents  Coach                (RV)  |
+------------------------------------------------------------------------------+
|   My repertoires                                   [Import PGN] [ New ]     |
|   Build your openings or import PGN.                                        |
|                                                                             |
|   (K) White                              (k) Black                          |
|   +-------------------------------+      +-------------------------------+  |
|   | Italiskoji partija            |      | 1...e5                        |  |
|   | 8 chapters · 106 moves ·      |      | 4 chapters · 54 moves ·       |  |
|   | changed Nov 20 · Assigned to 1|      | changed Nov 20 · Assigned to 1|  |
|   | ----------------------------- |      | ----------------------------- |  |
|   | New · 52 moves                |      | New · 27 moves                |  |
|   +-------------------------------+      +-------------------------------+  |
+------------------------------------------------------------------------------+
    CONTENT (max-w-content, 1040px), two columns from sm, gap-8
```

### Cards

- **One card for every kind**: own, assigned, fork. The tag after the name
  says which: **Assigned** (`accent-subtle` pill), **Own copy** (neutral
  outline pill), none for own; then the Overdue and Paused pills where they
  apply.
- **Meta line:** own and fork "N chapters · N moves · changed <date>";
  assigned "<coach> · due <date> (or no deadline) · N chapters · N moves";
  a fork ends with "Copy of <coach>'s repertoire"; a coach's own repertoire
  that is assigned ends with "Assigned to N".
- **Progress:** the bar and line of the rules above. A repertoire without
  moves has neither.
- **Side glyphs:** White a `side-white` king with a `side-black` outline,
  Black a `side-black` king with a `side-ring` outline, each on a small
  `board-light` tile (`rounded-control`), so each reads as its piece in both
  themes (on the dark page a bare black king, `#141a26` on `#0f1218`, read
  as an outlined white one).

### States

- **Loading** (`loading.tsx`): the header, then card skeletons (`sunken`).
- **Empty** (no repertoire at all): "You have no repertoires yet" and the
  create form open under it; Import PGN stays in the header.
- **Empty group:** the heading stays, with "No Black repertoire yet".
- **Refusal** (blank or too long name, the repertoire limit): the form's
  status line, the field `aria-invalid`; the typed name stays.
- A new repertoire opens in builder mode.

## 2. The repertoire page (`/repertoires/[id]`)

One page, two modes, **browse** (default) and **builder** (the Edit
switch); the assigned page and the coach's shared view are the same page
without Edit. A new repertoire with no chapters opens in builder mode.

### Phone, 390px, browse

```
+--------------------------------------+  390 x 844
| [<] Sicilijos gynyba,    Edit[o ] [:]|  top bar, ONE row: back 44x44; the
|     Taimanovo variantas              |  name text-base/5, wraps in full;
+--------------------------------------+  Edit (word + switch); More 44x44
|                                      |  ("Repertoire options"); no avatar
|            B O A R D                 |  as wide as the screen, smaller on
|                                      |  a short screen (Board height);
|                                      |  radius 0, flipped for Black
+--------------------------------------+
| [Type a move   ][>]  [|<] [<] [>]    |  board row
+--------------------------------------+
| 5... Qc7 Perejimas i anglu ataka.    |  comment strip, accent-subtle,
|                                      |  pinned; 2 lines, then More
+--------------------------------------+
| 16% learned [Review 51] [Learn 10 to-|  the panel scrolls from here:
|  day]                                |  summary row (compact TONAL);
| R. Vaitkus · due Dec 20 · in 24 days |  status strip (assigned only);
| Ch 1/6 · Sicilian Defense: Taim...  v|  chapter line (closed);
| 1.   e4        c5                    |  move list, two columns,
| 2.   Nf3       e6                    |  44px chips
| ...                                  |
| [Learn this line (4)] [Learn this    |  Train here (browse, when it
|  chapter (12)]                       |  trains): TONAL, each when N > 0
| [ I know this v ]                    |  SECONDARY with chevron
| My note ...                          |  personal note (R-21), on a move
+--------------------------------------+
| Today   Repertoires   Opponents      |  tab bar
+--------------------------------------+
```

- **One row above the board** (back, name, Edit, More). The avatar (account
  menu) is not in this row below `lg`: on this one screen every pixel of
  the row goes to the name, and the account menu is one tab away. The name
  is `text-base/5` (16px on 20px lines) below `lg`, so a two-line name sits
  inside the 44px row without making it taller.
- **Fixed region:** the top bar, the board, the board row, the builder
  row, the status line and the comment strip never scroll; the panel's
  scroller below them does. The summary row is first in the scroller.
- **Board height (phone, below `lg`).** The page is a fixed-height column
  (`100dvh - shell chrome`). The board's cell may shrink, the panel keeps
  its room, and the board is the largest square that fits its cell, centred:
  - board cell: `flex: 0 100 100vw` (`grow-0 shrink-[100] basis-[100vw]`),
    `min-h-28` (7rem), `container-type: size`, `justify-center`; the board
    inside it `w-[min(100cqw,100cqh)]`. From `lg` the cell drops these
    (`lg:basis-auto lg:[container-type:normal]`) and keeps its desktop width.
  - panel cell (board row, builder row, status line, comment strip,
    scroller): `flex: 1 1 16.5rem` (264px: board row 60, a one-line comment
    36, scroller 168), `min-h-0`.
  - The board's shrink factor (100 against the panel's 1) makes the board
    give up the height first, down to 7rem; only then does the panel shrink.
    The comment strip, the builder row and the status line live in the
    panel cell, so they never resize the board while the player steps
    through moves; only the name's line count and the viewport do.
  - Results (a name of up to two lines; the scroller without a comment
    strip / with a one-line comment; production build, both themes the
    same, 2026-11-26): **390 x 844** board 390, scroller 286 / 250px
    (summary row, chapter line, three move rows); **375 x 667** board 296,
    scroller 203 / 167px (summary row, chapter line, the first move row);
    **390 x 664** (an iPhone in Safari with its bars) board 293, scroller
    203 / 167px; **640 x 400** (200% zoom) board 112, scroller 120 / 84px;
    **768 x 1024** board 652. Draw mode's swatches and hint take the
    scroller's room (59px at 375 x 667, none at 640 x 400): while drawing
    the player looks at the board.
  - Not chosen: a 19rem panel would show a second move row at 375 x 667 but
    leaves a 255px board (32px squares) there and on every in-browser
    iPhone; the board dominating comes first, and selecting a move scrolls
    the panel to it (`block: 'nearest'`).
- **Long names.** Never clamped (the end tells repertoires apart). Below
  `lg` the name gets the row's width less back, Edit and More, about 170px
  at 375 (about 19 characters a line, broken at words): up to about 30
  characters fit the 44px row in two lines ("Sicilijos gynyba, Taimanovo
  variantas", 37 characters, takes two lines at 390 and three at 375,
  where the top bar grows from 52 to 68px and the board from 296 to 280);
  each further line adds about 16 to 20px to the top bar, which the board
  gives up, not the panel. The 80-character maximum is five lines
  (100px) at 375, a board about 56px smaller. The full name is also the
  board's accessible name and the Repertoire screen's h1.
- **Summary row:** "16% learned" (the list card's progress words without
  the due part: "New · N moves", "Mastered" as the pill), then **Review N**
  and **Learn N today** (R-62), each only when N > 0, on one wrapping row
  (`flex flex-wrap items-center gap-x-2 gap-y-1`). The two buttons are
  `COMPACT_TONAL` (`buttons.ts`: the tonal colours at `px-3 text-sm`,
  still `min-h-touch`), so
  "16% learned [Review 51] [Learn 10 today]" fits 343px. Side and chapter
  count are not repeated (the board's orientation and "Ch 1/6" say them).
  Builder mode and an empty repertoire have no summary row.
- **Assigned status strip** (second line of the summary, `text-sm`): the
  coach's name (semibold) · "due <date> · in N days", "due today", or the
  Overdue pill; the Paused pill. No urgency colour before the deadline.
- **Coach's shared view:** the summary row is the player's name and
  **Progress**; the read-only sentence goes under the move list (where the
  coach writes a Coach note), not above the chapter line.
- **Scroller spacing below `lg`:** `gap-3 pt-2 pb-3` (from `lg`: `gap-4`,
  no padding, as before).
- **Comment strip:** the current move's Comment, or the chapter intro
  (R-66) at the root: `accent-subtle`, the move ("5... Qc7") semibold, then the text;
  clamped to two lines past 140 characters with **More** / **Less**. On the
  assigned page a muted lead-in names it "Coach note from <coach>" (on a
  coach's own repertoire a Comment is a Coach note, `CONTEXT.md`). No strip
  without a text. In builder mode the comment is the panel's field instead.
  A 2px left edge in the `comment-edge` token sets it off the page in the
  dark theme (the accent, as `accent-subtle` is close to `bg` there);
  transparent in light.
- **Chapter line:** closed by default, "Ch 2/6 · <title>", one line,
  truncating, the full title in its accessible name. Open, the chapters list
  inline (no inner scroller; the panel scrolls); choosing one selects it,
  closes the list and returns focus to the line.
- **Chapter rows:** the title in full (R-158), then the `LearnedBar` and
  "64% learned · 4 due" / "New · 18 moves" / Mastered. The current
  chapter's row is `accent-subtle`. No icons in browse.
- **Train here** (browse, a player who trains it): **Learn this line (N)**,
  **Learn this chapter (N)** (R-206), then **I know this** (R-227): open, it
  lists "This move, 5... Qc7" (own-side moves only), "This line, N moves",
  "This chapter, N moves", each with **Mark known (N moves)**, or "Known"
  with **Learn again**, or "already in review"; line and chapter keep the
  R-147 confirmation with the count.
- **Empty repertoire:** "Play the first move on the board, or add games
  from PGN." and **Add from PGN**; no summary row, no Train here, no
  Download.

### Phone, 390px, builder

```
| [<] Sicilijos gynyba,    Edit[=o] [:]|  switch on
|     Taimanovo variantas              |
|            B O A R D                 |  playing a move adds it
| [Type a move   ][>]  [|<] [<] [>]    |
| [ Remove move ]  [ Draw ]            |  builder row, fixed
|  Ch 1/6 · ...                      v |  no summary row in builder; open:
|    Sicilian ... (B48, 6. Be3)        |  the selected row shows
|    [Rename chapter]                  |  [Rename chapter] [Delete chapter]
|    [Delete chapter]                  |  under its title; [Add chapter]
|  Comment [________________________]  |  ends the list; textarea, R-105
|  1.  e4   c5 ...                     |
```

- **Draw mode:** the builder row becomes four 44x44 swatches (green, red,
  yellow, blue; an inset 1px `border-strong` ring, 3.55:1 on the dark panel;
  the chosen one a 2px `fg` ring and a check) and **Done**; the hint sits
  under them in a `sunken` box. At the chapter root Draw is unavailable
  (`aria-disabled`, half faded) and says "Choose a move first: marks belong
  to a move".
- Adding, removing, the inline remove confirmation, chapter rename and
  delete (a built chapter is titled by R-104), the comment field and the
  stale message behave as in S3 (states table below).

### Desktop, 1280px

```
+------------------------------------------------------------------------------+
|  MyChess          Today  Repertoires  Opponents                       (GN)  |
+------------------------------------------------------------------------------+
|  +------------------------------------------+  +--------------------------+ |
|  |                                          |  | [<]          Edit[o ] [:] | | header: the card's
|  |                                          |  | Sicilijos gynyba,         | | first rows, top level
|  |                                          |  | Taimanovo variantas       | | with the board's top;
|  |                                          |  | [Move     ][>][|<][<][>]  | | the name text-xl,
|  |              B O A R D                   |  | 5... Qc7 Perejimas ...    | | its own row, in full
|  |   min(100dvh - 3rem - chrome, 46rem,     |  | 16% learned [Review 51]   | | comment strip, then
|  |       100vw - panel - 6rem)              |  | Ch 1/6 · Sicilian ...   v | | the summary row
|  |   = 696px at 1280 x 800                  |  | 1.  e4       c5           | |
|  |   sticky                                 |  | 2.  Nf3      e6           | |
|  |                                          |  | 7.  Qd2                   | | variation inline,
|  |                                          |  |  | 7. Qf3 Ne5 8. Qg3      | | border-l
|  |                                          |  | 7.  ...      Nf6          | | main line resumes
|  +------------------------------------------+  | [I know this v]           | |
|                                                +--------------------------+ |
|    <---------------- 696 ----------------->  32  <---- panel 360 ----->     |
+------------------------------------------------------------------------------+
```

- **Grid** (`REPERTOIRE_GRID`): the board spans both rows on the left; the
  header and the panel are the right column's two rows on one card
  (`PanelCard`, `surface`, `shadow-card`), so the header's top is level
  with the board's (both at 80px at 1280 x 800). The header is back, Edit
  and More on one row, then the name on its own full-width row (`text-xl`,
  never clamped). The name is placed after Edit and More by CSS order
  (`lg:order-last`) while it comes after back in the page order; it is a
  heading, not focusable, so Tab order still follows the screen. The board is
  `min(100dvh - 3rem - shell chrome, 46rem, 100vw - panel - 6rem)`: 696px
  at 1280 x 800, 736px (the cap) at 1440 x 900, 568px at 1024 x 768, where
  the page does not scroll sideways.
- **The card stretches to the board's height** when the panel is shorter
  (an empty repertoire, a short chapter) and grows with the panel when it
  is longer; the page scrolls, the board stays sticky beside it. One block
  of equal height reads calmer than a short card floating by a tall board.
- **Panel order, every width, one DOM order:** board row, builder row,
  status line, comment strip, then the scroller (summary row, status strip,
  lead, chapter line, moves, Train here, notes). The desktop move list
  scrolls in its own box (at most `50dvh`), so the comment strip above it
  stays in view while stepping.
- **640-1023px:** the phone layout (Board height above).

### The move list

```
 1.   e4        c5
 ...
 7.   Qd2
  | 7. Qf3  Ne5  8. Qg3
  |  | 8. Qe2  Nf6
  | 8... h5
 7.   ...       Nf6
 8.   O-O-O     Bb4
```

- Numbered, two columns: number, White's move, Black's move. A line that
  starts with Black's move shows "n. ..." in White's column. Moves are
  numbered from the chapter root (a position key has no move counter, Q27).
- **Variations** are indented with the left rule (`border-l border-border`)
  and written inline, each move its own chip; the main line resumes in the
  columns after them. Indentation stops growing after three levels.
- **Chips:** compact (28px) from `lg`, `min-h-touch` on a phone; own-side
  moves (Answers) semibold; the current chip `bg-accent text-accent-fg`,
  `aria-current`; a comment glyph, a lock (own note) or pen (coach's note)
  glyph, `aria-hidden`, with the meaning in the accessible name ("5... Qc7,
  has a comment"); a transposition's two arrows and "transposes".
- **Selecting a move scrolls only the panel** (`block: 'nearest'` on the
  panel's scroller), never the page; on a phone the pinned comment strip
  stays in view.
- Empty chapter: "No moves yet" (browse) or "Play the first move on the
  board" (builder).

### The promotion choice

Four 56x56 piece buttons and Cancel replace the board row (both widths),
`role="group"` "Promote to"; focus to the queen; Escape cancels. Nothing
over the board.

### States

| State | Board | Panel |
| --- | --- | --- |
| **Loading** (`loading.tsx`, the same grid) | the board frame, squares and no pieces | skeleton header and lines (`sunken`); after about 1s "Loading" (`animate-reveal-late`) |
| **Not found** | none | the 404: "This repertoire does not exist or is not yours", one text for both cases |
| **Empty repertoire** | start position, movable in builder | the empty message and Add from PGN (above) |
| **Empty chapter** | the chapter root | "No moves yet" / "Play the first move on the board" |
| **Saving** | not movable | after about 1s "Saving" in the status line |
| **Refusal** | piece goes back | the status line in `error`; the board keeps focus |
| **Not in the repertoire** (browse) | piece goes back | "This move is not in the chapter. Turn on Edit to add it." |
| **Stale version** | not movable | the status line with Reload; edit controls disabled; focus to Reload |
| **Paused** (assigned) | as browse | the Paused pill in the status strip; no Review or Learn |
| **Failed request** | as before | "That did not work. Try again."; the field keeps its text |

### Keyboard and screen readers

- **One order at every width** (the DOM order is the visual order, WCAG
  2.4.3): [the shell's links on a desktop], back, Edit, More, board, move
  field, submit, start, back, forward, [builder row], [status action],
  comment strip's More, Review, Learn (or the coach's Progress), chapter
  line, moves, Train here, note.
- The board is one tab stop (`role="application"`, "Chess board, <name>,
  <chapter>"): arrows move the `board-focus` cursor, Enter or Space picks up
  and drops, Escape cancels; announcements as in `training-screen.md`.
  Focus moves only to an inline confirmation's Cancel, the promotion queen,
  Reload, and back to a disclosure's trigger when it closes.
- Every focusable shows the 2px `focus` outline.

## 3. The Repertoire screen (`/repertoires/[id]/manage`, `/repertoires/assigned/[id]/manage`)

Opened from the page's More button (R-226). A page under the repertoire:
`PageHeader` (back to the repertoire, the name as h1, wrapping in full),
one column in `CONTENT`, sections as `SECTION` cards from `sm` (rules
between them on a phone).

### Phone, 390px, own repertoire (a coach's, assigned)

```
+--------------------------------------+
| [<] Karo-Kan gynyba:            (RV) |
|     pagrindai                        |
|--------------------------------------|
| Repertoire                           |  SECTION_TITLE
| [Rename] [Download PGN]              |  SECONDARY, wrap
| [Add from PGN]                       |
|--------------------------------------|
| Share with a coach                   |  players' own repertoires:
| The coaches you tick see ...         |  checkboxes, Save, status as
| [x] Rimantas Vaitkus                 |  plain text ("Shared with 1
| [Save]   Shared with 1 coach         |  coach")
|--------------------------------------|
| Assigned to                          |  coach: one row per assignment
| Sestadienio grupe                    |  a group: its name semibold,
| 3 players · due Dec 20     [Change]  |  one Change (deadline / clear /
|  | Dovydas Jankauskas                |  unassign inline, for the group);
|  | ===========-------                |  its members' progress rows under
|  | New · 43 moves                    |  it, border-l; a fork: Own copy,
|  | Gabija Navickaite ...             |  no % (R-155)
| Rokas Petrauskas                     |  a single player: name, bar and
| ======------  12% learned  [Change]  |  line (R-177), Change
| Assign to players                    |  text-base semibold subheading;
|                                      |  the assign form under the rows
| Assign to [Choose a player or a gr v]|
| Deadline (optional) [mm/dd/yyyy]     |
| [Assign]                             |
|--------------------------------------|  DANGER_SECTION: error rule /
| Delete repertoire                    |  edge, error-tone title
| [Delete]                             |  two steps, inline
+--------------------------------------+
```

### Phone, 390px, assigned repertoire

```
| [<] Karo-Kan gynyba: pagrindai       |
| Pause                                |  each section: title, one muted
| Stops new moves and reviews from     |  line saying what it does, the
| this repertoire until you resume.    |  button
| [Pause]                              |  Resume when paused
| Download PGN                         |
| Your coach's moves and comments ...  |
| [Download PGN]                       |
| Make my own copy                     |
| A copy you can change; your          |
| progress comes with it.              |
| [Make my own copy]                   |  ?fork=1 opens the question:
|  Make your own copy of "..."? ...    |  [Make my copy] PRIMARY,
|  [Make my copy] [Cancel]             |  [Cancel] SECONDARY
```

### Desktop, 1280px

The same sections as cards in `CONTENT` (1040px); an assignment row puts
the name (a group: its name, then "N players · due <date>") on the left and
**Change** on the right; a player's bar and its line sit on the right of
the player's row.

- **Delete:** the confirmation, "Delete <name>? Its chapters, moves,
  comments and your notes on it will be deleted. This cannot be undone.",
  with **Delete permanently** (`DANGER_BUTTON`) and Cancel, inline in the
  danger section; focus to Cancel; success lands on My repertoires with its
  status line.
- Outcomes and refusals use the screen's `StatusLine`.
- **Group assignments** are one row with one **Change**, whose inline form
  changes the whole group, and the members' progress rows under it
  (resolved after the 2026-11-26 sign-off).

## 4. PGN import (`/repertoires/import`)

One column of numbered steps, no board. A finished step collapses to one
line with **Change**. Opened from a repertoire (`?i=<id>`), the side is
fixed and "Add to <name>" is preselected.

### Phone, 390px

```
+--------------------------------------+
| [<] Import PGN                  (GN) |
| Up to 2 MB and 200 games.            |
|--------------------------------------|
| 1 PGN and side                       |  step 1 open
|  +- - - - - - - - - - - - - - - - +  |  dashed border-strong zone
|  |      [ Choose PGN file ]       |  |
|  +- - - - - - - - - - - - - - - - +  |
|  Or paste PGN [__________________]   |
|  Side [(o) White] [( ) Black]        |
|  [       Show what is inside       ] |  PRIMARY, full width
+--------------------------------------+
```

After the preview:

```
| 1 taimanov.pgn · Black     [Change]  |  collapsed
|--------------------------------------|
| 2 What the file holds                |  focus to this heading
| 6 chapters · 13 lines · 123 moves ·  |  one plain fg-muted line
| 1 transposition                      |  (no tiles, no positions)
| Chapters                             |
|  1. Sicilian Defense: Taimanov ...   |  full titles (R-158)
| [ All 6 games are valid ]            |  success-subtle; or Skipped
|--------------------------------------|  games (N) in error-subtle
| 3 Where to                           |
| ((o) New repertoire                 )|  radio cards
|     Name [persona-taimanov       ]   |  prefilled (below)
| (( ) Add to an existing one         )|
|     Repertoire [Sicilijos ...     v] |
|     Adds 2 chapters and 41 moves to  |
|     Sicilijos gynyba, ...            |
+--------------------------------------+
| [             Import               ] |  sticky bar (phone only)
+--------------------------------------+
```

### Desktop, 1280px

```
|  [<] Import PGN                                                       |
|  Up to 2 MB and 200 games.                                            |
|  1 taimanov.pgn · Black                                    [Change]   |
|  +------------------------------------------+ +---------------------+ |
|  | 2 What the file holds                    | | 3 Where to          | |
|  | 6 chapters · 13 lines · 123 moves · ...  | | (o) New repertoire  | |
|  | Chapters                                 | |     Name [_______]  | |
|  |  1. ...                                  | | ( ) Add to existing | |
|  | [All 6 games are valid]                  | | [      Import     ] | |
|  +------------------------------------------+ +---------------------+ |
```

- **Stats:** one plain line, "6 chapters · 13 lines · 123 moves · 1
  transposition"; a zero count is left out.
- **Name prefill:** the Event tag when every game shares one (blank or "?"
  is none), else the file name without its extension, cut to the name
  maximum; it replaces the field only while the field still holds the last
  suggestion, so a typed name is never overwritten.
- **Add to an existing one:** step 2 shows the merged summary against the
  chosen repertoire: its list is headed **Chapters it adds** (only the new
  ones, full titles) instead of Chapters, then skipped games with second
  answers (R-54); step 3 says "Adds N chapters and M moves to <name>". When
  nothing would be added, an `error-subtle` line says "Nothing new to add
  from this file: ..." and Import is disabled.
- **Disabled primary:** `fg-muted` on `sunken` at full opacity (5.34:1
  light, 7.66:1 dark), `cursor-not-allowed`: it reads as off, and a pending
  label ("Importing") keeps 4.5:1.
- Kept from S3: side detection (R-214: "Most games were skipped as second
  answers. Did you mean Black?" with Preview as Black), the sticky Import bar
  on a phone, renamed chapters (R-159), annotations added to existing moves,
  "Show all N" past ten items.

### States and refusals

| State | Shown |
| --- | --- |
| **Reading / previewing** | the step's button disabled, its label kept; after about 1s "Reading the file" |
| **Refused file** | step 1 stays open, the file stays chosen, the status line names the limit (2 MB, 200 games, nesting 64, no valid game) |
| **Nothing of the side** | "Add to an existing one" disabled with its reason |
| **Nothing to add** | the `error-subtle` line; Import disabled |
| **Updating** (target changed) | step 2 dimmed, `aria-busy`, "Updating" |
| **Stale target** | the status line with Preview again |
| **Done** | the repertoire opens on its first new chapter |

### Keyboard and screen readers

- Tab order is the visual order: step 1 (file, paste, side, submit), step
  2's disclosures, step 3 (choice, name or select), Import.
- After a preview focus moves to the step 2 heading; after Change, to the
  file input. The stats line is one text run.

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
| Coordinates | `coords` (`coord-light` / `coord-dark`) | `board-coord-on-light` (`#7a5232`) / `board-coord-on-dark` (`#ffffff`), bold, 0.75rem, 0.875rem from `lg` |
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

Design decisions only; no product rule changes. Superseded by #381 part 4
(2026-11-26): 3 and 4 (the actions moved to the Repertoire screen,
R-226) and 5 (the Edit switch shows its word at every width).

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

> Note (2026-11-25): Lithuanian language support was dropped (R-217, #378). References here to Lithuanian copy, `glossary-lt.md`, the i18n-content role or R-180 are historical.
