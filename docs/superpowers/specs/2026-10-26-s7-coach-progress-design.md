# S7 Coach progress: design

Issue #257 (epic #250). Slice plan: `2026-10-16-m1-slices-plan.md`, row S7.
Brainstormed with the owner on 2026-10-26. Needs S5 (assignments) and S6
(training), both done. The Reviews (`reviews`: learned_at, skipped_at, due,
lapses) and the results log (`review_results`) exist since S6; the coach's
assignment rows with overdue, paused, forked and done exist since S5
(`packages/db/src/assignments/coach.ts`).

## The rulings applied

| Ruling | What it means here |
| --- | --- |
| R-14 | Coach monitoring: drill progress per line and activity. Weak spots, streaks and real-game deviations stay in M2 |
| R-39 | The coach sees progress only on Repertoires they assigned (live, not forked) and on those shared with them; never the Player's private Repertoires |
| R-42 | A Repertoire shared with the coach shows the Player's progress on it as if assigned |
| R-46, R-51, R-128, R-132 | Paused, overdue and forked are the S5 badges, reused as they are |
| R-50 | Progress is shown to the coach only, never to other members of the Group |
| R-56 | Mastered (line, chapter, Repertoire) = every own Move learned and retrievability >= 90% today |
| R-58 | The coach sees skipped Moves ("I know this") |
| R-129 | Done = every own Move learned or skipped |

## New rulings (owner, 2026-10-26)

- **R-151** The coach sees each own-side Move of a Repertoire in exactly one
  state: not started (no Review), skipped ("I know this", never graded),
  due (Review due now), learned (scheduled, not due). Mastered is a badge on
  a line, chapter or Repertoire, not a state.
- **R-152** Progress drills down from the Repertoire to its chapters, and
  from a chapter to its lines.
- **R-153** The Group page shows a grid: one row per Group Player, one column
  per Repertoire assigned to the Group; each cell holds % learned, the due
  count and the badges, and opens that Player's progress on it.
- **R-154** The coach sees when a Player last trained ("last trained today /
  4 days ago"), counted only from results on Repertoires the coach may see
  progress on. Streaks wait for M2.
- **R-155** A forked Assignment shows only its "Asmeninė kopija" badge, no
  progress: the fork is the Player's own Repertoire (R-39). Sharing the fork
  (R-42) shows its progress like any shared Repertoire.

## Lead decisions

1. **Computed at read time** (approach 1). No new tables and no counters:
   a pure function over the graph and the Player's Reviews. Mastered depends
   on time anyway (retrievability), so counters would still need it.
2. **% learned** = (learned + due + skipped) / own Moves: a Move counts once
   it has a Review. A Repertoire without own Moves shows no percentage.
3. **Moves are counted per Repertoire**: a Move held by two Repertoires counts
   in each. Dormant Reviews (Moves no longer in the graph) never count, by
   construction. A Review is one per Player and Move (R-53), so training on
   a private Repertoire or a fork counts on an overlapping visible Move;
   the owner accepted this (R-156, security review).
4. **A paused Assignment still shows its states** (due included) with the
   "Pristabdyta" badge; the coach sees where the Player stopped.
5. **Lines are rendered in one pass, server side**: every chapter's lines
   are computed with the page and shown in a disclosure per chapter. The
   computation is pure and cheap; no lazy loading.
6. **Last trained** uses `review_results.answered_at` (when the Player
   trained, not when the batch arrived), filtered to the Repertoires of
   R-154.
7. **One progress page per Player + Repertoire** serves both an Assignment
   and a shared Repertoire; the shared Repertoire's existing page links to it.

## Design

### Chess (`packages/chess/src/training/coach-progress.ts`)

- **`moveState(review, now)`**: `notStarted` (no Review), `skipped`
  (skipped_at set, never graded, not due), `due` (due <= now), `learned`.
  A skipped Move whose first Review is now due counts as `due`.
- **`progressOf(graph, reviews, now)`**: for the Repertoire, each chapter
  and each line, the four counts and `mastered` (the existing `mastered`);
  `percentLearned(counts)` beside it. A line is a root-to-leaf path of the
  chapter's tree (`paths()`, linear in the chapter's size; `lines()` can
  grow exponentially through transpositions), labelled by its Moves from
  the chapter's start; a line without an own Move is left out.

### Domain (`packages/domain`)

- **`canCoachSeeProgress(coachId, playerId, repertoireId, facts)`**, built
  on `canCoachSee` (refined while planning: `CoachSubject` and
  `CoachAccessFacts` stay as they are, so their 13 constructions do not
  change). It allows a Repertoire shared with this coach, or assigned by
  this coach to this Player and not forked. A forked one is refused
  `access.forked` (the UI shows the badge only); anything else
  `access.notShared`.
- **`CoachProgressFacts`** = `CoachAccessFacts` plus this coach's
  `assignments` reaching the Player (`assignmentFacts`, forked or not).
- **`progressRepertoireIds`**: the shared and live assigned Repertoires,
  whose results count for last trained (R-154).

### Database (`packages/db`)

- **`coachPlayerProgress(db, coachId, playerId, now)`**: for the player page,
  every Repertoire of this coach reaching the Player (with the S5 badges)
  and every Repertoire shared with the coach, each with its Repertoire-level
  progress; forked ones with the badge only; plus last trained.
- **`coachRepertoireProgress(db, coachId, playerId, repertoireId, now)`**:
  for the progress page, the full `progressOf` with chapters and lines;
  `undefined` when `canCoachSeeProgress` refuses.
- **`coachGroupProgress(db, coachId, groupId, now)`**: the R-153 grid: the
  Group's Players, the Group's Repertoires, one cell each, and each Player's
  last trained.
- **`lastTrained(db, coachId, playerIds)`**: R-154, one statement.
- Each repository decides access through the domain and filters again in
  SQL on the link, `assignments.coach_id` or the share row (Q26). Reviews
  are read once per call for all Players, restricted to the Repertoires'
  own-side keys. One repeatable-read transaction; the number of statements
  does not grow with the number of Players, and each Repertoire shown adds
  its graph load (3 statements, as everywhere else).
- "Last trained" leaves the loader as whole days ago in Vilnius, so the
  server and the browser render the same text.

### Web (`apps/web`)

- **Players list** (`/treneris`): last trained under each name.
- **Player page** (`/treneris/zaidejai/[playerId]`): a "Progress" section
  above the shared Repertoires: one row per Repertoire with the four-state
  bar, % learned, due count and badges, each to its progress page; last
  trained in the header.
- **Progress page** (`/treneris/zaidejai/[playerId]/<slug>/[repertoireId]`,
  slug from i18n-content): the Repertoire bar with the four counts, then one
  disclosure per chapter (bar, Mastered badge) holding its lines (label,
  bar, Mastered). 404 when the coach may not see it.
- **Group page** (`/treneris/grupes/[groupId]`): the R-153 grid above the
  members; on a phone the grid scrolls sideways with the name column fixed.
  Rows are the Group's current Players, so every cell has an Assignment
  (inherited on joining, Q31); a forked cell shows its badge only.
- **The four-state bar** is one component with a text legend (counts in
  words, not colour alone) for screen readers and colour-blind users.
- All text through the catalogues; i18n-content names the four states,
  "Mastered", "last trained" and the page slug. ux-designer signs off at
  390px and 1280px in both themes.

## Error handling

- A coach who may not see the Player or Repertoire gets 404 (S4 plan
  decision 4), the same for unlinked, unshared, forked-and-requested by URL
  and malformed ids.
- A Repertoire with no own Moves shows "nothing to learn" instead of a bar.
- A Player with no results on visible Repertoires shows "not trained yet".

## Testing

- Chess: unit and property tests for `moveState` and `progressOf` (counts sum
  to own Moves; mastered matches `mastered`; chapter counts sum to the
  Repertoire's when no own Move is in two chapters; a Move shared by two
  chapters counts in each chapter and once for the Repertoire).
- Domain: `canCoachSeeProgress`: shared, assigned, forked, paused,
  unlinked, another coach's Assignment.
- DB (Testcontainers): each repository against an unlinked coach, another
  coach, a private Repertoire, a forked Assignment, a group member removed;
  last trained ignores private-Repertoire results; statement count fixed.
- Web: component tests for the bar, the grid, the progress page.
- E2E: C-M1-5 against a QA fixture that writes a known Review history for
  the coach persona's three Players; the coach sees exactly that history.
  Security-reviewer signs off (coach access to Player data).

## Out of scope

Weak spots and the weak-spot dashboard, streaks, real games vs Repertoire
(M2); progress on the coach's own Repertoire page per reached Player;
notifications; the Player seeing their own per-line progress.
