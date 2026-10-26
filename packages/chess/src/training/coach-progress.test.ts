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
  moveState,
  percentLearned,
  progressOf,
  repertoireStanding,
  type MoveState,
  type TrackedReview,
} from './coach-progress';
import { mastered } from './progress';
import { DAY_MS, grade, startReview, type ReviewState } from './schedule';

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

describe('moveState (R-151)', () => {
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
    expect(moveState({ review: graded, skipped: true }, DAY_AGO)).toBe(
      'learned',
    );
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

describe('progressOf (R-152)', () => {
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

  it('leaves out lines that hold no own move', () => {
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

  it('puts every own move of the repertoire in exactly one state', () => {
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
// they share no own move (a White one could not: one answer per position).
const DISJOINT = graphOf(
  '[Event "Sicilian"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 *\n\n' +
    '[Event "Queen\'s Gambit"]\n\n1. d4 d5 2. c4 e6 *',
  'black',
);

const chapterKeys = (graph: RepertoireGraph, chapterId: string): string[] =>
  graph.moves
    .filter((m) => m.chapters.includes(chapterId) && isPlayerMove(graph, m))
    .map((m) => moveKey(m.from, m.san));

const makers = [learned, dueNow, skippedNotDue];

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

const statesOf = (
  reviews: ReadonlyMap<string, TrackedReview>,
): Map<string, ReviewState> =>
  new Map([...reviews].map(([key, t]) => [key, t.review]));

describe('progressOf properties', () => {
  const keys = playerKeys(DISJOINT);

  it('has two chapters sharing no own move', () => {
    const [a, b] = DISJOINT.chapters.map((c) => chapterKeys(DISJOINT, c.id));
    expect([a?.length, b?.length]).toEqual([3, 2]);
    expect(a?.filter((k) => b?.includes(k))).toEqual([]);
  });

  it('is mastered exactly when `mastered` says so, for the repertoire and each chapter', () => {
    fc.assert(
      fc.property(reviewsOver(keys), (reviews) => {
        const states = statesOf(reviews);
        const progress = progressOf(DISJOINT, reviews, NOW);
        expect(progress.mastered).toBe(
          mastered({ kind: 'moves', keys }, states, NOW),
        );
        for (const chapter of progress.chapters) {
          const own = chapterKeys(DISJOINT, chapter.chapter.id);
          expect(chapter.mastered).toBe(
            mastered({ kind: 'moves', keys: own }, states, NOW),
          );
        }
      }),
    );
  });

  it('sums chapter counts to the repertoire counts when no own move is shared', () => {
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

describe('percentLearned', () => {
  it('counts every move with a Review, rounded', () => {
    expect(
      percentLearned({ notStarted: 2, skipped: 1, due: 1, learned: 2 }),
    ).toBe(67);
  });

  it('is null with no own moves', () => {
    expect(
      percentLearned({ notStarted: 0, skipped: 0, due: 0, learned: 0 }),
    ).toBeNull();
  });
});
