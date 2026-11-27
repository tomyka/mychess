# Sharing with a coach, and coach notes

The S4 Part B screens (#254, plan
`docs/superpowers/plans/2026-10-17-s4-coaching-links.md`, Tasks B5-B7;
rulings R-42, R-107, R-124 to R-126): **Share with a coach** and the
coaches' notes on the owner's repertoire page (`/repertuarai/[id]`), the
**Shared repertoires** section on the coach's player page
(`/treneris/zaidejai/[playerId]`), and the coach's **read-only view** of a
shared repertoire (`/treneris/zaidejai/[playerId]/repertuarai/[repertoireId]`)
with the coach-note form. Vocabulary from `docs/CONTEXT.md` (Coach note,
Personal note, Comment); layout rules from `repertoire-screen.md`, which
these screens extend and do not repeat.

## Three kinds of text on a move, told apart

A move can carry up to three texts, and nobody may mistake one for another:

| Text | Who writes it | Who reads it | Panel | Move-list mark |
| --- | --- | --- | --- | --- |
| Comment | the repertoire's owner | owner, coaches it is shared with | plain text under "Comment" | speech bubble |
| Personal note | the viewer | the viewer only (R-21) | `bg-sunken` well, lock, "My note" / "Only you see this" | lock (owner's page only) |
| Coach note | a coach it is shared with | that coach and the owner (R-107); not other coaches (R-125) | bordered card titled with the coach's name | pen (coach's view only) |

- **Owner's page:** coach notes are read-only cards (`rounded-card border
  border-border p-3`), one per coach, each headed "Coach note from {name}"
  in the panel-label style, above the owner's own Personal note. The owner
  cannot edit or delete them.
- **Coach's view:** the coach's own note is a bordered form card: the label
  "My coach note", the hint "You and {name} see this" (whom it is shared
  with, so the coach never thinks it is private), a 3-row textarea, Save
  and, once there is a note, Delete in the error tone. Its status line sits
  under the buttons.

### The coach's move-list mark (decided at B7, ux-designer)

The coach's move list marks every move carrying **the coach's own note**,
so a coach reviewing a player's repertoire sees at a glance where they have
already written. The lock is wrong there (it means "private, only you"),
so the mark is a **pen** glyph (`NOTE_GLYPH.coach` in `move-list.tsx`),
the same size and colour as the comment and lock glyphs, `aria-hidden`,
with the meaning in the chip's accessible name. A note saved or deleted in
the form adds or removes the mark at once.

The owner's move list keeps the lock for Personal notes only; it does not
mark coach notes (a candidate for later: the pen there would read "a coach
wrote here", which the owner may want once several coaches annotate).

## Owner's page: Share with a coach

At the end of the panel, after the move list (phone: after the phone
actions; desktop: at the bottom of the side panel), as a panel section:

```
SHARE WITH A COACH                       panel label (h2)
The coaches you tick see this ...        text-sm fg-muted (intro)
COACHES                                  legend
[x] Rimantas Vaitkus                     min-h-touch rows, size-5 box
[ Save ]                                 SECONDARY_BUTTON
Shared with 1 coach                      StatusLine (info, success, error)
```

- Without a linked coach: the title and one `fg-muted` sentence saying how
  to link; no checkboxes, no button.
- The status line says the current state before any save ("Not shared",
  "Shared with 1 coach") in the info tone, so the state reads without
  ticking through the boxes.

## Coach's player page: Shared repertoires

A `SECTION` like Groups, above it: the title, then one row per shared
repertoire: the name as a link (`text-accent underline`) with the side
("White" / "Black") under it in `text-sm fg-muted`; the whole row is one
`min-h-touch` link. Empty: "{name} has not shared a repertoire with you
yet." in `fg-muted`.

## Coach's read-only view

The repertoire page's layout (board first on a phone, board and side panel
at 1280px), with:

- **Header, phone:** one top bar like the owner's page, so the board starts
  as high: a 44px back chevron (its name "Back to {name}", visually hidden),
  then the repertoire name on one line (`truncate`, `title`) with the
  player's name under it in `text-sm fg-muted` (`aria-hidden`: the back
  link already says it). About 56px; the board starts under it.
- **Header, desktop:** the chevron and "Back to {name}" as an underlined
  link over the name in `text-3xl`, as on the owner's page.
- No mode switch, no rename, delete, import or download anywhere.
- **Panel:** board row (navigation, typed move), the screen status line,
  then in the scrolling body: the read-only line (`text-sm fg-muted`;
  "Read-only: you can write coach notes, but not change the repertoire."),
  chapters, the position (intro at the root; on a move its comment, marks
  as text, and the coach-note form), the move list. No Personal note: the
  coach has none here, and the owner's are never shown (R-42). The
  read-only line sits in the panel, not the header, because it runs to two
  lines on a phone in both languages and would push the board down by
  about 50px.
- A move the chapter lacks, played or typed, is refused in the status line
  as on the owner's page and changes nothing.

### States

| State | What shows |
| --- | --- |
| Loading | `loading.tsx`: skeletons of the header (way back, name and, on a phone, the player's name; same height as the real header) over the repertoire page's loading shell (`repertuarai/[id]/loading-shell.tsx`): the board frame without pieces, panel lines, and "Loading" after about a second (CSS-revealed, `animate-reveal-late`) |
| Empty | a repertoire without chapters: "This repertoire has no moves yet." in the panel; no note form |
| Not shared / unlinked / bad id | 404 (plan decision 4) |
| Note saved / deleted | the form's status line ("Saved" / "Note deleted") in the success tone; the pen mark appears / disappears |
| Note refused (blank, too long, move gone, share ended) | the form's status line in the error tone; the field is `aria-invalid` and described by it |

## Keyboard and screen readers

As on the repertoire page. The note form is a labelled textarea (label plus
the hint by `aria-describedby`) and two buttons; Save does not submit on
Enter (multi-line text). Move chips with the coach's note say so in their
name ("9... Ne5, has a comment, My coach note"; a dedicated catalogue key
"has my coach note" is requested from i18n-content).

## Height budget (#381 part 5)

Task 0 of `docs/superpowers/plans/2026-11-27-coach-screens.md`, for Tasks
11 and 13. Method as in `repertoire-screen.md` (phone board height). Part
sizes were measured on the current build (production, persona coach,
2026-11-27); the new parts are budgeted from them.

### Measured parts (current shell, both widths)

| Part | px |
| --- | --- |
| Tab bar | 56 |
| Top bar, one-line name (4 + 44 row + 4) | 52 |
| Board row (`py-2` + 44) | 60 |
| Comment strip, one line / two lines / none | 36 / 56 / 0 |
| Scroller top padding (`pt-2`) | 8 |
| Chapter line (closed) + gap | 44 + 12 |
| Move row (pitch) | 44 |

### Shared repertoire page, phone

- **Top bar:** one row, as the owner's page: back (44) · the name
  (`text-base/5`, semibold, never clamped) with the tag "Shared with you ·
  read-only" under it (`text-xs/4`, `fg-muted`) · **Progress** (text link,
  44 tall, about 67px with its gap). The name gets about 224px at 375 and
  239px at 390. Height = 8 + max(44, 20 x name lines + 16): **52** for a
  one-line name, **64** for two lines, 84 for three. The seed's "Sicilijos
  gynyba, Taimanovo variantas" (290px) takes two lines at both widths;
  "Naidorfo variantas" (143px) one. A fork's "<name>'s own copy of ..." is
  usually two. Extra name lines come out of the board, not the panel (as on
  the owner's page).
- **The summary row leaves the scroller** (the player's name and Progress
  are now in the top bar), so the scroller is: 8 + chapter line 44 + 12 +
  move rows.
- **Coach note strip:** one 44px row (`min-h-touch`, no extra padding),
  directly under the comment strip in the fixed region. The whole strip is
  one button: pen glyph, the note cut to one line (`truncate`), then "Edit"
  (or "Add a note") as its visible end; accessible name "Edit my coach note
  on 5... Qc7" / "Add a coach note on 5... Qc7". It opens the bottom sheet,
  which overlays and moves nothing. At the chapter root (no move) there is
  no strip, since a coach note belongs to a move.
- **Board cap:** the panel cell's basis on this page is **18.5rem (296px)**
  instead of the owner's 16.5rem: board row 60 + one-line comment 36 + note
  strip 44 + scroller 156 (8 + 44 + 12 + two move rows 88, 4 to spare for
  the flex shrink share). The board cell is unchanged (`flex: 0 100 100vw`,
  `min-h-28`, `container-type: size`, board `w-[min(100cqw,100cqh)]`), so
  the board is `min(100vw, 100dvh - 56 - top bar - 296px)`. Task 13 sets the
  basis through the shell (a prop or a CSS variable on `RepertoireShell`'s
  panel cell); the owner's and the player's pages keep 16.5rem.

Results (scroller rows = whole move rows visible above the tab bar):

| Viewport | Name lines | Top bar | Board | Panel | Scroller: no comment / 1-line / 2-line comment (with the note strip) |
| --- | --- | --- | --- | --- | --- |
| 375 x 667 | 1 | 52 | 264 | 295 | 191 (2.9 rows) / 155 (**2 rows**) / 135 (1.6 rows) |
| 375 x 667 | 2 | 64 | 252 | 295 | same as above |
| 390 x 844 | 1 | 52 | 390 | 346 | 242 (4 rows) / 206 (3.2 rows) / 186 (2.8 rows) |
| 390 x 844 | 2 | 64 | 390 | 334 | 230 (3.8 rows) / 194 (2.95 rows) / 174 (2.5 rows) |

- At the chapter root (no note strip, a two-line intro) at 375 x 667: 179px,
  2.6 rows.
- Against today's coach page at 375 x 667 (board 296, scroller 147: the
  summary row, the chapter line and part of one move row), the coach gives
  32 to 44px of board for two full move rows and the note in view. A
  two-line comment leaves 1.6 rows there; selecting a move scrolls its row
  into view (`block: 'nearest'`), so the current move is always visible.
  A 19.75rem basis would keep two rows under a two-line comment too, but
  leaves a 244px board (30px squares); not chosen.

### Group page, phone

- **Header:** row 1 (44): back (44, `-ml-2`) · the name (`text-2xl`,
  breaks at words) · the account avatar (44). Row 2 (min 44): the meta line
  (`text-sm`, `fg-muted`, wrapping: "3 players · Karo-Kan gynyba: pagrindai,
  deadline 20 Dec") · **Rename** at its right (text link, 44 tall, about
  70px). Rename sits on row 2 because in row 1 it squeezes the name to
  194px (179 at 375) and "Šeštadienio grupė" (213px) would wrap; on
  desktop Rename sits beside the name. Rename swaps the name row for the
  inline form.
- **Spacing:** the header and Progress share one block with `gap-6` (24);
  the Progress section has no top border or padding (it follows the
  header). The sections after it keep the page's `gap-8` and `border-t
  pt-6`.
- **Progress heading y** = 24 (main `pt-6`) + 44 + 4 + row 2 + 24:

| Case | Row 2 | Progress at |
| --- | --- | --- |
| One-line name, meta of 1 to 2 lines (the seed group, both widths) | 44 | **140** |
| Meta of 3 lines (two assignments) | 60 | 156 |
| Two-line name (over about 19 characters at 375), meta 2 lines | 44 | 160 |
| Meta of 4 lines (three assignments or more) | 80 | 176 |

  The same at 375 x 667 and 390 x 844 (the seed name fits one line at
  both; the meta takes two lines at both). Today it is 273.
- Three or more assignments would miss the 160px target by 20px per extra
  meta line. Lead decision: the meta line names at most one assignment, the
  one with the nearest deadline ("6 players · Slav Defence due 30 Nov ·
  +2 more"); every assignment and deadline is in "Assigned to this group"
  just below. So the meta line stays within two lines and Progress at 140
  to 160.
- **R-113 line** (Coach mode off): not in the header; it heads the Players
  section, next to the controls it explains, so Progress stays where
  budgeted. Without Rename, row 2 is the meta line alone (20 per line).
- **Delete group** at the bottom on a phone: no effect on the budget.

> Note (2026-11-25): Lithuanian language support was dropped (R-217, #378). References here to Lithuanian copy, `glossary-lt.md`, the i18n-content role or R-180 are historical.
