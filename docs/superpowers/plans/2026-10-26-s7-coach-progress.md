# S7 Coach Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coach sees, for each linked player, where they stand on every
repertoire the coach assigned them or they shared: four move states
(not started, skipped, due, learned), % learned, Mastered, the S5 badges,
and when they last trained. The coach can drill down from a repertoire to its
chapters and lines. A group page shows a players x repertoires grid.

**Architecture:**
- **Chess** (`packages/chess/src/training/coach-progress.ts`): pure. It puts
  each own move in one state (`moveState`) and counts the states with
  Mastered for a repertoire (`repertoireStanding`), and for each chapter and
  line (`progressOf`).
- **Domain** (`packages/domain/src/coach-progress.ts`): the access rule
  `canCoachSeeProgress` is built on `canCoachSee`. It allows shared
  repertoires and live assignments from this coach, and refuses forked ones
  (R-154). `progressRepertoireIds` gives the repertoires whose results count
  for "last trained" (R-153).
- **Database** (`packages/db/src/progress/`): four reads in repeatable-read
  transactions. They read facts, let the domain decide, then filter again in
  SQL through the existing scopes (`repertoireScope`, `sharedTo`,
  `assignmentFacts`). The number of statements does not depend on the number
  of players. Each repertoire shown adds the 3 statements of its graph load.
- **Web**: one loader module (`apps/web/src/server/coach-progress.ts`). It
  adds a state bar component, a "last trained" line on the players list and
  player page, a progress section on the player page, a progress page per
  player and repertoire, and a grid on the group page.

**Tech Stack:** Drizzle 0.45.3 on Postgres 18, Next.js 16.3 App Router
(server components), next-intl 4, zod 4, vitest 4 (Testcontainers for db),
fast-check, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-26-s7-coach-progress-design.md`.
**Issue:** #257 (epic #250). **Rulings:** R-14, R-39, R-42, R-46, R-50,
R-51, R-56, R-58, R-128, R-129, R-132, R-150 to R-154.

**Roles:** each task names its role. Tasks marked `- SECURITY` go through
`security-reviewer`. Tasks marked `- UX` go through `ux-designer` and
`i18n-content`. For each task the order is: developer (test first) -> `qa`
-> `architect` (`mp-code-review` on the task's diff) -> the marked reviewers
-> the lead commits.

**Rules for every task** (CLAUDE.md):
- Test first.
- No suppression comments, no `any`, no `!`.
- Complexity <= 10, CRAP <= 30.
- Every visible string goes in `apps/web/src/i18n/messages/{lt,en}.json`,
  Lithuanian first.
- Refusals are `Result` values with catalogue keys.
- Parse every query result and URL param with zod.
- The acting coach is always the session account.
- A teammate runs only their own package's tests. The lead runs
  `node quality/gate.mjs check` before each commit and checks its exit code
  without a pipe.

**No migration:** S7 adds no table or column.

**Refinements of the spec, made while planning** (already written into
the spec):
1. `CoachSubject` is not widened. A separate `canCoachSeeProgress` builds
   on `canCoachSee`, so the 13 places that construct `CoachAccessFacts` stay
   unchanged.
2. Lines come from `chapterWalks(graph)(id).paths()`, the tree's
   root-to-leaf paths. `lines()` enumerates every path through
   transpositions and can grow exponentially.
3. Statement counts: fixed whatever the number of players, plus 3 per
   repertoire shown (`graphRows`).
4. Lines with no own move are left out of a chapter's lines.
5. "Last trained" reaches the page as whole days ago in Vilnius, computed
   by the loader, so server and browser render the same text.

---

## Verified API (read while planning, 2026-10-26)

A worker who finds a difference stops and tells the lead.

- `packages/chess/src/training/schedule.ts`:
  - `ReviewState = { key, fsrs: Card, lapses: Date[] }`.
  - `isDue(review, now)`.
  - `retrievability(review, now)`.
- `packages/chess/src/training/stored-review.ts`: `unreviewed(review)`
  means `fsrs.reps <= 1`.
- `packages/chess/src/training/progress.ts`:
  - `mastered(scope, reviews: ReadonlyMap<string, ReviewState>, now)`.
  - `allLearned(graph, learned: ReadonlySet<string>)`.
- `packages/chess/src/training/scope.ts`: `scopeKeys({ kind: 'moves',
  keys })` gives each key once.
- `packages/chess/src/repertoire/walk.ts`: `chapterWalks(graph)(chapterId)`
  has `.paths()` and `.moves()`.
- `packages/chess/src/repertoire/graph.ts`:
  - `isPlayerMove(graph, move)`, `moveKey(from, san)`, `playerKeys(graph)`.
  - `Chapter = { id, rootKey, intro, nameSource }`.
- `packages/chess/src/position-key.ts`: `sideToMove(key)` returns `'w' | 'b'`.
- `packages/domain/src/coach-access.ts`:
  - `ACCESS_REFUSALS = { notLinked, notShared }`.
  - `canCoachSee(coachId, playerId, subject, facts)`.
  - `CoachAccessFacts = { linked, sharedRepertoireIds }`.
- `packages/domain/src/assignment.ts`:
  - `AssignmentFacts = { playerId, repertoireId, coachId, reaches,
    pausedAt, seenVersion, forkedAt }`.
  - `canUseAssignment(facts)` is ok when reached and not forked.
  - `assignmentStatusOf(facts, { done, now })` returns `{ deadline,
    overdue, paused, done, forked }`.
  - `assignmentBadges({ audience: 'coach', overdue, paused, forked })`.
- `packages/domain/src/calendar.ts`: `vilniusDay(date)` returns
  `'YYYY-MM-DD'`.
- `packages/db/src/assignments/reach.ts`: `assignmentFacts(db, { playerIds,
  coachId })` returns every reached pair, forked or not.
- `packages/db/src/assignments/pairs.ts`:
  - `inPairs(playerCol, repertoireCol, pairs)`.
  - `inIds(col, ids)`.
- `packages/db/src/share-scope.ts`: `sharedTo(coachId, playerId)`;
  `sharedIds(db, coachId, playerId)`.
- `packages/db/src/coach-queries.ts`: `linkExists(coachCol, playerCol)`.
- `packages/db/src/repertoires/repository.ts`: `loadRepertoireRows(tx,
  where)` returns `{ repertoire: { id, name, side, ... }, graph }` or
  undefined.
- `packages/db/src/repertoires/scope.ts`: `repertoireScope(db, scope,
  'view', id)`.
- `packages/domain` exports `ownScope(ownerId)` and `sharedScope(coachId,
  playerId)`.
- `packages/db/src/training/reviews.ts`: `reviewRowSchema`, `reviewColumns`
  and `toReviewState` exist but are not exported. The new read goes in this
  file.
- `packages/db/src/training-schema.ts`: `reviewResults` has `playerId`,
  `repertoireId`, `answeredAt`, and an index on `(player_id, answered_at)`.
- `packages/db/src/coaching.ts`: `coachPlayer(db, coachId, playerId)`
  returns a `LinkedAccount` or undefined.
- `packages/db/src/groups.ts`: `coachGroup(db, coachId, groupId)` returns
  `{ id, name, createdAt, members: { id, displayName, joinedAt }[] }` or
  undefined.
- `apps/web/src/server/chapter-names.ts`: `chapterTitleIn(locale)(chapter)`.
- `apps/web/src/app/repertoire-view/index.ts` exports `moveNumber(ply,
  whiteFirst)`.
- `apps/web/src/app/assignment-badges.tsx`: `<AssignmentBadges flags={...} />`.
- Design tokens (`docs/design/README.md`): `bg-learned` (violet), `bg-due`
  (amber), and to-learn on `bg-border`. Each token has a `-subtle` pair.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/chess/src/training/coach-progress.ts` (new) | Move states, counts, standings, the chapter and line drill-down |
| `packages/chess/src/training/training.ts`, `packages/chess/src/index.ts` | Exports |
| `packages/domain/src/coach-access.ts` | `ACCESS_REFUSALS.forked` |
| `packages/domain/src/coach-progress.ts` (new) | `CoachProgressFacts`, `canCoachSeeProgress`, `progressRepertoireIds` |
| `packages/db/src/training/reviews.ts` | `trackedReviews` (Reviews of many players for some keys) |
| `packages/db/src/share-scope.ts` | `sharedPairs` (shares of many players to one coach) |
| `packages/db/src/progress/facts.ts` (new) | `coachProgressFacts` for many players; `lastTrained` |
| `packages/db/src/progress/standing.ts` (new) | Loading visible repertoires and building rows and cells from facts |
| `packages/db/src/progress/coach-progress.ts` (new) | `coachPlayerProgress`, `coachRepertoireProgress`, `coachGroupProgress`, `coachLastTrained` |
| `apps/web/src/lib/days-ago.ts` (new) | Whole Vilnius days between two instants |
| `apps/web/src/lib/routes.ts` | `coachProgressPath` |
| `apps/web/src/server/coach-progress.ts` (new) | Loaders for the progress page, the player page section, the group grid and last trained |
| `apps/web/src/app/treneris/state-bar.tsx` (new) | The four-state bar with its counts in words |
| `apps/web/src/app/treneris/last-trained.tsx` (new) | "Last trained ..." line |
| `apps/web/src/app/treneris/zaidejai/[playerId]/progress-section.tsx` (new) | The player page's progress rows |
| `apps/web/src/app/treneris/zaidejai/[playerId]/pazanga/[repertoireId]/{page,progress-view}.tsx` (new) | The progress page |
| `apps/web/src/app/treneris/grupes/[groupId]/progress-grid.tsx` (new) | The group grid |
| `apps/web/e2e/coach-progress.spec.ts`, `apps/web/e2e/support/progress-db.ts` (new) | C-M1-5 against a seeded history |

---

## Part A: Chess

### Task A1: Move states and standings - chess-dev

**Files:**
- Create: `packages/chess/src/training/coach-progress.ts`
- Create: `packages/chess/src/training/coach-progress.test.ts`
- Modify: `packages/chess/src/training/training.ts` (exports)
- Modify: `packages/chess/src/index.ts` (exports)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/chess/src/training/coach-progress.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import { playerKeys, type RepertoireGraph } from '../repertoire/graph';
import {
  moveState,
  percentLearned,
  progressOf,
  repertoireStanding,
  type TrackedReview,
} from './coach-progress';
import { DAY_MS, grade, startReview } from './schedule';

const NOW = new Date('2026-10-26T09:00:00Z');
const DAY_AGO = new Date(NOW.getTime() - DAY_MS);
const WEEK_AGO = new Date(NOW.getTime() - 7 * DAY_MS);

function graphOf(pgn: string): RepertoireGraph {
  const imported = importPgn(pgn, 'white');
  if (!imported.ok) throw new Error(imported.refusal.reason);
  return imported.value.graph;
}

// One chapter, two lines for White: 1.e4 e5 2.Nf3 (Nc6 3.Bb5 | Nf6 3.Nxe5).
const GRAPH = graphOf('1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. Nxe5) 3. Bb5 *');
const KEYS = playerKeys(GRAPH);

/** Learned a week ago and due tomorrow: in review and not due. */
const learned = (key: string): TrackedReview => {
  const review = startReview(key, WEEK_AGO);
  return {
    review: {
      ...review,
      fsrs: { ...review.fsrs, due: new Date(NOW.getTime() + DAY_MS) },
    },
    skipped: false,
  };
};
const dueNow = (key: string): TrackedReview => ({
  review: startReview(key, new Date(NOW.getTime() - 2 * DAY_MS)),
  skipped: false,
});
const skippedNotDue = (key: string): TrackedReview => ({
  review: startReview(key, NOW),
  skipped: true,
});

describe('moveState (R-150)', () => {
  it('is not started without a Review', () => {
    expect(moveState(undefined, NOW)).toBe('notStarted');
  });

  it('is due once the Review is due, skipped or not', () => {
    expect(moveState(dueNow('k'), NOW)).toBe('due');
    expect(moveState({ ...dueNow('k'), skipped: true }, NOW)).toBe('due');
  });

  it('is skipped for "I know this" never graded since', () => {
    expect(moveState(skippedNotDue('k'), NOW)).toBe('skipped');
  });

  it('is learned for a skipped move graded since', () => {
    const graded = grade(startReview('k', WEEK_AGO), 'pass', DAY_AGO);
    expect(moveState({ review: graded, skipped: true }, DAY_AGO)).toBe('learned');
  });

  it('is learned for a learn pass not yet due', () => {
    expect(moveState(learned('k'), NOW)).toBe('learned');
  });
});

describe('repertoireStanding', () => {
  it('counts every own move once, in one state', () => {
    const [first, second] = KEYS;
    if (first === undefined || second === undefined) throw new Error('fixture');
    const reviews = new Map([
      [first, dueNow(first)],
      [second, skippedNotDue(second)],
    ]);
    expect(repertoireStanding(GRAPH, reviews, NOW)).toEqual({
      counts: { notStarted: KEYS.length - 2, skipped: 1, due: 1, learned: 0 },
      mastered: false,
    });
  });

  it('is mastered when every own move is recalled at 90% or more (R-56)', () => {
    const reviews = new Map(KEYS.map((key) => [key, skippedNotDue(key)]));
    expect(repertoireStanding(GRAPH, reviews, NOW).mastered).toBe(true);
  });

  it('ignores Reviews of moves the graph does not hold (dormant)', () => {
    const reviews = new Map([['elsewhere', dueNow('elsewhere')]]);
    expect(repertoireStanding(GRAPH, reviews, NOW).counts).toEqual({
      notStarted: KEYS.length,
      skipped: 0,
      due: 0,
      learned: 0,
    });
  });
});

describe('progressOf (R-151)', () => {
  it('drills down to each chapter and its lines with own moves', () => {
    const progress = progressOf(GRAPH, new Map(), NOW);
    expect(progress.chapters).toHaveLength(GRAPH.chapters.length);
    const lines = progress.chapters.flatMap((chapter) => chapter.lines);
    expect(lines.map((line) => line.sans)).toEqual([
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
      ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5'],
    ]);
    expect(lines.every((line) => line.counts.notStarted > 0)).toBe(true);
  });

  it('numbers from the chapter root: White moves first from the start', () => {
    expect(progressOf(GRAPH, new Map(), NOW).chapters[0]?.whiteFirst).toBe(true);
  });

  it('puts every own move of the repertoire in exactly one state', () => {
    fc.assert(
      fc.property(fc.subarray(KEYS), fc.subarray(KEYS), (dues, skips) => {
        const reviews = new Map<string, TrackedReview>([
          ...skips.map((k): [string, TrackedReview] => [k, skippedNotDue(k)]),
          ...dues.map((k): [string, TrackedReview] => [k, dueNow(k)]),
        ]);
        const { counts } = progressOf(GRAPH, reviews, NOW);
        const total = counts.notStarted + counts.skipped + counts.due + counts.learned;
        expect(total).toBe(KEYS.length);
        expect(counts.due).toBe(dues.length);
      }),
    );
  });
});

describe('percentLearned', () => {
  it('counts every move with a Review, rounded', () => {
    expect(percentLearned({ notStarted: 2, skipped: 1, due: 1, learned: 2 })).toBe(67);
  });

  it('is null with no own moves', () => {
    expect(percentLearned({ notStarted: 0, skipped: 0, due: 0, learned: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @mychess/chess exec vitest run src/training/coach-progress.test.ts`
Expected: FAIL, because `./coach-progress` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// packages/chess/src/training/coach-progress.ts
/**
 * Where a player stands on a repertoire, as their coach sees it: each own
 * move in exactly one state (R-150), counted for the repertoire, each
 * chapter and each of its lines (R-151), with Mastered (R-56) on each.
 * Reviews of moves the graph does not hold (dormant) never count.
 */
import { sideToMove } from '../position-key';
import {
  isPlayerMove,
  moveKey,
  playerKeys,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from '../repertoire/graph';
import { chapterWalks } from '../repertoire/walk';
import { mastered } from './progress';
import { isDue, type ReviewState } from './schedule';
import { unreviewed } from './stored-review';

/** R-150: the one state the coach sees a move in. */
export type MoveState = 'notStarted' | 'skipped' | 'due' | 'learned';

/** A player's Review of a move, and whether it entered by "I know this". */
export interface TrackedReview {
  readonly review: ReviewState;
  readonly skipped: boolean;
}

export type ProgressCounts = Readonly<Record<MoveState, number>>;

/** A set of moves' counts and whether it is mastered. */
export interface Standing {
  readonly counts: ProgressCounts;
  readonly mastered: boolean;
}

/** One line of a chapter: its moves' SAN from the chapter root. */
export interface LineProgress extends Standing {
  readonly sans: readonly string[];
}

export interface ChapterProgress extends Standing {
  readonly chapter: Chapter;
  /** White moves first from the chapter root (for move numbers). */
  readonly whiteFirst: boolean;
  readonly lines: readonly LineProgress[];
}

export interface RepertoireProgress extends Standing {
  readonly chapters: readonly ChapterProgress[];
}

/**
 * R-150: due once the Review is due (a skipped move's first Review
 * included); skipped while "I know this" was never graded since; else
 * learned.
 */
export function moveState(
  tracked: TrackedReview | undefined,
  now: Date,
): MoveState {
  if (tracked === undefined) return 'notStarted';
  if (isDue(tracked.review, now)) return 'due';
  return tracked.skipped && unreviewed(tracked.review) ? 'skipped' : 'learned';
}

/** Moves with a Review, as a whole percentage; null with no own moves. */
export function percentLearned(counts: ProgressCounts): number | null {
  const started = counts.skipped + counts.due + counts.learned;
  const total = started + counts.notStarted;
  return total === 0 ? null : Math.round((started / total) * 100);
}

/** What every standing is read from. */
interface Reading {
  readonly reviews: ReadonlyMap<string, TrackedReview>;
  readonly states: ReadonlyMap<string, ReviewState>;
  readonly now: Date;
}

const readingOf = (
  reviews: ReadonlyMap<string, TrackedReview>,
  now: Date,
): Reading => ({
  reviews,
  states: new Map([...reviews].map(([key, t]) => [key, t.review])),
  now,
});

function standingOf(keys: readonly string[], reading: Reading): Standing {
  const counts: Record<MoveState, number> = {
    notStarted: 0,
    skipped: 0,
    due: 0,
    learned: 0,
  };
  for (const key of keys) counts[moveState(reading.reviews.get(key), reading.now)] += 1;
  return {
    counts,
    mastered: mastered({ kind: 'moves', keys }, reading.states, reading.now),
  };
}

/** The own-move keys of `moves`, each once, in order. */
const ownKeys = (
  graph: RepertoireGraph,
  moves: readonly RepertoireMove[],
): string[] => [
  ...new Set(
    moves
      .filter((m) => isPlayerMove(graph, m))
      .map((m) => moveKey(m.from, m.san)),
  ),
];

/** The whole repertoire's standing: what the player page and grid show. */
export function repertoireStanding(
  graph: RepertoireGraph,
  reviews: ReadonlyMap<string, TrackedReview>,
  now: Date,
): Standing {
  return standingOf([...new Set(playerKeys(graph))], readingOf(reviews, now));
}

function chapterProgress(
  graph: RepertoireGraph,
  chapter: Chapter,
  reading: Reading,
): ChapterProgress {
  const walk = chapterWalks(graph)(chapter.id);
  const lines = walk.paths().flatMap((path): LineProgress[] => {
    const keys = ownKeys(graph, path);
    return keys.length === 0
      ? []
      : [{ sans: path.map((m) => m.san), ...standingOf(keys, reading) }];
  });
  return {
    chapter,
    whiteFirst: sideToMove(chapter.rootKey) === 'w',
    ...standingOf(ownKeys(graph, walk.moves()), reading),
    lines,
  };
}

/**
 * The drill-down of R-151: the repertoire, each chapter in order, and each
 * line of the chapter's tree (`paths`, linear in the chapter's size) that
 * holds an own move.
 */
export function progressOf(
  graph: RepertoireGraph,
  reviews: ReadonlyMap<string, TrackedReview>,
  now: Date,
): RepertoireProgress {
  const reading = readingOf(reviews, now);
  return {
    ...standingOf([...new Set(playerKeys(graph))], reading),
    chapters: graph.chapters.map((c) => chapterProgress(graph, c, reading)),
  };
}
```

Exports. Add to `packages/chess/src/training/training.ts` beside the
`./progress` lines:

```ts
export {
  moveState,
  percentLearned,
  progressOf,
  repertoireStanding,
} from './coach-progress';
export type {
  ChapterProgress,
  LineProgress,
  MoveState,
  ProgressCounts,
  RepertoireProgress,
  Standing,
  TrackedReview,
} from './coach-progress';
```

In `packages/chess/src/index.ts`, add the same names to the existing
`export { ... } from './training/training'` list and its `type` list, in
alphabetical order.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `pnpm --filter @mychess/chess exec vitest run src/training/coach-progress.test.ts`
Expected: PASS. If the property test shows a skipped key counted as due,
check the fixtures: `dues` overwrite `skips` in the map on purpose.

- [ ] **Step 5: Commit** (lead, after `node quality/gate.mjs check` exits 0)

```bash
git add packages/chess/src/training/coach-progress.ts packages/chess/src/training/coach-progress.test.ts packages/chess/src/training/training.ts packages/chess/src/index.ts
git commit -m "feat(chess): coach progress move states, standings and drill-down (#257)"
```

---

## Part B: Domain

### Task B1: Who may see progress - backend-dev - SECURITY

**Files:**
- Modify: `packages/domain/src/coach-access.ts:4-7`
- Create: `packages/domain/src/coach-progress.ts`
- Create: `packages/domain/src/coach-progress.test.ts`
- Modify: `packages/domain/src/coach-access.test.ts` (the refusal-keys test,
  if it pins `ACCESS_REFUSALS`)
- Modify: `packages/domain/src/index.ts` (exports)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/domain/src/coach-progress.test.ts
import { describe, expect, it } from 'vitest';
import type { AssignmentFacts } from './assignment';
import { ACCESS_REFUSALS } from './coach-access';
import {
  canCoachSeeProgress,
  progressRepertoireIds,
  type CoachProgressFacts,
} from './coach-progress';

const T = new Date('2026-10-26T09:00:00Z');

const assignment = (
  repertoireId: string,
  extra: Partial<AssignmentFacts> = {},
): AssignmentFacts => ({
  playerId: 'p',
  repertoireId,
  coachId: 'c',
  reaches: [
    { assignmentId: 'a', deadline: null, assignedVersion: 1, joinedAt: null },
  ],
  pausedAt: null,
  seenVersion: null,
  forkedAt: null,
  ...extra,
});

const facts = (extra: Partial<CoachProgressFacts> = {}): CoachProgressFacts => ({
  linked: true,
  sharedRepertoireIds: new Set(['shared']),
  assignments: [
    assignment('live'),
    assignment('paused', { pausedAt: T }),
    assignment('forked', { forkedAt: T }),
  ],
  ...extra,
});

describe('canCoachSeeProgress (R-39, R-42, R-154)', () => {
  it('allows a repertoire the player shares with the coach', () => {
    expect(canCoachSeeProgress('c', 'p', 'shared', facts()).ok).toBe(true);
  });

  it('allows a live assignment, paused or not', () => {
    expect(canCoachSeeProgress('c', 'p', 'live', facts()).ok).toBe(true);
    expect(canCoachSeeProgress('c', 'p', 'paused', facts()).ok).toBe(true);
  });

  it('refuses a forked assignment as forked', () => {
    expect(canCoachSeeProgress('c', 'p', 'forked', facts())).toEqual({
      ok: false,
      refusal: { reason: ACCESS_REFUSALS.forked },
    });
  });

  it('refuses anything else as not shared', () => {
    expect(canCoachSeeProgress('c', 'p', 'private', facts())).toEqual({
      ok: false,
      refusal: { reason: ACCESS_REFUSALS.notShared },
    });
  });

  it('refuses another coach’s assignment of the same player', () => {
    const other = facts({ assignments: [assignment('live', { coachId: 'c2' })] });
    expect(canCoachSeeProgress('c', 'p', 'live', other).ok).toBe(false);
  });

  it('refuses everything without a link, and to oneself', () => {
    expect(
      canCoachSeeProgress('c', 'p', 'shared', facts({ linked: false })),
    ).toEqual({ ok: false, refusal: { reason: ACCESS_REFUSALS.notLinked } });
    expect(canCoachSeeProgress('p', 'p', 'shared', facts()).ok).toBe(false);
  });
});

describe('progressRepertoireIds (R-153)', () => {
  it('is the shared and live assigned repertoires, never a forked one', () => {
    expect([...progressRepertoireIds('c', 'p', facts())].sort()).toEqual([
      'live',
      'paused',
      'shared',
    ]);
  });

  it('is empty without a link', () => {
    expect(progressRepertoireIds('c', 'p', facts({ linked: false })).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @mychess/domain exec vitest run src/coach-progress.test.ts`
Expected: FAIL, because `./coach-progress` cannot be resolved.

- [ ] **Step 3: Implement**

In `packages/domain/src/coach-access.ts`, extend the refusals:

```ts
/** Message-catalogue keys; the web answers each with 404 (plan decision 4). */
export const ACCESS_REFUSALS = {
  notLinked: 'access.notLinked',
  notShared: 'access.notShared',
  /** The player forked the assignment: it is their own now (R-154). */
  forked: 'access.forked',
} as const;
```

If `coach-access.test.ts` pins `ACCESS_REFUSALS` with `toStrictEqual`, add
`forked: 'access.forked'` there.

```ts
// packages/domain/src/coach-progress.ts
/**
 * Which of a player's repertoires their coach may see progress on (R-39,
 * R-42, R-154). Built on canCoachSee: nothing without an active link. A
 * repertoire the player shares with the coach, or one this coach assigned
 * them that they have not forked. A forked one is the player's own now.
 */
import { ok, refuse, type Result } from '@mychess/chess';
import { canUseAssignment, type AssignmentFacts } from './assignment';
import {
  ACCESS_REFUSALS,
  canCoachSee,
  type AccessRefusal,
  type CoachAccessFacts,
} from './coach-access';

/** canCoachSee's facts and this coach's assignments reaching the player. */
export interface CoachProgressFacts extends CoachAccessFacts {
  /** assignmentFacts of this coach and player, forked or not. */
  readonly assignments: readonly AssignmentFacts[];
}

const assignmentOf = (
  coachId: string,
  playerId: string,
  repertoireId: string,
  facts: CoachProgressFacts,
): AssignmentFacts | undefined =>
  facts.assignments.find(
    (a) =>
      a.coachId === coachId &&
      a.playerId === playerId &&
      a.repertoireId === repertoireId,
  );

/** May `coachId` see `playerId`'s progress on `repertoireId`? */
export function canCoachSeeProgress(
  coachId: string,
  playerId: string,
  repertoireId: string,
  facts: CoachProgressFacts,
): Result<undefined, AccessRefusal> {
  const linked = canCoachSee(coachId, playerId, { kind: 'profile' }, facts);
  if (!linked.ok) return linked;
  if (facts.sharedRepertoireIds.has(repertoireId)) return ok();
  const assigned = assignmentOf(coachId, playerId, repertoireId, facts);
  if (assigned === undefined) return refuse(ACCESS_REFUSALS.notShared);
  return assigned.forkedAt === null ? ok() : refuse(ACCESS_REFUSALS.forked);
}

/**
 * The repertoires whose training results count for "last trained"
 * (R-153): those the coach may see progress on, so training on a private
 * repertoire never shows, not even as a time.
 */
export function progressRepertoireIds(
  coachId: string,
  playerId: string,
  facts: CoachProgressFacts,
): ReadonlySet<string> {
  if (!canCoachSee(coachId, playerId, { kind: 'profile' }, facts).ok)
    return new Set();
  const live = facts.assignments
    .filter((a) => a.coachId === coachId && a.playerId === playerId)
    .filter((a) => canUseAssignment(a).ok)
    .map((a) => a.repertoireId);
  return new Set([...facts.sharedRepertoireIds, ...live]);
}
```

Export from `packages/domain/src/index.ts`, beside `canCoachSee`:

```ts
export {
  canCoachSeeProgress,
  progressRepertoireIds,
  type CoachProgressFacts,
} from './coach-progress';
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `pnpm --filter @mychess/domain exec vitest run src/coach-progress.test.ts src/coach-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (lead, after the gate and security-reviewer)

```bash
git add packages/domain/src/coach-access.ts packages/domain/src/coach-access.test.ts packages/domain/src/coach-progress.ts packages/domain/src/coach-progress.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): canCoachSeeProgress and the last-trained repertoires (#257)"
```

---

## Part C: Database

Each db test file starts like `packages/db/test/training-reads.test.ts`:
`const { db } = useTestDatabase();`, with `seedCoach`, `seedPlayer`,
`seedLink`, `seedGroup` and `seedMember` from `./support/coaching`,
`seedAssignment` and `seedRepertoire` from `./support/assignments`,
`writeReview` from `./support/training`, and `countStatements` from
`./support/statements`.

### Task C1: Batch reads (Reviews, shares, facts, last trained) - backend-dev - SECURITY

**Files:**
- Modify: `packages/db/src/training/reviews.ts` (add `trackedReviews`)
- Modify: `packages/db/src/share-scope.ts` (add `sharedPairs`; `sharedTo`
  built on the same predicate)
- Create: `packages/db/src/progress/facts.ts`
- Create: `packages/db/test/progress-facts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/progress-facts.test.ts
import { startReview } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import { forkAssignment, shareRepertoire } from '../src';
import { coachProgressFacts, lastTrained } from '../src/progress/facts';
import { sharedPairs } from '../src/share-scope';
import { trackedReviews } from '../src/training/reviews';
import { reviewResults } from '../src/training-schema';
import { useTestDatabase } from '../src/testing';
import { seedAssignment, seedRepertoire } from './support/assignments';
import { seedCoach, seedLink, seedPlayer } from './support/coaching';
import { countStatements } from './support/statements';
import { writeReview } from './support/training';

const { db } = useTestDatabase();
const NOW = new Date('2026-10-26T09:00:00Z');
const HOUR = 3_600_000;

async function result(
  playerId: string,
  repertoireId: string,
  answeredAt: Date,
): Promise<void> {
  await db.insert(reviewResults).values({
    resultId: crypto.randomUUID(),
    playerId,
    moveKey: 'k',
    repertoireId,
    kind: 'pass',
    answeredAt,
    applied: true,
    receivedAt: answeredAt,
  });
}

describe('trackedReviews', () => {
  beforeEach(async () => {
    await seedPlayer(db, 'p1', 'p1@example.lt');
    await seedPlayer(db, 'p2', 'p2@example.lt');
  });

  it('reads the asked keys of every asked player, marking skipped ones', async () => {
    await writeReview(db, 'p1', startReview('a', NOW), { learnedAt: NOW });
    await writeReview(db, 'p2', startReview('a', NOW), { skippedAt: NOW });
    await writeReview(db, 'p2', startReview('b', NOW), { learnedAt: NOW });
    const read = await trackedReviews(db, ['p1', 'p2'], ['a']);
    expect(read.get('p1')?.get('a')?.skipped).toBe(false);
    expect(read.get('p2')?.get('a')?.skipped).toBe(true);
    expect(read.get('p2')?.has('b')).toBe(false);
  });

  it('is one statement whatever the number of players', async () => {
    expect(
      await countStatements(() => trackedReviews(db, ['p1', 'p2'], ['a'])),
    ).toBe(1);
  });

  it('sends nothing for no players or no keys', async () => {
    expect(await countStatements(() => trackedReviews(db, [], ['a']))).toBe(0);
    expect(await countStatements(() => trackedReviews(db, ['p1'], []))).toBe(0);
  });
});

describe('coachProgressFacts and lastTrained', () => {
  let assigned: string;
  let forked: string;
  let shared: string;
  let privateRep: string;

  beforeEach(async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'c2', 'c2@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedPlayer(db, 'q', 'q@example.lt');
    await seedLink(db, 'c', 'p');
    await seedLink(db, 'c2', 'p');
    assigned = await seedRepertoire(db, 'c', NOW);
    forked = await seedRepertoire(db, 'c', NOW);
    shared = await seedRepertoire(db, 'p', NOW);
    privateRep = await seedRepertoire(db, 'p', NOW);
    for (const id of [assigned, forked])
      await seedAssignment(db, {
        coachId: 'c',
        repertoireId: id,
        target: { playerId: 'p' },
        now: NOW,
      });
    expect((await forkAssignment(db, { playerId: 'p', repertoireId: forked }, NOW)).ok).toBe(true);
    expect(
      (await shareRepertoire(db, { ownerId: 'p', repertoireId: shared, coachId: 'c', now: NOW })).ok,
    ).toBe(true);
  });

  it('reads the link, the shares and this coach’s assignments per player', async () => {
    const facts = await coachProgressFacts(db, 'c', ['p', 'q']);
    const p = facts.get('p');
    expect(p?.linked).toBe(true);
    expect([...(p?.sharedRepertoireIds ?? [])]).toEqual([shared]);
    expect(p?.assignments.map((a) => a.repertoireId).sort()).toEqual(
      [assigned, forked].sort(),
    );
    expect(facts.get('q')?.linked).toBe(false);
  });

  it('never reads another coach’s shares', async () => {
    expect(await sharedPairs(db, 'c2', ['p'])).toEqual([]);
  });

  it('counts only results on repertoires the coach may see (R-153)', async () => {
    await result('p', assigned, new Date(NOW.getTime() - 3 * HOUR));
    await result('p', shared, new Date(NOW.getTime() - 2 * HOUR));
    await result('p', privateRep, new Date(NOW.getTime() - HOUR));
    await result('p', forked, new Date(NOW.getTime() - HOUR));
    const facts = await coachProgressFacts(db, 'c', ['p']);
    expect((await lastTrained(db, 'c', facts)).get('p')).toEqual(
      new Date(NOW.getTime() - 2 * HOUR),
    );
  });

  it('has no entry for a player with no visible results', async () => {
    await result('p', privateRep, NOW);
    const facts = await coachProgressFacts(db, 'c', ['p']);
    expect((await lastTrained(db, 'c', facts)).has('p')).toBe(false);
  });

  it('reads facts in a fixed number of statements', async () => {
    const one = await countStatements(() => coachProgressFacts(db, 'c', ['p']));
    const two = await countStatements(() => coachProgressFacts(db, 'c', ['p', 'q']));
    expect(two).toBe(one);
  });
});
```

`forked` must be assigned to `p` before the fork, so the fork has a live
assignment to replace. If `forkAssignment` needs a held repertoire version or
an offer, follow `packages/db/test/forks.test.ts` for the setup.

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @mychess/db exec vitest run test/progress-facts.test.ts`
Expected: FAIL, because `../src/progress/facts` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/db/src/training/reviews.ts`. Add the import of `TrackedReview`
from `@mychess/chess`, then:

```ts
const trackedRowsSchema = z.array(
  reviewRowSchema.extend({ playerId: z.string().min(1) }),
);

/**
 * The Reviews of `keys` for each of `playerIds`, by player then key, each
 * with whether it entered by "I know this" (R-150). One statement whatever
 * the number of players; none for no players or no keys. A player with no
 * such Review has an empty map.
 */
export async function trackedReviews(
  db: Executor,
  playerIds: readonly string[],
  keys: readonly string[],
): Promise<Map<string, Map<string, TrackedReview>>> {
  const out = new Map(
    playerIds.map((id) => [id, new Map<string, TrackedReview>()]),
  );
  if (playerIds.length === 0 || keys.length === 0) return out;
  const rows = trackedRowsSchema.parse(
    await db
      .select({ playerId: reviews.playerId, ...reviewColumns })
      .from(reviews)
      .where(
        and(
          inArray(reviews.playerId, [...playerIds]),
          inArray(reviews.moveKey, [...keys]),
        ),
      ),
  );
  for (const row of rows)
    out.get(row.playerId)?.set(row.moveKey, {
      review: toReviewState(row),
      skipped: row.skippedAt !== null,
    });
  return out;
}
```

`packages/db/src/share-scope.ts`. The one share predicate now takes a
player filter, so `sharedTo` and the batch read spell it once:

```ts
import type { PlayerRepertoire } from '@mychess/domain';
import { and, eq, inArray, type SQL } from 'drizzle-orm';

/** The shares to `coachId` of the players `player` keeps, through an active link. */
const sharesOf = (coachId: string, player: SQL): SQL | undefined =>
  and(
    eq(repertoireShares.coachId, coachId),
    player,
    linkExists(repertoireShares.coachId, repertoireShares.playerId),
  );

export const sharedTo = (coachId: string, playerId: string): SQL | undefined =>
  sharesOf(coachId, eq(repertoireShares.playerId, playerId));

const pairRowsSchema = z.array(
  z.object({ playerId: z.string().min(1), repertoireId: z.uuid() }),
);

/**
 * Every repertoire of `playerIds` shared with `coachId`, as sharedTo has
 * them: one statement, none for no players.
 */
export async function sharedPairs(
  db: Executor,
  coachId: string,
  playerIds: readonly string[],
): Promise<PlayerRepertoire[]> {
  if (playerIds.length === 0) return [];
  return pairRowsSchema.parse(
    await db
      .select({
        playerId: repertoireShares.playerId,
        repertoireId: repertoireShares.repertoireId,
      })
      .from(repertoireShares)
      .where(
        sharesOf(coachId, inArray(repertoireShares.playerId, [...playerIds])),
      ),
  );
}
```

Keep `sharedTo`'s doc comment as it is.

```ts
// packages/db/src/progress/facts.ts
/**
 * The facts coach progress is decided on, for many players at once
 * (R-39, R-42, R-153): link, shares and this coach's assignments, in a
 * fixed number of statements. The domain decides (canCoachSeeProgress,
 * progressRepertoireIds); `lastTrained` filters on its answer. Internal to
 * the package.
 */
import {
  progressRepertoireIds,
  type CoachProgressFacts,
  type PlayerRepertoire,
} from '@mychess/domain';
import { and, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import { assignmentFacts } from '../assignments/reach';
import { inPairs } from '../assignments/pairs';
import type { Executor } from '../client';
import { playerRowsSchema } from '../coach-queries';
import { coachLinks } from '../schema';
import { sharedPairs } from '../share-scope';
import { reviewResults } from '../training-schema';

/** canCoachSeeProgress's facts for each of `playerIds`. */
export async function coachProgressFacts(
  db: Executor,
  coachId: string,
  playerIds: readonly string[],
): Promise<Map<string, CoachProgressFacts>> {
  const linked = new Set(
    playerIds.length === 0
      ? []
      : playerRowsSchema
          .parse(
            await db
              .select({ playerId: coachLinks.playerId })
              .from(coachLinks)
              .where(
                and(
                  eq(coachLinks.coachId, coachId),
                  inArray(coachLinks.playerId, [...playerIds]),
                ),
              ),
          )
          .map((row) => row.playerId),
  );
  const shares = await sharedPairs(db, coachId, playerIds);
  const assignments = await assignmentFacts(db, { playerIds, coachId });
  return new Map(
    playerIds.map((playerId) => [
      playerId,
      {
        linked: linked.has(playerId),
        sharedRepertoireIds: new Set(
          shares.filter((s) => s.playerId === playerId).map((s) => s.repertoireId),
        ),
        assignments: assignments.filter((a) => a.playerId === playerId),
      },
    ]),
  );
}

const lastRowsSchema = z.array(
  z.object({ playerId: z.string().min(1), at: z.coerce.date() }),
);

/**
 * When each player last trained on a repertoire the coach may see
 * progress on (R-153): the latest `answered_at` (when they trained, not
 * when the batch arrived). One statement; no entry for a player without
 * such a result.
 */
export async function lastTrained(
  db: Executor,
  coachId: string,
  facts: ReadonlyMap<string, CoachProgressFacts>,
): Promise<Map<string, Date>> {
  const pairs: PlayerRepertoire[] = [...facts].flatMap(([playerId, one]) =>
    [...progressRepertoireIds(coachId, playerId, one)].map((repertoireId) => ({
      playerId,
      repertoireId,
    })),
  );
  if (pairs.length === 0) return new Map();
  const rows = lastRowsSchema.parse(
    await db
      .select({
        playerId: reviewResults.playerId,
        at: max(reviewResults.answeredAt),
      })
      .from(reviewResults)
      .where(inPairs(reviewResults.playerId, reviewResults.repertoireId, pairs))
      .groupBy(reviewResults.playerId),
  );
  return new Map(rows.map((row) => [row.playerId, row.at]));
}
```

`max()` may return the timestamp as text or as a Date, depending on the
column mapping. `z.coerce.date()` accepts both. If `PlayerRepertoire` is not
exported from `@mychess/domain`, import it from where
`packages/db/src/assignments/pairs.ts` gets it.

`coachProgressFacts` has a conditional and two filters inside a map.
If CRAP flags it, move the link read into a small `linkedOf(db, coachId,
playerIds)` function in the same file.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `pnpm --filter @mychess/db exec vitest run test/progress-facts.test.ts test/shares.test.ts test/training-reads.test.ts`
Expected: PASS. `shares.test.ts` covers the `sharedTo` refactor.

- [ ] **Step 5: Commit** (lead, after the gate and security-reviewer)

```bash
git add packages/db/src/training/reviews.ts packages/db/src/share-scope.ts packages/db/src/progress/facts.ts packages/db/test/progress-facts.test.ts
git commit -m "feat(db): batch reads for coach progress: tracked reviews, shares, facts, last trained (#257)"
```

### Task C2: Progress repositories - backend-dev - SECURITY

**Files:**
- Create: `packages/db/src/progress/standing.ts`
- Create: `packages/db/src/progress/coach-progress.ts`
- Create: `packages/db/test/coach-progress.test.ts`
- Modify: `packages/db/src/index.ts` (exports)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/coach-progress.test.ts
import { playerKeys, startReview } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  coachGroupProgress,
  coachLastTrained,
  coachPlayerProgress,
  coachRepertoireProgress,
  forkAssignment,
  pauseAssignment,
  shareRepertoire,
} from '../src';
import { graphRows } from '../src/repertoires/repository';
import { useTestDatabase } from '../src/testing';
import { seedAssignment, seedRepertoire } from './support/assignments';
import {
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
} from './support/coaching';
import { countStatements } from './support/statements';
import { writeReview } from './support/training';

const { db } = useTestDatabase();
const NOW = new Date('2026-10-26T09:00:00Z');
const DAY_MS = 86_400_000;
const WEEK_AGO = new Date(NOW.getTime() - 7 * DAY_MS);

let karoKan: string; // the coach's, assigned to p individually
let group: string;
let groupRep: string; // the coach's, assigned to the group
let shared: string; // p's own, shared with c
let privateRep: string; // p's own, not shared

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  await seedCoach(db, 'other', 'other@example.lt');
  await seedPlayer(db, 'p', 'p@example.lt');
  await seedPlayer(db, 'q', 'q@example.lt');
  await seedPlayer(db, 'stranger', 's@example.lt');
  await seedLink(db, 'c', 'p');
  await seedLink(db, 'c', 'q');
  karoKan = await seedRepertoire(db, 'c', NOW);
  groupRep = await seedRepertoire(db, 'c', NOW);
  shared = await seedRepertoire(db, 'p', NOW);
  privateRep = await seedRepertoire(db, 'p', NOW);
  group = await seedGroup(db, 'c', 'Šeštadienio grupė');
  await seedMember(db, 'c', group, 'p');
  await seedMember(db, 'c', group, 'q');
  await seedAssignment(db, { coachId: 'c', repertoireId: karoKan, target: { playerId: 'p' }, now: NOW });
  await seedAssignment(db, { coachId: 'c', repertoireId: groupRep, target: { groupId: group }, now: NOW });
  expect((await shareRepertoire(db, { ownerId: 'p', repertoireId: shared, coachId: 'c', now: NOW })).ok).toBe(true);
});

/** p learned every own move of `repertoireId` a week ago; all due now. */
async function learnAll(playerId: string, repertoireId: string): Promise<number> {
  const keys = playerKeys(await graphRows(db, repertoireId, 'white'));
  for (const key of keys)
    await writeReview(db, playerId, startReview(key, WEEK_AGO), { learnedAt: WEEK_AGO });
  return keys.length;
}

describe('coachPlayerProgress', () => {
  it('lists assigned then shared repertoires with their standings, never private ones', async () => {
    const own = await learnAll('p', karoKan);
    const progress = await coachPlayerProgress(db, 'c', 'p', NOW);
    const ids = progress?.rows.map((row) => row.repertoire.id);
    expect(ids).toContain(karoKan);
    expect(ids).toContain(groupRep);
    expect(ids?.at(-1)).toBe(shared);
    expect(ids).not.toContain(privateRep);
    const row = progress?.rows.find((r) => r.repertoire.id === karoKan);
    expect(row?.source).toBe('assigned');
    expect(row?.standing?.counts.due).toBe(own);
  });

  it('shows a paused assignment with its badge and its states', async () => {
    await pauseAssignment(db, { playerId: 'p', repertoireId: karoKan, paused: true }, NOW);
    const row = (await coachPlayerProgress(db, 'c', 'p', NOW))?.rows.find(
      (r) => r.repertoire.id === karoKan,
    );
    expect(row?.badges?.paused).toBe(true);
    expect(row?.standing).not.toBeNull();
  });

  it('shows a forked assignment with its badge only (R-154)', async () => {
    expect((await forkAssignment(db, { playerId: 'p', repertoireId: karoKan }, NOW)).ok).toBe(true);
    const row = (await coachPlayerProgress(db, 'c', 'p', NOW))?.rows.find(
      (r) => r.repertoire.id === karoKan,
    );
    expect(row?.badges?.forked).toBe(true);
    expect(row?.standing).toBeNull();
  });

  it('is undefined for a player not linked to the coach', async () => {
    expect(await coachPlayerProgress(db, 'c', 'stranger', NOW)).toBeUndefined();
    expect(await coachPlayerProgress(db, 'other', 'p', NOW)).toBeUndefined();
  });
});

describe('coachRepertoireProgress', () => {
  it('drills an assignment down to chapters and lines', async () => {
    await learnAll('p', karoKan);
    const view = await coachRepertoireProgress(db, 'c', 'p', karoKan, NOW);
    expect(view?.player.displayName).toBe('Name p');
    expect(view?.progress.chapters.length).toBeGreaterThan(0);
    expect(view?.progress.chapters[0]?.lines.length).toBeGreaterThan(0);
  });

  it('shows a shared repertoire without badges', async () => {
    const view = await coachRepertoireProgress(db, 'c', 'p', shared, NOW);
    expect(view?.badges).toBeNull();
  });

  it('is undefined for a private, forked, another coach’s or malformed one', async () => {
    expect(await coachRepertoireProgress(db, 'c', 'p', privateRep, NOW)).toBeUndefined();
    expect(await coachRepertoireProgress(db, 'other', 'p', karoKan, NOW)).toBeUndefined();
    expect(await coachRepertoireProgress(db, 'c', 'p', 'nope', NOW)).toBeUndefined();
    expect((await forkAssignment(db, { playerId: 'p', repertoireId: karoKan }, NOW)).ok).toBe(true);
    expect(await coachRepertoireProgress(db, 'c', 'p', karoKan, NOW)).toBeUndefined();
  });
});

describe('coachGroupProgress (R-152)', () => {
  it('has one column per group repertoire and one row per member', async () => {
    await learnAll('q', groupRep);
    const grid = await coachGroupProgress(db, 'c', group, NOW);
    expect(grid?.columns.map((c) => c.id)).toEqual([groupRep]);
    expect(grid?.rows.map((r) => r.player.id)).toEqual(['p', 'q']);
    expect(grid?.rows[1]?.cells[0]?.standing?.counts.notStarted).toBe(0);
  });

  it('is undefined for another coach’s group', async () => {
    expect(await coachGroupProgress(db, 'other', group, NOW)).toBeUndefined();
  });

  it('reads in a number of statements that does not grow with members', async () => {
    const two = await countStatements(() => coachGroupProgress(db, 'c', group, NOW));
    await seedPlayer(db, 'r', 'r@example.lt');
    await seedLink(db, 'c', 'r');
    await seedMember(db, 'c', group, 'r');
    const three = await countStatements(() => coachGroupProgress(db, 'c', group, NOW));
    expect(three).toBe(two);
  });
});

describe('coachLastTrained', () => {
  it('is keyed by player, from visible results only', async () => {
    expect((await coachLastTrained(db, 'c', ['p', 'q'])).size).toBe(0);
  });
});
```

`seedRepertoire` always names the repertoire "Londono sistema" with side
`white`. The grid's column order (by name, then id) is fine with one column.

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @mychess/db exec vitest run test/coach-progress.test.ts`
Expected: FAIL, because `coachPlayerProgress` is not exported.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/progress/standing.ts
/**
 * Loading the repertoires a coach may see progress on, and turning a
 * player's Reviews into what each row or cell shows: the S5 badges for an
 * assignment, the standing unless forked (R-154). Internal to the package.
 */
import {
  allLearned,
  playerKeys,
  repertoireStanding,
  type RepertoireGraph,
  type Side,
  type Standing,
  type TrackedReview,
} from '@mychess/chess';
import {
  assignmentBadges,
  assignmentStatusOf,
  type AssignmentFacts,
  type BadgeSet,
  type RepertoireScope,
} from '@mychess/domain';
import type { Executor } from '../client';
import { loadRepertoireRows } from '../repertoires/repository';
import { repertoireScope } from '../repertoires/scope';

export interface RepertoireRef {
  readonly id: string;
  readonly name: string;
  readonly side: Side;
}

export interface Visible {
  readonly repertoire: RepertoireRef;
  readonly graph: RepertoireGraph;
}

/** Repertoire `id` as `scope` reaches it for viewing, or undefined. */
export async function loadVisible(
  tx: Executor,
  scope: RepertoireScope,
  id: string,
): Promise<Visible | undefined> {
  const loaded = await loadRepertoireRows(
    tx,
    repertoireScope(tx, scope, 'view', id),
  );
  if (loaded === undefined) return undefined;
  const { name, side } = loaded.repertoire;
  return { repertoire: { id, name, side }, graph: loaded.graph };
}

/** Every own-move key of the graphs, each once. */
export const keysOf = (graphs: readonly RepertoireGraph[]): string[] => [
  ...new Set(graphs.flatMap((graph) => playerKeys(graph))),
];

/** An assignment's badges as the coach sees them (R-46, R-51, R-128, R-132). */
export function coachBadges(
  facts: AssignmentFacts,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): BadgeSet {
  const done = allLearned(graph, new Set(tracked.keys()));
  const { overdue, paused, forked } = assignmentStatusOf(facts, { done, now });
  return assignmentBadges({ audience: 'coach', overdue, paused, forked });
}

/** The standing to show: none for a forked assignment (R-154). */
export const standingUnlessForked = (
  facts: AssignmentFacts | undefined,
  graph: RepertoireGraph,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): Standing | null =>
  facts?.forkedAt != null ? null : repertoireStanding(graph, tracked, now);

/** By name in Lithuanian order, then id. */
export const byName = (a: Visible, b: Visible): number =>
  a.repertoire.name.localeCompare(b.repertoire.name, 'lt') ||
  a.repertoire.id.localeCompare(b.repertoire.id);
```

`facts?.forkedAt != null` uses loose equality on purpose, to cover both
undefined facts and a null `forkedAt`. If the lint config bans `!=`, write
`facts !== undefined && facts.forkedAt !== null ? null : ...`.

```ts
// packages/db/src/progress/coach-progress.ts
/**
 * What a coach reads of their players' progress (R-150 to R-154). Every
 * read is one repeatable-read snapshot. The facts are read first and the
 * domain decides (canCoachSee, canCoachSeeProgress). The repertoires are
 * then loaded through the same scopes again: the coach's own for an
 * assignment, the share for a shared one (Q26). Statements: fixed in the
 * number of players, plus a graph load (3) per repertoire shown.
 */
import {
  progressOf,
  type RepertoireProgress,
  type Standing,
  type TrackedReview,
} from '@mychess/chess';
import {
  canCoachSee,
  canCoachSeeProgress,
  ownScope,
  sharedScope,
  type AccountRef,
  type AssignmentFacts,
  type BadgeSet,
  type CoachProgressFacts,
} from '@mychess/domain';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { assignments } from '../assignment-schema';
import type { Executor } from '../client';
import { coachPlayer } from '../coaching';
import { coachGroup } from '../groups';
import { isUuid } from '../ids';
import { trackedReviews } from '../training/reviews';
import { coachProgressFacts, lastTrained } from './facts';
import {
  byName,
  coachBadges,
  keysOf,
  loadVisible,
  standingUnlessForked,
  type RepertoireRef,
  type Visible,
} from './standing';

const SNAPSHOT = { isolationLevel: 'repeatable read' } as const;
const NO_REVIEWS: ReadonlyMap<string, TrackedReview> = new Map();

/** One repertoire on the player page. */
export interface ProgressRow {
  readonly repertoire: RepertoireRef;
  readonly source: 'assigned' | 'shared';
  /** The S5 badges of an assignment; null for a shared repertoire. */
  readonly badges: BadgeSet | null;
  /** Null for a forked assignment (R-154). */
  readonly standing: Standing | null;
}

export interface PlayerProgress {
  readonly rows: readonly ProgressRow[];
  readonly lastTrained: Date | null;
}

/** An assignment of this coach's and its repertoire. */
interface AssignedVisible extends Visible {
  readonly facts: AssignmentFacts;
}

async function assignedOf(
  tx: Executor,
  coachId: string,
  facts: CoachProgressFacts,
): Promise<AssignedVisible[]> {
  const out: AssignedVisible[] = [];
  for (const one of facts.assignments) {
    const visible = await loadVisible(tx, ownScope(coachId), one.repertoireId);
    if (visible !== undefined) out.push({ ...visible, facts: one });
  }
  return out.sort(byName);
}

async function sharedOf(
  tx: Executor,
  coachId: string,
  playerId: string,
  facts: CoachProgressFacts,
): Promise<Visible[]> {
  const out: Visible[] = [];
  for (const id of facts.sharedRepertoireIds) {
    const visible = await loadVisible(tx, sharedScope(coachId, playerId), id);
    if (visible !== undefined) out.push(visible);
  }
  return out.sort(byName);
}

/** The facts of one player, linked to the coach; undefined otherwise. */
async function linkedFacts(
  tx: Executor,
  coachId: string,
  playerId: string,
): Promise<CoachProgressFacts | undefined> {
  const facts = (await coachProgressFacts(tx, coachId, [playerId])).get(playerId);
  return facts !== undefined &&
    canCoachSee(coachId, playerId, { kind: 'profile' }, facts).ok
    ? facts
    : undefined;
}

/**
 * The player page's progress: every repertoire this coach assigned the
 * player (by name), then every one the player shares with them (by name),
 * and when they last trained. Undefined unless linked.
 */
export function coachPlayerProgress(
  db: Executor,
  coachId: string,
  playerId: string,
  now: Date,
): Promise<PlayerProgress | undefined> {
  return db.transaction(async (tx) => {
    const facts = await linkedFacts(tx, coachId, playerId);
    if (facts === undefined) return undefined;
    const assigned = await assignedOf(tx, coachId, facts);
    const shared = await sharedOf(tx, coachId, playerId, facts);
    const tracked =
      (await trackedReviews(tx, [playerId], keysOf([...assigned, ...shared].map((v) => v.graph)))).get(playerId) ??
      NO_REVIEWS;
    const rows: ProgressRow[] = [
      ...assigned.map((a) => ({
        repertoire: a.repertoire,
        source: 'assigned' as const,
        badges: coachBadges(a.facts, a.graph, tracked, now),
        standing: standingUnlessForked(a.facts, a.graph, tracked, now),
      })),
      ...shared.map((s) => ({
        repertoire: s.repertoire,
        source: 'shared' as const,
        badges: null,
        standing: standingUnlessForked(undefined, s.graph, tracked, now),
      })),
    ];
    const last = await lastTrained(tx, coachId, new Map([[playerId, facts]]));
    return { rows, lastTrained: last.get(playerId) ?? null };
  }, SNAPSHOT);
}

/** One player's progress on one repertoire, chapters and lines included. */
export interface RepertoireProgressView {
  readonly player: AccountRef;
  readonly repertoire: RepertoireRef;
  readonly badges: BadgeSet | null;
  readonly progress: RepertoireProgress;
}

/**
 * The progress page (R-151): undefined unless canCoachSeeProgress allows
 * it. The repertoire then loads through the scope that allowed it.
 */
export function coachRepertoireProgress(
  db: Executor,
  coachId: string,
  playerId: string,
  repertoireId: string,
  now: Date,
): Promise<RepertoireProgressView | undefined> {
  if (!isUuid(repertoireId)) return Promise.resolve(undefined);
  return db.transaction(async (tx) => {
    const facts = (await coachProgressFacts(tx, coachId, [playerId])).get(playerId);
    if (
      facts === undefined ||
      !canCoachSeeProgress(coachId, playerId, repertoireId, facts).ok
    )
      return undefined;
    const isShared = facts.sharedRepertoireIds.has(repertoireId);
    const scope = isShared ? sharedScope(coachId, playerId) : ownScope(coachId);
    const visible = await loadVisible(tx, scope, repertoireId);
    const player = await coachPlayer(tx, coachId, playerId);
    if (visible === undefined || player === undefined) return undefined;
    const tracked =
      (await trackedReviews(tx, [playerId], keysOf([visible.graph]))).get(playerId) ?? NO_REVIEWS;
    const assignment = facts.assignments.find((a) => a.repertoireId === repertoireId);
    return {
      player: { id: player.id, displayName: player.displayName },
      repertoire: visible.repertoire,
      badges:
        isShared || assignment === undefined
          ? null
          : coachBadges(assignment, visible.graph, tracked, now),
      progress: progressOf(visible.graph, tracked, now),
    };
  }, SNAPSHOT);
}

/** One cell of the group grid; null where the member has no assignment. */
export interface GroupProgressCell {
  readonly badges: BadgeSet;
  /** Null for a forked assignment (R-154). */
  readonly standing: Standing | null;
}

export interface GroupProgressRow {
  readonly player: AccountRef;
  readonly lastTrained: Date | null;
  /** One per column, in column order. */
  readonly cells: readonly (GroupProgressCell | null)[];
}

export interface GroupProgress {
  readonly columns: readonly RepertoireRef[];
  readonly rows: readonly GroupProgressRow[];
}

const idRowsSchema = z.array(z.object({ id: z.uuid() }));

/** The repertoires this coach assigned to the group, each once. */
async function groupRepertoireIds(
  tx: Executor,
  coachId: string,
  groupId: string,
): Promise<string[]> {
  const rows = idRowsSchema.parse(
    await tx
      .selectDistinct({ id: assignments.repertoireId })
      .from(assignments)
      .where(
        and(
          eq(assignments.coachId, coachId),
          isNotNull(assignments.groupId),
          eq(assignments.groupId, groupId),
        ),
      ),
  );
  return rows.map((row) => row.id);
}

function cellOf(
  column: Visible,
  facts: CoachProgressFacts | undefined,
  tracked: ReadonlyMap<string, TrackedReview>,
  now: Date,
): GroupProgressCell | null {
  const assignment = facts?.assignments.find(
    (a) => a.repertoireId === column.repertoire.id,
  );
  if (assignment === undefined) return null;
  return {
    badges: coachBadges(assignment, column.graph, tracked, now),
    standing: standingUnlessForked(assignment, column.graph, tracked, now),
  };
}

/**
 * The group grid (R-152): the coach's own group, one column per
 * repertoire assigned to it (by name), one row per member (by name).
 * Undefined for any other group.
 */
export function coachGroupProgress(
  db: Executor,
  coachId: string,
  groupId: string,
  now: Date,
): Promise<GroupProgress | undefined> {
  return db.transaction(async (tx) => {
    const group = await coachGroup(tx, coachId, groupId);
    if (group === undefined) return undefined;
    const columns: Visible[] = [];
    for (const id of await groupRepertoireIds(tx, coachId, groupId)) {
      const visible = await loadVisible(tx, ownScope(coachId), id);
      if (visible !== undefined) columns.push(visible);
    }
    columns.sort(byName);
    const memberIds = group.members.map((m) => m.id);
    const facts = await coachProgressFacts(tx, coachId, memberIds);
    const tracked = await trackedReviews(tx, memberIds, keysOf(columns.map((c) => c.graph)));
    const last = await lastTrained(tx, coachId, facts);
    return {
      columns: columns.map((c) => c.repertoire),
      rows: group.members.map((member) => ({
        player: { id: member.id, displayName: member.displayName },
        lastTrained: last.get(member.id) ?? null,
        cells: columns.map((column) =>
          cellOf(column, facts.get(member.id), tracked.get(member.id) ?? NO_REVIEWS, now),
        ),
      })),
    };
  }, SNAPSHOT);
}

/** When each of `playerIds` last trained, as the coach may see it (R-153). */
export function coachLastTrained(
  db: Executor,
  coachId: string,
  playerIds: readonly string[],
): Promise<Map<string, Date>> {
  return db.transaction(
    async (tx) => lastTrained(tx, coachId, await coachProgressFacts(tx, coachId, playerIds)),
    SNAPSHOT,
  );
}
```

`coachPlayerProgress` and `coachGroupProgress` are the longest functions.
If CRAP or complexity flags one, move the row mapping into `rowsOf(assigned,
shared, tracked, now)` and the column load into `columnsOf(tx, coachId,
ids)`. Keep `isNotNull(assignments.groupId)` only if drizzle's typing needs
it; `eq(assignments.groupId, groupId)` alone is enough in SQL.

Exports in `packages/db/src/index.ts`:

```ts
export {
  coachGroupProgress,
  coachLastTrained,
  coachPlayerProgress,
  coachRepertoireProgress,
  type GroupProgress,
  type GroupProgressCell,
  type GroupProgressRow,
  type PlayerProgress,
  type ProgressRow,
  type RepertoireProgressView,
} from './progress/coach-progress';
export type { RepertoireRef } from './progress/standing';
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `pnpm --filter @mychess/db exec vitest run test/coach-progress.test.ts test/progress-facts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (lead, after the gate and security-reviewer)

```bash
git add packages/db/src/progress packages/db/src/index.ts packages/db/test/coach-progress.test.ts
git commit -m "feat(db): coach progress reads for the player page, progress page and group grid (#257)"
```

---

## Part D: Web

### Task D1: Shared pieces: route, days ago, messages, state bar, last trained - web-dev - UX

**Files:**
- Modify: `apps/web/src/lib/routes.ts`
- Create: `apps/web/src/lib/days-ago.ts`, `apps/web/src/lib/days-ago.test.ts`
- Modify: `apps/web/src/i18n/messages/lt.json`, `apps/web/src/i18n/messages/en.json`
- Create: `apps/web/src/app/treneris/state-bar.tsx`, `apps/web/src/app/treneris/state-bar.test.tsx`
- Create: `apps/web/src/app/treneris/last-trained.tsx`, `apps/web/src/app/treneris/last-trained.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/days-ago.test.ts
import { describe, expect, it } from 'vitest';
import { daysAgo } from './days-ago';

describe('daysAgo (Vilnius days)', () => {
  const now = new Date('2026-10-26T09:00:00Z'); // 12:00 in Vilnius

  it('is 0 for earlier the same Vilnius day', () => {
    expect(daysAgo(new Date('2026-10-25T22:30:00Z'), now)).toBe(0);
  });

  it('is 1 for the Vilnius day before', () => {
    expect(daysAgo(new Date('2026-10-25T20:00:00Z'), now)).toBe(1);
  });

  it('counts across the DST change', () => {
    expect(daysAgo(new Date('2026-10-20T09:00:00Z'), now)).toBe(6);
  });
});
```

```tsx
// apps/web/src/app/treneris/state-bar.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { StateBar } from './state-bar';

function renderBar(counts: {
  notStarted: number;
  skipped: number;
  due: number;
  learned: number;
}): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <StateBar counts={counts} mastered={false} />
    </NextIntlClientProvider>,
  );
  return container;
}

describe('StateBar (R-150)', () => {
  it('gives each state a segment in proportion and the counts in words', () => {
    const container = renderBar({ notStarted: 2, skipped: 1, due: 1, learned: 4 });
    expect(container.querySelector('.bg-learned')?.getAttribute('style')).toContain('50%');
    expect(container.querySelector('.bg-due')?.getAttribute('style')).toContain('12.5%');
    expect(screen.getByText(/4 išmokta/)).toBeTruthy();
  });

  it('says there is nothing to learn when there are no own moves', () => {
    renderBar({ notStarted: 0, skipped: 0, due: 0, learned: 0 });
    expect(screen.getByText(MESSAGES.lt.coach.progress.nothing)).toBeTruthy();
  });
});
```

```tsx
// apps/web/src/app/treneris/last-trained.test.tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { LastTrained } from './last-trained';

const show = (days: number | null): void => {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <LastTrained days={days} />
    </NextIntlClientProvider>,
  );
};

describe('LastTrained (R-153)', () => {
  it('says today, yesterday, and days ago', () => {
    show(0);
    expect(screen.getByText(/šiandien/)).toBeTruthy();
  });

  it('says not trained yet without a result', () => {
    show(null);
    expect(screen.getByText(MESSAGES.lt.coach.progress.neverTrained)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @mychess/web exec vitest run src/lib/days-ago.test.ts src/app/treneris/state-bar.test.tsx src/app/treneris/last-trained.test.tsx`
Expected: FAIL, because the modules do not exist yet.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/days-ago.ts
import { vilniusDay } from '@mychess/domain';

const DAY_MS = 86_400_000;

/**
 * Whole Vilnius days from `at` to `now`: 0 the same day, 1 the day
 * before. Computed by a loader, so the server and the browser render the
 * same "last trained" text (spec decision 6).
 */
export function daysAgo(at: Date, now: Date): number {
  return Math.round(
    (Date.parse(vilniusDay(now)) - Date.parse(vilniusDay(at))) / DAY_MS,
  );
}
```

`apps/web/src/lib/routes.ts`, after `coachSharedRepertoirePath`. The slug
is the i18n-content proposal; i18n-content confirms it in review:

```ts
/** A player's progress on one repertoire, in the coach dashboard (R-151). */
export const coachProgressPath = (
  playerId: string,
  repertoireId: string,
): string =>
  `${coachPlayerPath(playerId)}/pazanga/${encodeURIComponent(repertoireId)}`;
```

Messages. These are proposals; i18n-content reviews and may reword them
against `docs/glossary-lt.md`. Add `coach.progress` to `lt.json`:

```json
"progress": {
  "title": "Pažanga",
  "empty": "{name} dar neturi jums matomų repertuarų.",
  "assigned": "Priskirtas",
  "shared": "Bendrinamas",
  "counts": "{learned} išmokta · {due, plural, one {# kartotinas} few {# kartotini} other {# kartotinų}} · {skipped} pažymėta „Žinau“ · {notStarted} liko išmokti",
  "percent": "{percent} % išmokta",
  "mastered": "Įvaldyta",
  "nothing": "Nėra ką mokytis",
  "forkedNote": "Žaidėjas pasidarė asmeninę kopiją; jos pažangos nematote.",
  "today": "Paskutinį kartą treniravosi šiandien",
  "yesterday": "Paskutinį kartą treniravosi vakar",
  "daysAgo": "Paskutinį kartą treniravosi prieš {days, plural, one {# dieną} few {# dienas} other {# dienų}}",
  "neverTrained": "Dar nesitreniravo",
  "chapters": "Skyriai",
  "lines": "Variantai",
  "open": "Pažanga: {name}",
  "gridTitle": "Grupės pažanga",
  "gridEmpty": "Grupei dar nieko nepriskirta.",
  "player": "Žaidėjas",
  "noAssignment": "Nepriskirta"
}
```

`en.json`:

```json
"progress": {
  "title": "Progress",
  "empty": "{name} has no repertoires you can see yet.",
  "assigned": "Assigned",
  "shared": "Shared",
  "counts": "{learned} learned · {due} due · {skipped} marked known · {notStarted} to learn",
  "percent": "{percent}% learned",
  "mastered": "Mastered",
  "nothing": "Nothing to learn",
  "forkedNote": "The player made their own copy; you do not see its progress.",
  "today": "Last trained today",
  "yesterday": "Last trained yesterday",
  "daysAgo": "Last trained {days, plural, one {# day} other {# days}} ago",
  "neverTrained": "Not trained yet",
  "chapters": "Chapters",
  "lines": "Lines",
  "open": "Progress: {name}",
  "gridTitle": "Group progress",
  "gridEmpty": "Nothing is assigned to the group yet.",
  "player": "Player",
  "noAssignment": "Not assigned"
}
```

```tsx
// apps/web/src/app/treneris/state-bar.tsx
import type { ProgressCounts } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/** One segment's width as a share of the whole. */
const segment = (part: number, whole: number): string =>
  `${String(whole === 0 ? 0 : (part / whole) * 100)}%`;

/**
 * The four states of R-150 as one bar (learned violet, "I know this" pale
 * violet, due amber, to learn the grey track), with the same counts in words
 * (never colour alone, docs/design/README.md) and the Mastered badge.
 */
export function StateBar({
  counts,
  mastered,
}: {
  readonly counts: ProgressCounts;
  readonly mastered: boolean;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const whole = counts.notStarted + counts.skipped + counts.due + counts.learned;
  if (whole === 0) return <p className="text-sm text-fg-muted">{t('nothing')}</p>;
  return (
    <div className="flex flex-col gap-1">
      <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-pill bg-border">
        <div className="bg-learned" style={{ width: segment(counts.learned, whole) }} />
        <div className="bg-learned-subtle" style={{ width: segment(counts.skipped, whole) }} />
        <div className="bg-due" style={{ width: segment(counts.due, whole) }} />
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        <span>{t('counts', { ...counts })}</span>
        {mastered ? (
          <span className="rounded-pill border border-transparent bg-success-subtle px-2 py-0.5 font-semibold text-success">
            {t('mastered')}
          </span>
        ) : null}
      </p>
    </div>
  );
}
```

```tsx
// apps/web/src/app/treneris/last-trained.tsx
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

/** "Last trained today / yesterday / N days ago", or "not trained yet" (R-153). */
export function LastTrained({
  days,
}: {
  readonly days: number | null;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const text =
    days === null
      ? t('neverTrained')
      : days === 0
        ? t('today')
        : days === 1
          ? t('yesterday')
          : t('daysAgo', { days });
  return <p className="text-sm text-fg-muted">{text}</p>;
}
```

ux-designer checks the skipped segment colour (`bg-learned-subtle`) and the
Mastered badge colour against `docs/design/README.md`. If the token is
missing, they choose one; the gate does not.

- [ ] **Step 4: Run the tests and check that they pass**

Run: the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit** (lead, after the gate, ux-designer and i18n-content)

```bash
git add apps/web/src/lib/routes.ts apps/web/src/lib/days-ago.ts apps/web/src/lib/days-ago.test.ts apps/web/src/i18n/messages apps/web/src/app/treneris/state-bar.tsx apps/web/src/app/treneris/state-bar.test.tsx apps/web/src/app/treneris/last-trained.tsx apps/web/src/app/treneris/last-trained.test.tsx
git commit -m "feat(web): coach progress state bar, last trained, route and messages (#257)"
```

### Task D2: Loaders - web-dev - SECURITY

**Files:**
- Create: `apps/web/src/server/coach-progress.ts`
- Create: `apps/web/src/server/coach-progress.test.ts`
- Modify: `apps/web/src/server/coach-pages.ts` (`coachHomeData`,
  `coachPlayerData`)

Follow `apps/web/src/server/coach-assignments.test.ts` for how a loader test
mocks `requireCoach`, `getDb` and the `@mychess/db` reads.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/server/coach-progress.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  repertoire: vi.fn(),
  group: vi.fn(),
  player: vi.fn(),
}));
const coach = { id: 'c', locale: 'lt' as const };

vi.mock('@mychess/db', () => ({
  coachRepertoireProgress: db.repertoire,
  coachGroupProgress: db.group,
  coachPlayerProgress: db.player,
}));
vi.mock('./coaching', () => ({ requireCoach: vi.fn(async () => coach) }));
vi.mock('./db', () => ({ getDb: () => ({}) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { coachProgressData, groupProgressData, playerProgressData } = await import('./coach-progress');

const UUID = '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('coachProgressData', () => {
  it('is 404 for a malformed id without reading', async () => {
    await expect(coachProgressData('p', 'nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(db.repertoire).not.toHaveBeenCalled();
  });

  it('is 404 when the read refuses (unlinked, private, forked)', async () => {
    db.repertoire.mockResolvedValue(undefined);
    await expect(coachProgressData('p', UUID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('names each chapter in the coach’s locale', async () => {
    db.repertoire.mockResolvedValue({
      player: { id: 'p', displayName: 'Rokas' },
      repertoire: { id: UUID, name: 'Karo-Kan', side: 'black' },
      badges: null,
      progress: {
        counts: { notStarted: 1, skipped: 0, due: 0, learned: 0 },
        mastered: false,
        chapters: [
          {
            chapter: { id: 'ch1', rootKey: 'k', intro: null, nameSource: { kind: 'header', name: 'Advance' } },
            whiteFirst: true,
            counts: { notStarted: 1, skipped: 0, due: 0, learned: 0 },
            mastered: false,
            lines: [],
          },
        ],
      },
    });
    const page = await coachProgressData('p', UUID);
    expect(page.chapters[0]?.title).toBe('Advance');
  });
});

describe('groupProgressData', () => {
  it('turns last trained into Vilnius days ago', async () => {
    const now = new Date();
    db.group.mockResolvedValue({
      columns: [],
      rows: [{ player: { id: 'p', displayName: 'Rokas' }, lastTrained: now, cells: [] }],
    });
    const grid = await groupProgressData(UUID);
    expect(grid.rows[0]?.lastTrainedDays).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @mychess/web exec vitest run src/server/coach-progress.test.ts`
Expected: FAIL, because `./coach-progress` cannot be resolved.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/server/coach-progress.ts
// The coach's progress loaders (S7). Each starts with requireCoach(). The
// db read decides access through the domain and filters again in SQL; an
// undefined read is a plain 404 (S4 plan decision 4). Dates leave as Vilnius
// days ago, so the server and browser render the same text.
import {
  coachGroupProgress,
  coachPlayerProgress,
  coachRepertoireProgress,
  type GroupProgressCell,
  type ProgressRow,
  type RepertoireRef,
} from '@mychess/db';
import type { ChapterProgress, Standing } from '@mychess/chess';
import type { AccountRef, BadgeSet } from '@mychess/domain';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { daysAgo } from '../lib/days-ago';
import { accountIdSchema } from './account-id';
import { chapterTitleIn } from './chapter-names';
import { requireCoach } from './coaching';
import { getDb } from './db';

const days = (at: Date | null, now: Date): number | null =>
  at === null ? null : daysAgo(at, now);

/** The player page's progress section. */
export interface PlayerProgressSection {
  readonly rows: readonly ProgressRow[];
  readonly lastTrainedDays: number | null;
}

/**
 * The progress section for a player whose page loader already allowed
 * them (`profile`). A refused read here means the link went in between:
 * 404 as well.
 */
export async function playerProgressData(
  playerId: string,
): Promise<PlayerProgressSection> {
  const coach = await requireCoach();
  const now = new Date();
  const read =
    (await coachPlayerProgress(getDb(), coach.id, playerId, now)) ?? notFound();
  return { rows: read.rows, lastTrainedDays: days(read.lastTrained, now) };
}

export interface ChapterRow extends Omit<ChapterProgress, 'chapter'> {
  readonly id: string;
  readonly title: string;
}

/** The progress page (R-151). */
export interface ProgressPage {
  readonly player: AccountRef;
  readonly repertoire: RepertoireRef;
  readonly badges: BadgeSet | null;
  readonly standing: Standing;
  readonly chapters: readonly ChapterRow[];
}

const idsSchema = z.object({ playerId: accountIdSchema, repertoireId: z.uuid() });

/**
 * One player's progress on one repertoire. A malformed id, an unlinked
 * player, a private or forked repertoire: all 404.
 */
export async function coachProgressData(
  rawPlayerId: unknown,
  rawRepertoireId: unknown,
): Promise<ProgressPage> {
  const coach = await requireCoach();
  const parsed = idsSchema.safeParse({ playerId: rawPlayerId, repertoireId: rawRepertoireId });
  if (!parsed.success) notFound();
  const { playerId, repertoireId } = parsed.data;
  const view =
    (await coachRepertoireProgress(getDb(), coach.id, playerId, repertoireId, new Date())) ??
    notFound();
  const title = chapterTitleIn(coach.locale);
  const { counts, mastered, chapters } = view.progress;
  return {
    player: view.player,
    repertoire: view.repertoire,
    badges: view.badges,
    standing: { counts, mastered },
    chapters: chapters.map(({ chapter, ...rest }) => ({
      ...rest,
      id: chapter.id,
      title: title(chapter),
    })),
  };
}

export interface GridRow {
  readonly player: AccountRef;
  readonly lastTrainedDays: number | null;
  readonly cells: readonly (GroupProgressCell | null)[];
}

/** The group grid (R-152). */
export interface GroupGrid {
  readonly columns: readonly RepertoireRef[];
  readonly rows: readonly GridRow[];
}

/** The grid of the coach's own group; any other group is 404. */
export async function groupProgressData(rawGroupId: unknown): Promise<GroupGrid> {
  const coach = await requireCoach();
  const parsed = z.uuid().safeParse(rawGroupId);
  if (!parsed.success) notFound();
  const now = new Date();
  const grid =
    (await coachGroupProgress(getDb(), coach.id, parsed.data, now)) ?? notFound();
  return {
    columns: grid.columns,
    rows: grid.rows.map((row) => ({
      player: row.player,
      lastTrainedDays: days(row.lastTrained, now),
      cells: row.cells,
    })),
  };
}
```

The test's `notFound` mock throws, as Next's does. Check that the real
`requireCoach` mock path is `./coaching`. It is in `coach-pages.ts`.

In `apps/web/src/server/coach-pages.ts`:
- `CoachHomeData.players` becomes `readonly (LinkedAccount & { readonly
  lastTrainedDays: number | null })[]`.
- `coachHomeData` reads `coachLastTrained(db, coach.id, players.map(p =>
  p.id))` once and maps each player with `daysAgo`.
- `CoachPlayerPage` gains `progress: PlayerProgressSection`.
- `coachPlayerData` calls `playerProgressData(parsed.data)` after
  `assertCoachMaySee`.

Add a test case for each to the existing `coach-pages` tests, mocking
`coachLastTrained`.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `pnpm --filter @mychess/web exec vitest run src/server`
Expected: PASS.

- [ ] **Step 5: Commit** (lead, after the gate and security-reviewer)

```bash
git add apps/web/src/server/coach-progress.ts apps/web/src/server/coach-progress.test.ts apps/web/src/server/coach-pages.ts apps/web/src/server/*.test.ts
git commit -m "feat(web): coach progress loaders (#257)"
```

### Task D3: Players list and player page - web-dev - UX

**Files:**
- Modify: `apps/web/src/app/treneris/players-list.tsx` (+ test)
- Modify: `apps/web/src/app/treneris/page.tsx`
- Create: `apps/web/src/app/treneris/zaidejai/[playerId]/progress-section.tsx` (+ test)
- Modify: `apps/web/src/app/treneris/zaidejai/[playerId]/player-view.tsx`, `page.tsx` (+ tests)

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/app/treneris/zaidejai/[playerId]/progress-section.test.tsx
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import { ProgressSection } from './progress-section';

const p = MESSAGES.lt.coach.progress;
const COUNTS = { notStarted: 2, skipped: 0, due: 1, learned: 1 };

function show(): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ProgressSection
        player={{ id: 'p-1', displayName: 'Rokas' }}
        progress={{
          lastTrainedDays: 4,
          rows: [
            {
              repertoire: { id: 'r-1', name: 'Karo-Kan gynyba', side: 'black' },
              source: 'assigned',
              badges: { overdue: true, paused: false, forked: false, updated: false },
              standing: { counts: COUNTS, mastered: false },
            },
            {
              repertoire: { id: 'r-2', name: 'Itališkoji partija', side: 'white' },
              source: 'assigned',
              badges: { overdue: false, paused: false, forked: true, updated: false },
              standing: null,
            },
          ],
        }}
      />
    </NextIntlClientProvider>,
  );
}

describe('the player page’s progress section (R-150, R-153, R-154)', () => {
  it('links each visible repertoire to its progress page with % and badges', () => {
    show();
    const link = screen.getByRole('link', { name: /Karo-Kan gynyba/ });
    expect(link.getAttribute('href')).toBe('/treneris/zaidejai/p-1/pazanga/r-1');
    const row = link.closest('li');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText('Pradelsta')).toBeTruthy();
    expect(within(row).getByText(/50 % išmokta/)).toBeTruthy();
  });

  it('shows a forked assignment with its badge, no link and no numbers', () => {
    show();
    expect(screen.queryByRole('link', { name: /Itališkoji partija/ })).toBeNull();
    expect(screen.getByText(p.forkedNote)).toBeTruthy();
  });

  it('says when the player last trained', () => {
    show();
    expect(screen.getByText(/prieš 4 dienas/)).toBeTruthy();
  });
});
```

Add to `players-list.test.tsx`: a row with `lastTrainedDays: 1` shows
"Paskutinį kartą treniravosi vakar".

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @mychess/web exec vitest run src/app/treneris`
Expected: FAIL, because `./progress-section` is missing and the list has no
last-trained line.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/app/treneris/zaidejai/[playerId]/progress-section.tsx
import type { ProgressRow } from '@mychess/db';
import { percentLearned } from '@mychess/chess';
import type { AccountRef } from '@mychess/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachProgressPath } from '../../../../lib/routes';
import type { PlayerProgressSection } from '../../../../server/coach-progress';
import { AssignmentBadges } from '../../../assignment-badges';
import { SECTION, SECTION_TITLE } from '../../../nustatymai/styles';
import { LastTrained } from '../../last-trained';
import { StateBar } from '../../state-bar';

function Row({
  playerId,
  row,
}: {
  readonly playerId: string;
  readonly row: ProgressRow;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const { repertoire, standing, badges } = row;
  const percent = standing === null ? null : percentLearned(standing.counts);
  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {standing === null ? (
          <span className="font-semibold">{repertoire.name}</span>
        ) : (
          <Link
            href={coachProgressPath(playerId, repertoire.id)}
            className="min-h-touch font-semibold text-accent underline"
          >
            {repertoire.name}
          </Link>
        )}
        <span className="text-sm text-fg-muted">
          {t(row.source)}
          {percent === null ? null : ` · ${t('percent', { percent })}`}
        </span>
      </div>
      {badges === null ? null : <AssignmentBadges flags={badges} />}
      {standing === null ? (
        <p className="text-sm text-fg-muted">{t('forkedNote')}</p>
      ) : (
        <StateBar counts={standing.counts} mastered={standing.mastered} />
      )}
    </li>
  );
}

/** Every repertoire the coach may see progress on, and last trained (R-150 to R-154). */
export function ProgressSection({
  player,
  progress,
}: {
  readonly player: AccountRef;
  readonly progress: PlayerProgressSection;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('title')}
      </h2>
      <LastTrained days={progress.lastTrainedDays} />
      {progress.rows.length === 0 ? (
        <p className="text-fg-muted">{t('empty', { name: player.displayName })}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {progress.rows.map((row) => (
            <Row key={row.repertoire.id} playerId={player.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
```

`ProgressSection` has no hooks beyond translations and `useId`, so it can be
used from the client `PlayerView`. Import the `PlayerProgressSection` type
only (`import type`), so the server module never reaches the browser bundle.
The `client-bundle.spec.ts` E2E guards this.

`player-view.tsx`:
- `CoachPlayerPageData` gains `readonly progress: PlayerProgressSection`.
- Render `<ProgressSection player={player} progress={player.progress} />`
  first, above `SharedRepertoires`.
- Each shared repertoire item in `SharedRepertoires` gains a second link,
  `t('coach.progress.title')`, to `coachProgressPath(player.id,
  repertoire.id)` (spec decision 7).

`page.tsx` passes `progress` through. In `players-list.tsx`,
`CoachPlayerRow` gains `readonly lastTrainedDays: number | null`, and
`<LastTrained days={player.lastTrainedDays} />` goes under the groups line.
`app/treneris/page.tsx` passes it. Update `player-view.test.tsx`'s `ROKAS`
fixture and `page.test.tsx` with `progress: { rows: [], lastTrainedDays:
null }`.

- [ ] **Step 4: Run the tests and check that they pass**

Run: `pnpm --filter @mychess/web exec vitest run src/app/treneris`
Expected: PASS.

- [ ] **Step 5: Commit** (lead, after the gate, ux-designer and i18n-content)

```bash
git add apps/web/src/app/treneris
git commit -m "feat(web): progress on the coach's player page and last trained on the players list (#257)"
```

### Task D4: The progress page - web-dev - UX

**Files:**
- Create: `apps/web/src/app/treneris/zaidejai/[playerId]/pazanga/[repertoireId]/page.tsx`
- Create: `apps/web/src/app/treneris/zaidejai/[playerId]/pazanga/[repertoireId]/progress-view.tsx`
- Create: `apps/web/src/app/treneris/zaidejai/[playerId]/pazanga/[repertoireId]/progress-view.test.tsx`
- Create: `apps/web/src/app/treneris/zaidejai/[playerId]/pazanga/[repertoireId]/page.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// .../pazanga/[repertoireId]/progress-view.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../../../i18n/locales';
import type { ProgressPage } from '../../../../../../server/coach-progress';
import { ProgressView } from './progress-view';

const COUNTS = { notStarted: 0, skipped: 0, due: 0, learned: 3 };
const PAGE: ProgressPage = {
  player: { id: 'p-1', displayName: 'Rokas' },
  repertoire: { id: 'r-1', name: 'Karo-Kan gynyba', side: 'black' },
  badges: { overdue: false, paused: true, forked: false, updated: false },
  standing: { counts: COUNTS, mastered: true },
  chapters: [
    {
      id: 'ch1',
      title: 'Advance variation',
      whiteFirst: true,
      counts: COUNTS,
      mastered: true,
      lines: [{ sans: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'], counts: COUNTS, mastered: true }],
    },
  ],
};

function show(): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ProgressView page={PAGE} />
    </NextIntlClientProvider>,
  );
}

describe('the progress page (R-151)', () => {
  it('heads with the player and repertoire, badges and the whole bar', () => {
    show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Karo-Kan gynyba');
    expect(screen.getByText('Pristabdyta')).toBeTruthy();
  });

  it('opens a chapter to its numbered lines', () => {
    show();
    fireEvent.click(screen.getByText('Advance variation'));
    expect(screen.getByText('1. e4 c6 2. d4 d5 3. e5 Bf5')).toBeTruthy();
  });

  it('marks a mastered chapter', () => {
    show();
    expect(screen.getAllByText(MESSAGES.lt.coach.progress.mastered).length).toBeGreaterThan(0);
  });
});
```

`page.test.tsx` follows `zaidejai/[playerId]/page.test.tsx`: it mocks
`coachProgressData` and checks that the page passes `params` through and
renders the view.

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @mychess/web exec vitest run "src/app/treneris/zaidejai/[playerId]/pazanga"`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

```tsx
// .../pazanga/[repertoireId]/progress-view.tsx
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachPlayerPath } from '../../../../../../lib/routes';
import type { ChapterRow, ProgressPage } from '../../../../../../server/coach-progress';
import { AssignmentBadges } from '../../../../../assignment-badges';
import { moveNumber } from '../../../../../repertoire-view';
import {
  SECTION,
  SECTION_TITLE,
  TEXT_LINK,
} from '../../../../../nustatymai/styles';
import { StateBar } from '../../../../state-bar';
import { COACH_PAGE, SubpageHeader } from '../../../../subpage-header';

/**
 * "1. e4 c6 2. d4": a line's moves numbered from the chapter root, a
 * number before the first move and before every White move.
 */
export function lineText(sans: readonly string[], whiteFirst: boolean): string {
  return sans
    .map((san, ply) => {
      const number = moveNumber(ply, whiteFirst);
      return ply === 0 || !number.endsWith('...') ? `${number} ${san}` : san;
    })
    .join(' ');
}

function Chapter({ chapter }: { readonly chapter: ChapterRow }): JSX.Element {
  const t = useTranslations('coach.progress');
  return (
    <li>
      <details className="flex flex-col gap-2">
        <summary className="flex min-h-touch cursor-pointer flex-col justify-center gap-1">
          <span className="font-semibold">{chapter.title}</span>
          <StateBar counts={chapter.counts} mastered={chapter.mastered} />
        </summary>
        <ul aria-label={t('lines')} className="flex flex-col gap-3 pl-4">
          {chapter.lines.map((line) => (
            <li key={line.sans.join(' ')} className="flex flex-col gap-1">
              <span className="break-words text-sm">{lineText(line.sans, chapter.whiteFirst)}</span>
              <StateBar counts={line.counts} mastered={line.mastered} />
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** One player's progress on one repertoire, chapter by chapter, line by line. */
export function ProgressView({ page }: { readonly page: ProgressPage }): JSX.Element {
  const t = useTranslations('coach.progress');
  const titleId = useId();
  const chaptersId = useId();
  return (
    <main className={COACH_PAGE}>
      <SubpageHeader title={page.repertoire.name} titleId={titleId}>
        <Link href={coachPlayerPath(page.player.id)} className={TEXT_LINK}>
          {page.player.displayName}
        </Link>
        {page.badges === null ? null : <AssignmentBadges flags={page.badges} />}
        <StateBar counts={page.standing.counts} mastered={page.standing.mastered} />
      </SubpageHeader>
      <section aria-labelledby={chaptersId} className={SECTION}>
        <h2 id={chaptersId} className={SECTION_TITLE}>
          {t('chapters')}
        </h2>
        <ul className="flex flex-col gap-4">
          {page.chapters.map((chapter) => (
            <Chapter key={chapter.id} chapter={chapter} />
          ))}
        </ul>
      </section>
    </main>
  );
}
```

Add a `lineText` unit test to `progress-view.test.tsx` with a Black-first
chapter: `lineText(['c6', 'd4', 'd5'], false)` gives `1... c6 2. d4 d5`.

```tsx
// .../pazanga/[repertoireId]/page.tsx
import type { JSX } from 'react';
import { coachProgressData } from '../../../../../../server/coach-progress';
import { ProgressView } from './progress-view';

// One player's progress on one repertoire (R-151). The loader decides who
// may see it; an unlinked player, a private or forked repertoire and a
// malformed id are all 404.
export default async function CoachProgressPage({
  params,
}: {
  readonly params: Promise<{ playerId: string; repertoireId: string }>;
}): Promise<JSX.Element> {
  const { playerId, repertoireId } = await params;
  return <ProgressView page={await coachProgressData(playerId, repertoireId)} />;
}
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit** (lead, after the gate, ux-designer and i18n-content)

```bash
git add "apps/web/src/app/treneris/zaidejai/[playerId]/pazanga"
git commit -m "feat(web): the coach's progress page, chapters and lines (#257)"
```

### Task D5: The group grid - web-dev - UX

**Files:**
- Create: `apps/web/src/app/treneris/grupes/[groupId]/progress-grid.tsx` (+ test)
- Modify: `apps/web/src/app/treneris/grupes/[groupId]/page.tsx` (+ test)
- Modify: `apps/web/src/app/treneris/grupes/[groupId]/group-view.tsx`
  (render the grid above Members)

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/app/treneris/grupes/[groupId]/progress-grid.test.tsx
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import { ProgressGrid } from './progress-grid';

const NONE = { overdue: false, paused: false, forked: false, updated: false };

function show(): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ProgressGrid
        grid={{
          columns: [{ id: 'r-1', name: 'Karo-Kan gynyba', side: 'black' }],
          rows: [
            {
              player: { id: 'p-1', displayName: 'Gabija' },
              lastTrainedDays: 0,
              cells: [{ badges: NONE, standing: { counts: { notStarted: 1, skipped: 0, due: 5, learned: 2 }, mastered: false } }],
            },
            {
              player: { id: 'p-2', displayName: 'Rokas' },
              lastTrainedDays: null,
              cells: [{ badges: { ...NONE, forked: true }, standing: null }],
            },
          ],
        }}
      />
    </NextIntlClientProvider>,
  );
}

describe('the group grid (R-152)', () => {
  it('is a table: a column per repertoire, a row per player', () => {
    show();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Karo-Kan gynyba' })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: /Gabija/ })).toBeTruthy();
  });

  it('shows % learned and due in a cell that opens the player’s progress', () => {
    show();
    const cell = screen.getByRole('link', { name: /88 %/ });
    expect(cell.getAttribute('href')).toBe('/treneris/zaidejai/p-1/pazanga/r-1');
    expect(within(cell).getByText(/5 kartotinų/)).toBeTruthy();
  });

  it('shows a forked cell with its badge only', () => {
    show();
    expect(screen.getByText('Pasidarė asmeninę kopiją')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `pnpm --filter @mychess/web exec vitest run "src/app/treneris/grupes"`
Expected: FAIL, because `./progress-grid` is missing.

- [ ] **Step 3: Implement**

Add `"cellDue": "{due, plural, one {# kartotinas} few {# kartotini} other
{# kartotinų}}"` to `coach.progress` in `lt.json`, and `"cellDue": "{due}
due"` in `en.json`.

```tsx
// apps/web/src/app/treneris/grupes/[groupId]/progress-grid.tsx
import { percentLearned } from '@mychess/chess';
import type { GroupProgressCell } from '@mychess/db';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type JSX } from 'react';
import { coachPlayerPath, coachProgressPath } from '../../../../lib/routes';
import type { GroupGrid } from '../../../../server/coach-progress';
import { AssignmentBadges } from '../../../assignment-badges';
import { SECTION, SECTION_TITLE, TEXT_LINK } from '../../../nustatymai/styles';
import { LastTrained } from '../../last-trained';

function Cell({
  cell,
  href,
}: {
  readonly cell: GroupProgressCell | null;
  readonly href: string;
}): JSX.Element {
  const t = useTranslations('coach.progress');
  if (cell === null) return <span className="text-fg-muted">{t('noAssignment')}</span>;
  const percent = cell.standing === null ? null : percentLearned(cell.standing.counts);
  return (
    <div className="flex flex-col gap-1">
      {cell.standing === null ? null : (
        <Link href={href} className="flex min-h-touch flex-col justify-center text-accent underline">
          <span>{percent === null ? t('nothing') : t('percent', { percent })}</span>
          <span className="text-sm">{t('cellDue', { due: cell.standing.counts.due })}</span>
        </Link>
      )}
      <AssignmentBadges flags={cell.badges} />
      {cell.standing?.mastered === true ? (
        <span className="text-sm font-semibold text-success">{t('mastered')}</span>
      ) : null}
    </div>
  );
}

/**
 * Players x the group's repertoires (R-152). On a phone the table scrolls
 * sideways with the player column fixed; the page itself never scrolls
 * sideways. Group members see none of this (R-50): it is the coach's page.
 */
export function ProgressGrid({ grid }: { readonly grid: GroupGrid }): JSX.Element {
  const t = useTranslations('coach.progress');
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={SECTION}>
      <h2 id={titleId} className={SECTION_TITLE}>
        {t('gridTitle')}
      </h2>
      {grid.columns.length === 0 ? (
        <p className="text-fg-muted">{t('gridEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 bg-surface p-2">{t('player')}</th>
                {grid.columns.map((column) => (
                  <th key={column.id} scope="col" className="min-w-36 p-2">
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.player.id} className="border-t border-border align-top">
                  <th scope="row" className="sticky left-0 bg-surface p-2 font-normal">
                    <Link href={coachPlayerPath(row.player.id)} className={TEXT_LINK}>
                      {row.player.displayName}
                    </Link>
                    <LastTrained days={row.lastTrainedDays} />
                  </th>
                  {row.cells.map((cell, i) => {
                    const column = grid.columns[i];
                    return column === undefined ? null : (
                      <td key={column.id} className="p-2">
                        <Cell cell={cell} href={coachProgressPath(row.player.id, column.id)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

`page.tsx` loads `groupProgressData(groupId)` beside `coachGroupData` and
passes `grid` to `GroupView`. `GroupView` gains `readonly grid: GroupGrid`
on its props (not on `CoachGroupPageData`) and renders `<ProgressGrid
grid={grid} />` above `Members`. Update `group-view.test.tsx` and
`page.test.tsx` for the new prop. The grid's `rowheader` name includes the
"last trained" text, so the test matches the name with a regex. ux-designer
checks the sticky column background (`bg-surface`) in both themes at 390px.

- [ ] **Step 4: Run the test and check that it passes**

Run: `pnpm --filter @mychess/web exec vitest run "src/app/treneris/grupes"`
Expected: PASS.

- [ ] **Step 5: Commit** (lead, after the gate, ux-designer and i18n-content)

```bash
git add "apps/web/src/app/treneris/grupes" apps/web/src/i18n/messages
git commit -m "feat(web): the group progress grid (#257)"
```

---

## Part E: Verification and close

### Task E1: C-M1-5 end to end - qa

**Files:**
- Create: `apps/web/e2e/support/progress-db.ts`
- Create: `apps/web/e2e/coach-progress.spec.ts`

The journey reuses the S5 cast (`apps/web/e2e/support/assignment-people.ts`:
`COACH`, `GABIJA`, `ROKAS`, `DOVYDAS`, `GROUP`, `coachReady`,
`playerAccepts`), and `importRepertoire` and `assignTo` from
`support/assignments.ts`. Read `apps/web/e2e/assignments.spec.ts` first and
build the cast the same way.

- [ ] **Step 1: Write the seeding helper**

```ts
// apps/web/e2e/support/progress-db.ts
// A known Review history for the C-M1-5 journey (S7 plan Task E1), written
// straight into the E2E database. Only the test's own @mychess.test accounts
// are touched, found by email. Every value is a bound parameter.
import pg from 'pg';

const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgres://mychess:mychess@127.0.0.1:5432/mychess';

async function query(text: string, values: readonly unknown[]): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(text, [...values]);
  } finally {
    await client.end();
  }
}

/** One Review per key, in the state the coach should see (R-150). */
export type SeedState = 'learned' | 'due' | 'skipped';

/**
 * Writes a Review of each key for the player of `email`: learned (due in
 * a week), due (an hour ago) or skipped ("I know this" today, due
 * tomorrow, never graded). Also one training result now on `repertoireId`,
 * so "last trained" reads today.
 */
export async function seedHistory(
  email: string,
  repertoireId: string,
  keys: Readonly<Record<SeedState, readonly string[]>>,
): Promise<void> {
  for (const [state, list] of Object.entries(keys)) {
    if (list.length === 0) continue;
    const skipped = state === 'skipped';
    const due =
      state === 'due' ? "now() - interval '1 hour'" : state === 'learned' ? "now() + interval '7 days'" : "now() + interval '1 day'";
    await query(
      `insert into reviews (player_id, move_key, due, stability, difficulty,
         elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
         last_review, learned_at, skipped_at, created_at, updated_at)
       select a.id, k, ${due}, 8, 5, 1, 7, 0, $3, 0, 2,
         now() - interval '1 day',
         case when $4 then null else now() - interval '8 days' end,
         case when $4 then now() else null end,
         now() - interval '8 days', now()
       from accounts a, unnest($2::text[]) as k
       where a.email = $1`,
      [email, list, skipped ? 1 : 2, skipped],
    );
  }
  await query(
    `insert into review_results (result_id, player_id, move_key, repertoire_id,
       kind, answered_at, applied, received_at)
     select gen_random_uuid(), a.id, 'seed', $2::uuid, 'pass', now(), true, now()
     from accounts a where a.email = $1`,
    [email, repertoireId],
  );
}
```

`${due}` is one of three fixed SQL fragments chosen in code, never user
input. Every value is still a bound parameter.

- [ ] **Step 2: Write the journey**

```ts
// apps/web/e2e/coach-progress.spec.ts
// C-M1-5 (docs/personas/coach.md): the coach opens the group's progress
// and each player's state matches the history seeded for them; Rokas's
// private repertoire is not listed (R-39).
import { expect } from '@playwright/test';
// imports of the S5 cast and helpers as in assignments.spec.ts
import { seedHistory } from './support/progress-db';
import { test } from './support/journey';

test('C-M1-5: the coach sees each player’s progress as seeded', async ({ browser }) => {
  // 1. Cast: the coach, three players linked into GROUP (as assignments.spec.ts).
  // 2. The coach imports karo-kan.pgn and assigns it to GROUP; Rokas imports
  //    a private repertoire of his own.
  // 3. Read the repertoire id from the coach's repertoire URL, and the
  //    Caro-Kann's own-move keys with @mychess/chess (importPgn on the same
  //    fixture, then playerKeys).
  // 4. seedHistory: Gabija learned all; Rokas 2 due and 1 skipped;
  //    Dovydas none.
  // 5. The coach opens the group page: the grid shows Gabija 100 %,
  //    Rokas's due count 2, Dovydas 0 %; "last trained" reads today for
  //    Gabija and Rokas and "not trained yet" for Dovydas.
  // 6. The coach opens Rokas's cell: the progress page's whole-repertoire
  //    line reads "… 2 kartotini · 1 pažymėta „Žinau“ …"; a chapter opens to
  //    its lines.
  // 7. The coach opens Rokas's player page: his private repertoire's name
  //    appears nowhere.
  // 8. The coach requests the progress URL of Rokas's private repertoire
  //    directly: 404.
});
```

qa writes steps 1 to 8 as code with the S5 helpers. The comments above are
the journey's acceptance points, not code to keep. Each `expect` uses the
catalogue text through `format` and `CATALOGUES` from `support/journey`, as
the S5 journeys do.

- [ ] **Step 3: Run it**

Run: `pnpm --filter @mychess/web exec playwright test e2e/coach-progress.spec.ts`
Expected: PASS. Also run `client-bundle.spec.ts`; it must still pass, with
no server module in the browser bundle.

- [ ] **Step 4: Commit** (lead, after the gate)

```bash
git add apps/web/e2e/coach-progress.spec.ts apps/web/e2e/support/progress-db.ts
git commit -m "test(e2e): C-M1-5 coach progress against a seeded history (#257)"
```

### Task E2: Docs and close - lead

- [ ] **Step 1:** Check that the spec still matches what was built; write
  any change made during the build into it.
- [ ] **Step 2:** i18n-content adds the S7 terms to `docs/glossary-lt.md`:
  progress "pažanga" and the `pazanga` slug, Mastered "įvaldyta", skipped
  "pažymėta „Žinau“", and "last trained". The lead records a closing ruling
  in `docs/owner-rulings.md` (R-155, "S7 terms"), as R-148 did for S6.
- [ ] **Step 3:** `docs/CONTEXT.md`: add "Move state (coach view)" under the
  training terms, pointing at R-150.
- [ ] **Step 4:** Run `mp-code-review` on the slice's diff since `f84e15f`,
  then `improve-codebase-architecture` on `packages/*/src/**/progress*`,
  `packages/db/src/progress/` and the new web files. The owner picks the
  follow-ups. Then run `retro`.
- [ ] **Step 5:** Close #257 when C-M1-5 passes on staging.

---

## Self-review notes (planning)

- Spec coverage:
  - Every spec section maps to a task: chess A1, domain B1, database C1 and
    C2, web D1 to D5, error handling (404 paths in D2 and D4, "nothing to
    learn" in D1, "not trained yet" in D1), testing in every task and E1.
  - The four states are R-150 (A1), the drill-down R-151 (A1, D4), the grid
    R-152 (C2, D5), last trained R-153 (C1, D1 to D3), and forked R-154
    (B1, C2, D3, D5).
- Types:
  - `TrackedReview`, `Standing`, `ProgressCounts` and `RepertoireProgress`
    are defined in A1 and used in C1, C2 and D1 to D5.
  - `CoachProgressFacts` is defined in B1 and used in C1 and C2.
  - `ProgressRow`, `GroupProgressCell` and `RepertoireRef` are defined in C2
    and used in D2 to D5.
  - `PlayerProgressSection`, `ProgressPage`, `ChapterRow` and `GroupGrid`
    are defined in D2 and used in D3 to D5.
