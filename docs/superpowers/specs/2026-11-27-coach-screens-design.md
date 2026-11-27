# Coach screens (#381, part 5)

Issue #381, sub-project 5 of 6 (order in
`2026-11-25-app-shell-and-visual-refresh-design.md`). Parts 1 to 4 are on
main. This spec restyles the coach area to the Ocean style and fixes what the
ux-designer audit of 2026-11-27 found: the dashboard (`/coach`), a group
(`/coach/groups/[groupId]`), a player (`/coach/players/[playerId]`), a
player's progress (`/coach/players/[playerId]/progress/[repertoireId]`), a
shared repertoire with the coach note
(`/coach/players/[playerId]/repertoires/[repertoireId]`), the assignment part
of the Repertoire screen (`/repertoires/[id]/manage`) and the coach's own
repertoires on Today and My repertoires.

The scope is **restyle, fix and surface** (owner, 2026-11-27): the screens
keep their capabilities, and they show facts the app already computes
(deadlines, due counts, the done state, who needs attention). No new data:
weak spots (lapses per line) stay in M2.

## Audit findings this spec answers

From the ux-designer audit (390x844, 375x667, 1280x800, 1440x900, both
themes; coach persona Rimantas, players from the persona seeds):

1. `/coach`: no progress, due count or % anywhere; alphabetical; each player
   row about 240px (about 4,000px for 18 players); "Overdue" does not say
   which repertoire.
2. Player page: assignment deadlines are not shown (only an Overdue badge);
   the coach's own assigned repertoire is not reachable from it.
3. "Last trained N days ago on the repertoires you can see" repeats on every
   row and wraps to 3 lines in the phone grid.
4. Group page: the rename form comes first (Group progress starts at y=273 on
   a phone); the group's assignment, its deadline and its invite link are not
   on the page; at 1280 the player column takes about 575px of 926px.
5. Group grid cells: "0% learned / 43 due" and "0% learned / 0 due" look
   the same; due is not amber; no bar.
6. Coach note: about 440px below the visible panel on a phone; on desktop it
   is at y=933-1155, so the board scrolls away.
7. Forks: "Naidorfo variantas" shows three times on one player page; the
   fork's pages are titled like the coach's original.
8. The coach's Today lists the 9 repertoires he wrote for players, with
   Learn buttons; My repertoires shows his own "New · 52 moves" bars on them.
9. The four-count line repeats zeros ("0 marked as known" on every row) and
   wraps at 375.
10. Progress lines are a wall of SAN from move 1.
11. `/coach`: always-open Create group and Create invite forms, two competing
    full-width primaries; a new invite link lands half under the phone tab
    bar.
12. Repertoire screen assignments: "due Dec 20" uses the training word for a
    deadline; Change shows three same-weight buttons, Unassign not marked
    destructive; Assign is a secondary button; the date shows mm/dd/yyyy;
    assignee rows mix "New · 43 moves" and "0% learned" and show no due,
    Overdue or Paused; the picker does not say which players already have it
    through a group.
13. Unlink sits on every dashboard row; its confirmation pushes the list down.
15. Dark: the selected radio card fills near-black and reads as a hole.
16. Desktop shared repertoire scrolls (976px at 1280x800).
17. 375x667 shared repertoire: the "name · Progress" line costs a row.

Not in this part: finding 14 (the invite acceptance page) and finding 18
(My coaches on the player side) go to part 6, secondary screens; threads,
notifications, goals and weak spots are not built (M2, M3).

## Rulings applied

New, given by the owner in this brainstorm (recorded in
`docs/owner-rulings.md`):

- **R-229:** The coach dashboard leads with **Needs attention**: the players
  with a reason, each with its most urgent reason in words, then every player
  as a compact row. The reasons, most urgent first: an overdue assignment
  (R-132: paused ones too); a deadline within 3 days at under 80% learned
  and not done; 30 or more moves due on what the coach may see; no training
  for 7 days while holding an unfinished, unpaused assignment.
- **R-230:** A coach's own repertoire assigned to at least one player or
  group is teaching material: it is not on the coach's Today nor in its
  counts or the Today badge, and its My repertoires card shows its
  assignees, not the coach's own progress. The coach can still open it and
  use Train here. Unassigned from everyone, it returns to Today.
- **R-231:** The coach's compact progress rows (dashboard, group, player
  page, Repertoire screen assignees) show the four-state bar (learned, due,
  skipped, not started) beside "% learned", the due count when above zero,
  a **Done** pill when the assignment is done (R-129) and "Not started"
  only when nothing is started.
- **R-232:** Invites are split by kind: a group's invite lives on the group
  page (its open link's expiry and New link); a personal invite is made from
  "Invite a player" on the dashboard. A link is shown once, when made (only
  its hash is stored); open personal invites list their dates with Revoke.

Unchanged and applied: R-42, R-44, R-98, R-99, R-107, R-113, R-114, R-124,
R-125, R-129, R-130, R-132, R-138, R-151, R-152, R-154, R-155, R-156, R-158,
R-160 (name order, English since R-217), R-177, R-204, R-217 to R-228.

## Lead decisions

- **Unlink** leaves the dashboard rows; it is on the player page only.
- **A forked assignment and its shared fork** are one row on the player page,
  "<name>'s own copy of <repertoire>", with progress only when the fork is
  shared (R-155). The fork's progress and board pages carry the same title.
- **No "Assign" on the group page:** assigning stays on a repertoire's
  Repertoire screen (a group-side repertoire picker would be a new
  capability).
- **Lines on the progress page stay text** (a jump to a line's position on
  the board would be new).
- **The "repertoires you can see" qualifier** of last trained (R-154) is one
  footnote per page, not a suffix on every row.

## Shared pieces

- **`StateBar`** (the four-state bar of S7, `coach/state-bar.tsx`) in two sizes: 6px for
  rows, 8px for page headers. Colours: learned `learned`, due `due`, skipped
  `skipped`, not started the track.
- **`AssignmentStatus`**, one line in the same words everywhere: "Due 30 Nov
  · in 3 days" ("due today" on the day; amber when under 3 days and not
  done), the Overdue pill, the Paused pill, the Done pill, "No deadline".
  On the Repertoire screen, where "due" would read as training, the same
  facts read "deadline 20 Dec".
- **`ProgressCounts`**: "% learned · N due · N marked as known · N to learn",
  leaving out every zero count; "Not started · N moves" when nothing is
  started; the Mastered pill when mastered (R-178).
- **Cards and rows** use part 1's soft shadowed card; destructive actions
  (Unlink, Remove, Delete group, Unassign, Revoke) use the error tone and
  keep their confirmations.
- **Selected radio card** (dark finding 15): `accent-subtle` fill with an
  `accent` ring in both themes, wherever the radio card is used.

## The dashboard (`/coach`)

- **Header:** `PageHeader` "Coach", with **Invite a player** (secondary) at
  its right.
- **Needs attention · N:** one card per player with a reason (R-229), most
  urgent player first (by reason, then by name). The card is a link to the
  player page: the name in semibold, then the reason in words with a 3px left
  edge in its tone:
  - overdue, `error`: "Italian is 2 days overdue" (several: "2 repertoires
    overdue");
  - deadline near, `due`: "Slav due in 3 days · 3% learned";
  - due pile-up, `due`: "52 moves due";
  - idle, `border-strong` edge: "Has not trained for 12 days" (never
    trained: "Has not trained since linking, 12 days ago").
  Phone: a column; desktop: three cards per row. No section when nobody has
  a reason.
- **Players · N:** every linked player, by name (R-160), one compact link row
  (about 64px on a phone): name and last trained ("today", "5 days ago",
  "never") on the first line; the `StateBar` and overall % learned over
  what the coach may see, the due count (amber above zero), and the next
  deadline ("by 30 Nov"; the Overdue pill when overdue) or the Done pill when every assignment
  is done. Desktop: a table, columns Player / Progress / Due / Next deadline /
  Last trained. A player with nothing the coach may see shows "Nothing
  assigned or shared". Footnote once under the list: "Last trained counts
  only the repertoires you can see."
- **Groups · N:** cards (name, "N players", the group's assignments with
  deadlines), each a link to the group page; **New group** opens the create
  form inline (R-204: creating shows the group invite link). Desktop: the
  groups are a side column beside Needs attention and Players.
- **Removed from the page:** the Invites section, the always-open create
  forms, Unlink on rows.
- **Empty states:** no players: one line on how to invite and the Invite a
  player button; no groups: the New group link only.

## Invite a player

A bottom sheet on a phone, a dialog on desktop, opened from the dashboard
header:

- One sentence on what a player gets by accepting, then **Create link**
  (primary).
- After creating: the link in a read-only field with **Copy**, and "This
  link is shown once and works for one player until <date>." The sheet keeps
  it in view (never under the tab bar).
- **Open invites:** each personal invite with "made <date> · expires <date>"
  and **Revoke** (error tone, confirmed). Their links are not shown again.
- Refusals (R-114, Coach mode off) show in the sheet's status line.

## A player (`/coach/players/[playerId]`)

- **Header:** back to Coach; the name (`text-2xl` semibold); one meta line:
  last trained · "linked since 12 Oct" · the coach's groups the player is in,
  each a link.
- **Repertoires · N:** one card per repertoire the coach may see (assigned
  or shared, R-42), replacing the separate Progress, Shared repertoires and
  Groups sections. Order: overdue first, then by deadline soonest, then
  shared ones by name. Each card:
  - the name and a tag: **Assigned**, **Shared with you**, or **<name>'s own
    copy**;
  - assignments: `AssignmentStatus`;
  - `StateBar` and `ProgressCounts`;
  - **Progress** (to the drill-down) and **Open repertoire** (assigned: the
    coach's own repertoire page) or **Open & add notes** (shared: the
    read-only view).
  A forked assignment not shared: the tag and "Your progress view ended when
  <name> made their own copy." (R-155), no bar, no links.
  Phone: one column; desktop: two.
- **Footnote:** the last-trained qualifier, once.
- **Unlink <name>:** error tone with its confirmation (R-44 effects stated);
  at the bottom on a phone, at the right of the header on desktop.

## A group (`/coach/groups/[groupId]`)

- **Header:** back to Coach; the name with a **Rename** link that swaps the
  title for the rename form inline (Save, Cancel); meta line: "N players" and
  the group's assignments with deadlines. **Delete group** in the error tone,
  confirmed: at the bottom on a phone, at the right of the header on desktop.
  R-113 (read-only while Coach mode is off): Rename, Remove, Add and Delete
  are not rendered, and a line says why.
- **Progress** first:
  - Phone: one card per player (name and last trained), then one line per
    group repertoire: its name, a 6px `StateBar`, %, the due count in
    amber, or Done / Not started / Overdue / Paused.
  - Desktop: a grid, players down (about 170px column, names not wrapped
    beyond two lines), the group's repertoires across, Last trained last.
    Each cell holds the same as the phone line.
  - Players by name; the name links to the player page, a cell to that
    player's progress on that repertoire. Footnote: the last-trained
    qualifier, once.
- **Assigned to this group:** each repertoire, its deadline and "N done of
  M"; a row opens the repertoire's Repertoire screen.
- **Invite link:** "An open link expires <date>" (or "No open link"), "Links
  are shown once; make a new one to share again.", and **New link**, which
  shows the new link inline with Copy, in view.
- **Players · N:** the members with **Remove** (error tone, confirmed) and
  **Add a player** opening the existing picker inline.
- Desktop: the progress grid takes two-thirds; assignments, invite link and
  players are the side column.

## A player's progress (`/coach/players/[playerId]/progress/[repertoireId]`)

- **Header:** back to the player; the repertoire's name (a fork: "<name>'s
  own copy of <repertoire>", its tag just "Own copy"); the tag and `AssignmentStatus` as on the player
  card; the 8px `StateBar` and % learned; `ProgressCounts`; **Open
  repertoire** / **Open & add notes**.
- **Chapters:** disclosures, closed by default: the full title (R-158), a
  6px bar, % and due, or "Not started · N moves", or Mastered.
- **Lines** inside an open chapter: written from where they leave the
  chapter's trunk (the moves every line of the chapter shares), so "… 5. a4
  Bf5 6. e3 e6" rather than the whole line from move 1; numbered from the
  chapter root as on the repertoire page; a one-line chapter shows its whole
  line. Each wraps, with its state on the right: "N due", "Not started",
  Mastered or "N% learned".

## A shared repertoire and the coach note (`/coach/players/[playerId]/repertoires/[repertoireId]`)

The part-4 repertoire page layout (fixed board region on a phone, board at
viewport height on desktop, so no page scroll at 1280x800), with:

- **Header:** back to the player and **Progress** on one row; the name (a
  fork: "<name>'s own copy of …") and a **Shared with you · read-only** tag,
  replacing the "Read-only…" sentence.
- **The coach note** sits with the comment strip, never past the move list:
  - Desktop: under the player's comment, a card "My coach note on 5... Qc7 ·
    you and <name> see this": the note, **Edit** and **Delete** (error tone);
    without a note, **Add a note**. Edit turns the card into the textarea with
    Save and Cancel, in place.
  - Phone: a one-line strip in the fixed region under the comment: the pen
    glyph, the note cut to one line, and Edit (or Add a note). Editing opens a
    bottom sheet with the textarea, Save and Delete, so the board stays put.
  - The pen mark in the move list stays (`coach-shared-repertoire.md`).

## Assignments on the Repertoire screen (`/repertoires/[id]/manage`)

- **Assigned to:** player rows: name, 6px `StateBar`, % learned, due count
  (amber), the deadline as "deadline 20 Dec", the Overdue, Paused or Done
  pill; a fork: "Own copy", no progress (R-155). Group rows: the group name
  and the deadline (its players' rows follow it, as now).
- **Change** opens inline: a date field shown as day month year
  (`MEDIUM_DATE` style label beside the native input, the stored value
  unchanged), **Save deadline** (primary), **Clear deadline** (text button),
  then, apart, **Unassign** in the error tone with its confirmation stating
  R-130's effects.
- **Assign to players:** a player who already has the repertoire through a
  group stays assignable (R-134: an individual assignment gives them their
  own deadline), labelled "has it via <group> · assigning sets their own
  deadline"; the deadline field as above; **Assign** is primary.

## The coach's own repertoires (R-230)

- **Today:** leaves out the coach's own repertoires that are assigned to at
  least one player or group, from its list, its counts and the Today tab
  badge.
- **My repertoires card** of such a repertoire: the meta line keeps
  "Assigned to N" (as since part 4), with no own `LearnedBar` or own due
  count; who has done it is on its Repertoire screen and the group pages.
- The repertoire page, its Train here and its summary row are unchanged: the
  coach can still drill it.

## Domain and data

- **Needs attention** is a domain rule: a pure function in `packages/domain`
  (`attentionOf(player facts, now)`) returning the most urgent reason or
  none, from facts the coach-progress reads already give per player and
  assignment (deadline, overdue, paused, done, % learned, due count, last
  trained). Its thresholds (3 days, 80%, 30 due, 7 days) are named
  constants there. Days count in Europe/Vilnius, as overdue does.
- **Dashboard read:** one batched read (`coachDashboard`) gives, per
  player, the rows the player page shows (progress, due counts, status),
  through the same coach-progress access step (Q26, R-156), in one
  snapshot: a fixed number of statements whatever the number of players,
  plus 4 per repertoire and scope shown. No per-player query loop.
- **Teaching material** (R-230): "assigned to at least one player or group"
  decided in the domain and applied in Today's read.
- **Group done counts** and the picker's "has it via" come from the
  assignment reads that exist; any new read gets db tests with the access
  rules.

## Testing

- Domain: `attentionOf` per reason, at each threshold edge, the urgency
  order, paused-but-overdue, done never overdue, the Vilnius day boundary.
- Components: Needs attention card per reason; player row (zeros, done,
  nothing visible); player card (assigned, shared, fork shared, fork not
  shared); `AssignmentStatus` (in N days, today, overdue, paused, done, no
  deadline, "deadline" wording); `ProgressCounts` zero dropping; group phone
  card and grid cell; invite sheet (created, shown once, revoke); coach note
  card and phone sheet; Repertoire screen Change panel and the picker's "has it
  via" label.
- db: the extended dashboard read and Today without teaching material, with
  the access rules.
- E2E: the coach journeys (invite, create group, assign, change deadline,
  unassign, unlink, write a coach note) through the new places; a phone
  journey checks the coach note is reachable without scrolling the panel.
- ux-designer: height budget before code (375x667, 390x844) for the shared
  repertoire and the group page; sign-off at 390x844, 375x667, 1280x800 and
  1440x900 in light and dark; `docs/design/coach-shared-repertoire.md`
  updated to the new note placement.

## Acceptance

- Every audit finding above is answered as this spec says, at phone and
  desktop width in both themes.
- R-229 to R-232 are in `docs/owner-rulings.md`.
- Gate green, E2E green on desktop and Pixel 7, ux-designer signed off.
