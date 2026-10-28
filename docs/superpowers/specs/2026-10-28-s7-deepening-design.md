# S7 deepening and distinct chapter titles: design

Issues #303 (the six candidates of the S7 architecture review, all chosen by
the owner on 2026-10-28) and #301 (owner ruling R-158). Report:
`architecture-review-s7.html` (scratchpad, 2026-10-27). No product behaviour
changes except #301; every refactor keeps the S7 rulings (R-151 to R-157)
and their tests.

## New ruling (owner, 2026-10-28)

- **R-158** When two chapters of one repertoire would show the same title,
  each shows its opening's ECO code and the first move where it differs from
  the others: "Karo-Kano gynyba (B12, 3. e5)".

## Lead decisions

### 1. The progress access rule names its grant (candidate 1, Strong)

- Domain: `progressRepertoire(coachId, playerId, repertoireId, facts)`
  returns the repertoire's `ProgressRepertoire` (below) or undefined when the
  coach may not see it. `canCoachSeeProgress` and the `access.forked`
  refusal are removed. (Built as one union after review, 2026-10-28, rather
  than a separate `progressAccess` result plus a grant type.)
- Domain: `progressRepertoires(coachId, playerId, facts)` lists every
  repertoire the player page shows as one `ProgressRepertoire` each: this
  coach's assignments reaching the player first (`kind: 'granted'`, or
  `kind: 'forked'` carrying the forked assignment for its badge), then the
  shared ones; each entry carries its `source` and its assignment (null when
  shared), so db never works out what a fork means. Refused ones are left
  out; an id is listed once. Empty without a link.
  `progressRepertoireIds` becomes the granted ids of that list. (Refined in
  review, 2026-10-28: the spec first had a forked entry carry the
  `access.forked` refusal; the badge needs the assignment.)
- Db: one `scopeOf(grant, coachId, playerId)` maps `shared` to
  `sharedScope` and `assigned` to `ownScope`; `loadAllowed`'s copy of the
  domain's branch order goes. `standingFor` goes; standings follow the grant.
- The row and cell types carry `view: { kind: 'shown'; standing } |
  { kind: 'forked' }` instead of `standing: Standing | null`; the web reads
  the kind. `source` on a row comes from the grant.

### 2. Whole days in the calendar (candidate 2)

- Domain `calendar.ts` gains `daysBetween(from, to, timeZone =
  HOME_TIME_ZONE)` on its private `localDay`, with its DST tests beside
  `dayStart`'s. The web's `daysAgo` goes; `daysSince` (the null case) stays
  in `apps/web/src/lib` and calls it.

### 3. One numbering module in chess (candidate 3)

- `packages/chess/src/repertoire/notation.ts`: `moveNumber(ply, whiteFirst)`
  and `lineText(sans, whiteFirst)`, moved from `apps/web/src/app/repertoire-view/board-play.ts`
  with their tests. Web callers import them from `@mychess/chess`;
  `drill-panel.tsx`'s private copy goes. `move-list.tsx` and
  `export-pgn.ts` keep their variation rule (a number again after a
  branch) but build it on `moveNumber`.

### 4. One snapshot per coach page (candidate 4)

- `coachPlayerProgress` also returns the linked player (`coachPlayer` in the
  same snapshot). The player page's loader makes that one read: the shared
  list is the progress rows with source `shared` (id, name, side), and the
  separate `assertCoachMaySee`, `coachPlayer` and `sharedWithCoach` calls go.
  The read decides access through the domain (`isCoachLinked`) and returns
  undefined, which is a 404.
- `coachGroupProgress` becomes the group page's one read: the group with its
  members, the coach's linked players not in it (`addable`), and the grid.
  `coachGroupData` goes.
- `coachHomeData` reads the players and their last trained in one
  transaction.
- Security review on this task (it changes where the player page's access
  check runs).

### 5. One coach view of an assignment (candidate 5)

- S5's `coachAssignments` computes done and badges through the S7 module:
  `trackedReviews` plus `coachBadges` (`db/src/progress/view.ts`), so
  "done" (R-129) and the badge composition exist once. `learnedKeys` stays
  only where a player-side caller still needs it; otherwise it goes.
- One `byName` (Lithuanian order, id tiebreak) and one
  `REPEATABLE_READ` option exported from `db/src/client.ts` replace the
  copies across `packages/db`.

### 6. Standing in the glossary (candidate 6)

- `docs/CONTEXT.md` defines **Standing**: a set of Moves' counts per Move
  state plus whether it is Mastered.

### 7. Distinct chapter titles (#301, R-158)

- Chess `chapterDistinctions(graph)`: per chapter, `eco` (its `eco` name
  source, else `classify` of its main line when the chapter starts at the
  initial position, else null) and `firstMove` (the first ply of its main
  line that no other chapter's main line shares: `{ ply, san, whiteFirst }`,
  null when its main line is a prefix of another's).
- Web: the server passes the distinctions with `ecoNames` (the browser never
  loads the ECO tables). `chapterLabel` and the server's `chapterTitle`
  compute each chapter's base title; a title shared by two or more chapters
  gets the catalogue form `chapter.distinct` ("{name} ({eco}, {move})"), or
  `chapter.distinctMove` / `chapter.distinctEco` when one part is missing;
  with neither, the title stays as it is. The move is written with
  `moveNumber` ("3. e5", "2... d5").
- Applies everywhere chapter titles show (repertoire page, board words,
  change summary, coach progress page). PGN export and the data export keep
  plain names.

## Testing

- Every refactor keeps the existing tests green; changed interfaces get
  their tests moved, not dropped.
- Domain: `progressAccess` and `progressRepertoires` for shared, assigned,
  paused, forked, unreached, another coach's, unlinked, oneself.
- Calendar: `daysBetween` across DST and a year end.
- Chess: `chapterDistinctions` for two chapters diverging at move 3, a
  prefix chapter, a FEN-rooted chapter (no ECO), a header-named chapter.
- Web: duplicate titles get the distinct form in LT and EN; unique titles
  stay plain.
- E2E: C-M1-5 and the repertoire journeys stay green; C-M1-5's chapter title
  check covers the B12/B11 pair.
