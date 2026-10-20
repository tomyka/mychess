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
