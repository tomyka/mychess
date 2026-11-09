import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import {
  isPlayerMove,
  moveKey,
  playerKeys,
  type RepertoireGraph,
  type Side,
} from '../repertoire/graph';
import {
  percentLearned,
  progressOf,
  repertoireStanding,
  totalMoves,
} from './coach-progress';
import { moveState, type MoveState, type TrackedReview } from './move-state';
import { mastered } from './progress';
import {
  DAY_MS,
  grade,
  retrievability,
  startReview,
  type ReviewState,
} from './schedule';

const NOW = new Date('2026-10-26T09:00:00Z');
const DAY_AGO = new Date(NOW.getTime() - DAY_MS);
const WEEK_AGO = new Date(NOW.getTime() - 7 * DAY_MS);

function graphOf(pgn: string, side: Side = 'white'): RepertoireGraph {
  const imported = importPgn(pgn, side);
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
    knownWithoutLearning: false,
  };
};
const dueNow = (key: string): TrackedReview => ({
  review: startReview(key, new Date(NOW.getTime() - 2 * DAY_MS)),
  knownWithoutLearning: false,
});
/** Learned a week ago and reviewed correctly an hour ago. */
const reviewedToday = (key: string): TrackedReview => ({
  review: grade(
    startReview(key, WEEK_AGO),
    'pass',
    new Date(NOW.getTime() - 3_600_000),
  ),
  knownWithoutLearning: false,
});
const skippedNotDue = (key: string): TrackedReview => ({
  review: startReview(key, NOW),
  knownWithoutLearning: true,
});

describe('moveState (R-151)', () => {
  it('is not started without a Review', () => {
    expect(moveState(undefined, NOW)).toBe('notStarted');
  });

  it('is due once the Review is due, skipped or not', () => {
    expect(moveState(dueNow('k'), NOW)).toBe('due');
    expect(moveState({ ...dueNow('k'), knownWithoutLearning: true }, NOW)).toBe(
      'due',
    );
  });

  it('is skipped for "I know this" never graded since', () => {
    expect(moveState(skippedNotDue('k'), NOW)).toBe('skipped');
  });

  it('is learned for a skipped move graded since', () => {
    const graded = grade(startReview('k', WEEK_AGO), 'pass', DAY_AGO);
    expect(
      moveState({ review: graded, knownWithoutLearning: true }, DAY_AGO),
    ).toBe('learned');
  });

  it('is learned for a learn pass not yet due', () => {
    expect(moveState(learned('k'), NOW)).toBe('learned');
  });
});

describe('repertoireStanding', () => {
  it('counts every player move once, in one state', () => {
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

  it('is mastered when every player move is learned and recalled at 90% or more (R-56)', () => {
    const reviews = new Map(KEYS.map((key) => [key, reviewedToday(key)]));
    expect(repertoireStanding(GRAPH, reviews, NOW).mastered).toBe(true);
  });

  it('is not mastered while every move is skipped and never reviewed (R-178)', () => {
    const reviews = new Map(KEYS.map((key) => [key, skippedNotDue(key)]));
    expect(repertoireStanding(GRAPH, reviews, NOW).mastered).toBe(false);
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

describe('progressOf (R-152)', () => {
  it('drills down to each chapter and its lines with player moves', () => {
    const progress = progressOf(GRAPH, new Map(), NOW);
    expect(progress.chapters).toHaveLength(GRAPH.chapters.length);
    const lines = progress.chapters.flatMap((chapter) => chapter.lines);
    expect(lines.map((line) => line.sans)).toEqual([
      ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
      ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5'],
    ]);
    expect(lines.every((line) => line.counts.notStarted > 0)).toBe(true);
  });

  it('leaves out lines that hold no player move', () => {
    const imported = importPgn('1. e4 (1. d4) 1... e5 *', 'black');
    if (!imported.ok) throw new Error(imported.refusal.reason);
    const progress = progressOf(imported.value.graph, new Map(), NOW);
    const lines = progress.chapters.flatMap((chapter) => chapter.lines);
    expect(lines.map((line) => line.sans)).toEqual([['e4', 'e5']]);
    expect(progress.counts.notStarted).toBe(1);
  });

  it('numbers from the chapter root: White moves first from the start', () => {
    expect(progressOf(GRAPH, new Map(), NOW).chapters[0]?.whiteFirst).toBe(
      true,
    );
  });

  it('numbers from the chapter root: Black moves first from a FEN root', () => {
    const afterE4 =
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const imported = importPgn(`[FEN "${afterE4}"]\n\n1... c5 *`, 'black');
    if (!imported.ok) throw new Error(imported.refusal.reason);
    const [chapter] = progressOf(imported.value.graph, new Map(), NOW).chapters;
    expect(chapter?.whiteFirst).toBe(false);
    expect(chapter?.lines.map((line) => line.sans)).toEqual([['c5']]);
  });

  it('puts every player move of the repertoire in exactly one state', () => {
    fc.assert(
      fc.property(fc.subarray(KEYS), fc.subarray(KEYS), (dues, skips) => {
        const reviews = new Map<string, TrackedReview>([
          ...skips.map((k): [string, TrackedReview] => [k, skippedNotDue(k)]),
          ...dues.map((k): [string, TrackedReview] => [k, dueNow(k)]),
        ]);
        const { counts } = progressOf(GRAPH, reviews, NOW);
        const total =
          counts.notStarted + counts.skipped + counts.due + counts.learned;
        expect(total).toBe(KEYS.length);
        expect(counts.due).toBe(dues.length);
      }),
    );
  });
});

// A Black repertoire whose two chapters diverge on White's first move, so
// they share no player move (a White one could not: one answer per position).
const DISJOINT = graphOf(
  '[Event "Sicilian"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 *\n\n' +
    '[Event "Queen\'s Gambit"]\n\n1. d4 d5 2. c4 e6 *',
  'black',
);

const chapterKeys = (graph: RepertoireGraph, chapterId: string): string[] =>
  graph.moves
    .filter((m) => m.chapters.includes(chapterId) && isPlayerMove(graph, m))
    .map((m) => moveKey(m.from, m.san));

const makers = [learned, dueNow, skippedNotDue, reviewedToday];

/** Random Reviews over a random subset of `keys`, in every kind. */
const reviewsOver = (
  keys: readonly string[],
): fc.Arbitrary<Map<string, TrackedReview>> =>
  fc
    .array(fc.integer({ min: -1, max: makers.length - 1 }), {
      minLength: keys.length,
      maxLength: keys.length,
    })
    .map(
      (picks) =>
        new Map(
          keys.flatMap((key, i): [string, TrackedReview][] => {
            const make = makers[picks[i] ?? -1];
            return make === undefined ? [] : [[key, make(key)]];
          }),
        ),
    );

describe('progressOf properties', () => {
  const keys = playerKeys(DISJOINT);

  it('has two chapters sharing no player move', () => {
    const [a, b] = DISJOINT.chapters.map((c) => chapterKeys(DISJOINT, c.id));
    expect([a?.length, b?.length]).toEqual([3, 2]);
    expect(a?.filter((k) => b?.includes(k))).toEqual([]);
  });

  it('is mastered exactly when `mastered` says so, for the repertoire and each chapter', () => {
    fc.assert(
      fc.property(reviewsOver(keys), (reviews) => {
        const progress = progressOf(DISJOINT, reviews, NOW);
        expect(progress.mastered).toBe(
          mastered({ kind: 'moves', keys }, reviews, NOW),
        );
        for (const chapter of progress.chapters) {
          const own = chapterKeys(DISJOINT, chapter.chapter.id);
          expect(chapter.mastered).toBe(
            mastered({ kind: 'moves', keys: own }, reviews, NOW),
          );
        }
      }),
    );
  });

  it('sums chapter counts to the repertoire counts when no player move is shared', () => {
    fc.assert(
      fc.property(reviewsOver(keys), (reviews) => {
        const progress = progressOf(DISJOINT, reviews, NOW);
        const sum = (state: MoveState): number =>
          progress.chapters.reduce((n, c) => n + c.counts[state], 0);
        expect({
          notStarted: sum('notStarted'),
          skipped: sum('skipped'),
          due: sum('due'),
          learned: sum('learned'),
        }).toEqual(progress.counts);
      }),
    );
  });
});

describe('a move shared by two chapters', () => {
  // 1.e4 opens both chapters; each 2.Nf3 starts from its own position.
  const shared = graphOf(
    '[Event "Open"]\n\n1. e4 e5 2. Nf3 *\n\n' +
      '[Event "Sicilian"]\n\n1. e4 c5 2. Nf3 *',
  );
  const e4 = playerKeys(shared).find((k) => k.endsWith('|e4'));

  it('counts in each chapter and once for the repertoire', () => {
    if (e4 === undefined) throw new Error('fixture');
    const progress = progressOf(shared, new Map([[e4, learned(e4)]]), NOW);
    expect(progress.counts).toEqual({
      notStarted: 2,
      skipped: 0,
      due: 0,
      learned: 1,
    });
    expect(progress.chapters.map((c) => c.counts)).toEqual([
      { notStarted: 1, skipped: 0, due: 0, learned: 1 },
      { notStarted: 1, skipped: 0, due: 0, learned: 1 },
    ]);
  });
});

describe('totalMoves', () => {
  it('adds up the moves in every state', () => {
    expect(totalMoves({ notStarted: 2, skipped: 3, due: 5, learned: 7 })).toBe(
      17,
    );
  });

  it('is zero with no player moves', () => {
    expect(totalMoves({ notStarted: 0, skipped: 0, due: 0, learned: 0 })).toBe(
      0,
    );
  });
});

describe('percentLearned (R-177)', () => {
  it('counts learned moves only, rounded: not due, skipped or not started', () => {
    expect(
      percentLearned({ notStarted: 2, skipped: 1, due: 1, learned: 2 }),
    ).toBe(33);
  });

  it('rounds half and above up, not down', () => {
    expect(
      percentLearned({ notStarted: 1, skipped: 0, due: 0, learned: 2 }),
    ).toBe(67);
  });

  it('is 0 when every move is due and 100 when every move is learned', () => {
    expect(
      percentLearned({ notStarted: 0, skipped: 0, due: 10, learned: 0 }),
    ).toBe(0);
    expect(
      percentLearned({ notStarted: 0, skipped: 0, due: 0, learned: 10 }),
    ).toBe(100);
  });

  it('is null with no player moves', () => {
    expect(
      percentLearned({ notStarted: 0, skipped: 0, due: 0, learned: 0 }),
    ).toBeNull();
  });
});

describe('a chapter learned yesterday (#321, R-177, R-178)', () => {
  // Ten White moves of the Ruy Lopez, one chapter.
  const ruy = graphOf(
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 ' +
      '7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 *',
  );
  const keys = playerKeys(ruy);
  // Learned 25 hours ago: due since an hour ago (R-58).
  const learnedAt = new Date(NOW.getTime() - 25 * 3_600_000);
  const reviewedAt = new Date(NOW.getTime() - 3_600_000);
  const viaLearn = (review: ReviewState): TrackedReview => ({
    review,
    knownWithoutLearning: false,
  });
  const yesterday = new Map(
    keys.map((k) => [k, viaLearn(startReview(k, learnedAt))]),
  );
  const reviewed = new Map(
    [...yesterday].map(([k, t]) => [
      k,
      viaLearn(grade(t.review, 'pass', reviewedAt)),
    ]),
  );

  it('has ten player moves', () => {
    expect(keys).toHaveLength(10);
  });

  it('counts none learned and is not mastered once all are due', () => {
    const progress = progressOf(ruy, yesterday, NOW);
    const [chapter] = progress.chapters;
    expect(chapter?.counts).toEqual({
      notStarted: 0,
      skipped: 0,
      due: 10,
      learned: 0,
    });
    expect(percentLearned(progress.counts)).toBe(0);
    expect(chapter?.mastered).toBe(false);
    expect(progress.mastered).toBe(false);
  });

  it('counts all learned and is mastered after a correct review today', () => {
    expect(
      [...reviewed.values()].every((t) => retrievability(t.review, NOW) >= 0.9),
    ).toBe(true);
    const progress = progressOf(ruy, reviewed, NOW);
    const [chapter] = progress.chapters;
    expect(chapter?.counts).toEqual({
      notStarted: 0,
      skipped: 0,
      due: 0,
      learned: 10,
    });
    expect(percentLearned(progress.counts)).toBe(100);
    expect(chapter?.mastered).toBe(true);
    expect(progress.mastered).toBe(true);
  });

  it('leaves a skipped move never reviewed out of the percentage and mastery', () => {
    const [first] = keys;
    if (first === undefined) throw new Error('fixture');
    const withSkip = new Map(reviewed);
    withSkip.set(first, {
      review: startReview(first, reviewedAt),
      knownWithoutLearning: true,
    });
    const progress = progressOf(ruy, withSkip, NOW);
    expect(progress.counts).toEqual({
      notStarted: 0,
      skipped: 1,
      due: 0,
      learned: 9,
    });
    expect(percentLearned(progress.counts)).toBe(90);
    expect(progress.chapters[0]?.mastered).toBe(false);
    expect(progress.mastered).toBe(false);
  });
});
