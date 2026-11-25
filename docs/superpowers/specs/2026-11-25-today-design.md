# Today (#381, part 2)

Issue #381, sub-project 2 of 6 (order in
`2026-11-25-app-shell-and-visual-refresh-design.md`). Part 1 gave every
screen the shell, the Ocean tokens and Inter. This spec redesigns the content
of the Today tab (`/`) for a phone and for desktop.

## Audit findings this spec answers

From the ux-designer audit of 2026-11-25:

- Training is not the headline on home: the greeting is the largest text and
  the review block reads like any other section.
- The player sees no progress: nothing says how much of a repertoire they
  know.
- There is no Train action per repertoire: only the due ones are named, as
  text links, and a repertoire with nothing due cannot be started from home.

## Rulings applied

New, given by the owner in the #381 part 2 brainstorm on 2026-11-25
(recorded in `docs/owner-rulings.md`):

- **R-221:** Today lists every repertoire the player trains, own and
  assigned, each with its learned percentage (the R-177 meaning), a Mastered
  marker, and a Review N or Learn button when it has work; the row itself
  opens the repertoire. Due repertoires first (R-207 order), the rest in the
  R-145 order.
- **R-222:** "From my coach" is no longer a separate home section; an
  assignment is a row of that list with its coach, deadline and badges. A
  paused assignment has no button.

Unchanged and applied: R-142 and R-207 (today's review over every trained
repertoire, each repertoire's due count and its own review), R-145 (learn
order), R-146 (daily allowance), R-46 (a paused assignment is not trained),
R-51, R-133 (badges), R-44, R-45, R-130, R-131 (fork offers), R-56, R-178,
R-182 (Mastered), R-177 (learned percentage), R-217 (English, catalogue
only), R-218 to R-220 (shell, style, Ocean), `docs/design/README.md`.

## Layout

### Phone (below `md`)

```
+--------------------------------------+
| mychess                         (TK) |
+--------------------------------------+
| Good evening, Gabija                 |  muted greeting line
| +----------------------------------+ |
| | 12 due                           | |  hero card (accent)
| | about 6 min                      | |
| | [ Start review ]                 | |
| | [ Learn 5 new moves ]            | |
| +----------------------------------+ |
| +----------------------------------+ |
| | My repertoires                   | |
| | Sicilian Najdorf  Black [Review 8]| |
| | ======------  62% learned        | |
| | Caro-Kann  Black  [Learn]        | |
| | Rimantas V. · deadline 3 Dec     | |
| | =-----------  10% learned        | |
| | London System  White             | |
| | ============ 100% learned · Mastered |
| +----------------------------------+ |
| +----------------------------------+ |
| | Copies you can keep              | |  only when there is any
| +----------------------------------+ |
+--------------------------------------+
| Today(12)  Repertoires  Opponents    |
+--------------------------------------+
```

One column: greeting, hero, list, offers.

### Desktop (`md` and up)

Inside the 1040px content container, a two-column grid: the left column
(about 40%) holds the hero and, below it, the offers card; the right column
holds the repertoire list. The greeting line spans both columns above them.
The columns align to the top; neither is sticky.

## The hero card ("Today's review")

An `accent` card with `accent-fg` text. Its state is decided by a pure
`heroState`:

| State | When | Shows | Main button | Second button |
| --- | --- | --- | --- | --- |
| `due` | due > 0 | "12 due" (large), "about 6 min" | Start review (`trainingPath('review')`) | Learn N new moves (`trainingPath('learn')`), only when toLearn > 0 |
| `learn` | due = 0, toLearn > 0 | "Nothing due now", the next review time if any | Learn N new moves | none |
| `done` | due = 0, toLearn = 0, has repertoires | "All done for today", the next review time if any | none | none |
| `empty` | no trained repertoire | a welcome line | Create a repertoire (`ROUTES.repertoires`) | Import PGN (`ROUTES.repertoireImport`) |

The card's heading stays "Today's review" (R-148) for screen readers in
every state; visually the count is the headline. The buttons on the accent
card use an inverted style (surface background, `accent` text) and a
translucent secondary; both are checked for AA contrast in both themes.

## The repertoire list ("My repertoires")

A card with an `h2` and one row per repertoire the player trains: every own
repertoire and every live assignment, paused ones included. This replaces
the "From my coach" section (R-222). It is not shown in the `empty` state.

Each row:

- **Name:** a link to the repertoire page; for an assignment, the assigned
  repertoire page (`assignedRepertoirePath`). It wraps; it never truncates.
- **Side:** "White" or "Black", muted, next to the name.
- **Assignment facts:** for an assignment, the existing `AssignmentFacts`
  (who assigned it, the deadline, the overdue, paused and updated badges).
- **Progress:** a bar and "N% learned" (`percentLearned`, R-177). The bar is
  decorative (`aria-hidden`); the text carries the value. A repertoire
  without own moves shows no bar and no percentage.
- **Mastered:** when the repertoire's standing is mastered (R-178, R-182),
  "Mastered" follows the percentage, in the `learned` colour.
- **Button:**
  - due > 0: "Review N" to `trainingPath('review', id)`.
  - else, can learn: "Learn" to `trainingPath('learn', id)`.
  - else (nothing left, today's allowance used up, or a paused
    assignment): no button.

  The button is a secondary (`accent-subtle`) control, at least 44px, and
  is described by the row's name (`aria-describedby`) so it reads "Review 8,
  Sicilian Najdorf".

**Order:** repertoires with due moves first, in the `dueByRepertoire` order
(R-207); then the rest in the training snapshot's order, which is R-145
(deadline assignments earliest first, other assignments, own repertoires).

## Copies you can keep

The fork offers (`ForkOffers`) keep their behaviour and text. They become a
card: below the hero on desktop, below the list on a phone. Not shown when
there is none.

## The greeting

The greeting stays (`app.greeting`) as a muted line above the content, no
longer an `h1` in large type. The page's `h1` is visually hidden and reads
"Today" (the tab's name), so the heading order is `h1` Today, `h2` Today's
review, `h2` My repertoires, `h2` Copies you can keep.

## Architecture

### Data

Home already reads one training snapshot (`trainingSnapshot`, scope `all`)
for `todaySummary`. Its entries are every repertoire the player trains,
paused assignments included (`active: false`), in the R-145 order, each with
its graph; it also holds the player's reviews, today's learned count and the
limits. The list needs no new query.

- **`packages/chess`:** a new pure `todayRows(day, now)` in
  `src/training/`, returning for each entry, in the order above:
  `{ repertoireId, standing, due, canLearn }`. `standing` is
  `repertoireStanding` of the entry's graph and the reviews; `due` is the
  entry's due count; `canLearn` is whether a learn session scoped to that
  repertoire would start (the `learnStart` test `repertoireTraining` already
  uses), always false for an inactive entry. The ordering rule lives here.
- **`apps/web/src/server/training.ts`:** `TodaySummary` gains
  `rows: readonly TodayRow[]` (the `todayRows` output with each entry's name,
  side and kind) and loses `repertoires`, which the rows replace.
  `todaySummary` stays request-cached; the shell's badge keeps reading its
  `due`.
- **`apps/web/src/server/today-page.ts`** (new): `todayPage(account)` reads
  `todaySummary` and `homeAssignments()`, attaches each assignment's facts
  to its row by repertoire id, and returns
  `{ displayName, summary, rows, offers }`. A row whose assignment facts are
  missing (unassigned between the two reads) shows without facts.

### Components (`apps/web/src/app/today/`)

| Unit | Does | Replaces |
| --- | --- | --- |
| `TodayView` | greeting, hidden `h1`, the one- or two-column grid | `home-view.tsx` |
| `hero-state.ts` | pure: `heroState(summary)` returns `due` / `learn` / `done` / `empty` | |
| `TodayHero` | renders the state's text and buttons | `today-block.tsx` |
| `RepertoireRows`, `RepertoireRow` | the list card and one row | `from-my-coach.tsx` |
| `ProgressBar` | the decorative bar for a percentage | |

`ForkOffers` and `AssignmentFacts` are reused as they are (`ForkOffers`
moves into a card wrapper). `page.tsx` calls `todayPage` and renders
`TodayView` in `AppShell`.

### Catalogue

New keys under `today`: the hidden page title, the hero's `done` and `empty`
texts, the empty state's two actions, the list title "My repertoires",
"{percent}% learned", "Mastered", "Review {count}", "Learn". Existing keys
under `training.today` are kept where their text is unchanged; unused ones
are removed (knip and the catalogue check catch leftovers).

## Error handling

- No snapshot (an account with nothing to train): the `empty` state, no
  list.
- `homeAssignments` and the snapshot are read separately; a row whose
  assignment is gone shows as a plain row; an assignment with no row (it
  appeared between the reads) is not shown until the next load.
- The training screen still decides what a session holds; a stale button
  (its moves reviewed in another tab) opens a session that says there is
  nothing to do, as today.

## Testing

- **Unit (`packages/chess`):** `todayRows`: due repertoires first in
  `dueByRepertoire` order, then the snapshot order; an inactive entry has
  `canLearn` false even with new moves; a used-up allowance gives `canLearn`
  false; standing and mastered per repertoire; a repertoire without own
  moves.
- **Unit (web):** `heroState` for each state and its boundaries; `todayPage`
  joins facts by id and tolerates a missing one.
- **Component:** `TodayHero` (buttons and targets per state), `RepertoireRow`
  (Review N, Learn, none for paused and for nothing left; the assigned link
  target; badges; percentage and Mastered; the accessible name of the
  button), `TodayView` (heading order; offers only when any).
- **E2E:** a new `@mobile` journey: Today shows the hero and the list; a
  row's Review starts that repertoire's review (R-207); back on Today the
  count has dropped. Existing journeys that used "From my coach" or the due
  repertoire links are updated.
- **Sign-off (ux-designer):** 390px and 1280px, light and dark, in the
  `due`, `learn`, `done` and `empty` states, with an assignment (overdue and
  paused) and an offer; keyboard pass; 200% zoom; the hero's button contrast
  added to the contrast table.

## Docs

- `docs/design/README.md`: the Today layout and the hero card.
- `docs/owner-rulings.md`: R-221, R-222.

## Out of scope

- Streaks, activity history or other stats (no ruling; R-154 defers streaks).
- The Repertoires tab's own list (part 4).
- The training screen (part 3).

## Done means

Today shows the hero in its four states and the list of every trained
repertoire with progress and its own Review or Learn; "From my coach" is
gone as a section; desktop uses two columns; the gate and E2E are green and
the ux-designer has signed off at 390px and 1280px in both themes.
