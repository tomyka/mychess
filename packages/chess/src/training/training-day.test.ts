import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import {
  playerKeys,
  type RepertoireGraph,
  type Side,
} from '../repertoire/graph';
import { buildQueue } from './queue';
import { DAY_MS, startReview, type ReviewState } from './schedule';
import type { TrainingRepertoire } from './scope';
import {
  allowance,
  dueCount,
  dueReviews,
  learnLines,
  newKeys,
  nextDue,
  startState,
  toLearnCount,
  trainingCounts,
  trainingProgress,
  type TrainingDay,
} from './training-day';

const NOW = new Date('2026-10-25T08:00:00Z');

function graph(pgn: string, side: Side): RepertoireGraph {
  const r = importPgn(pgn, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}

// Four White moves.
const white = graph('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 *', 'white');
const black = graph('1. e4 c6 2. d4 d5 *', 'black');
// 1. c4 e6 2. d4 Nf6 reaches the position of 1. d4 Nf6 2. c4 e6, so the two
// repertoires share one key, 3. Nc3: five own moves held, not six.
const transposing = graph('1. d4 Nf6 2. c4 e6 3. Nc3 *', 'white');
const transposed = graph('1. c4 e6 2. d4 Nf6 3. Nc3 *', 'white');
const NC3 = playerKeys(transposing).at(-1) ?? '';
const [E4 = '', NF3 = '', BC4 = '', C3 = ''] = playerKeys(white);
const BLACK_KEYS = playerKeys(black);

const repertoire = (
  g: RepertoireGraph,
  id = 'r1',
  active = true,
): TrainingRepertoire => ({ id, graph: g, active });

function day(overrides: Partial<TrainingDay> = {}): TrainingDay {
  return {
    repertoires: [repertoire(white)],
    reviews: new Map(),
    learned: new Set(),
    learnedToday: 0,
    limits: { reviews: 20, newPerDay: 10 },
    ...overrides,
  };
}

/** A Review of `key` due `ms` after NOW (before it when negative). */
function reviewIn(key: string, ms: number): ReviewState {
  const review = startReview(key, NOW);
  return {
    ...review,
    fsrs: { ...review.fsrs, due: new Date(NOW.getTime() + ms) },
  };
}

/** The Reviews, by key, and the learned keys they make. */
function reviewed(...reviews: ReviewState[]): Partial<TrainingDay> {
  return {
    reviews: new Map(reviews.map((r) => [r.key, r])),
    learned: new Set(reviews.map((r) => r.key)),
  };
}

/** A made-up position key: the side to move alternates, starting with White. */
const plyKey = (ply: number): string =>
  `p${String(ply)} ${ply % 2 === 0 ? 'w' : 'b'} - -`;

/**
 * One chapter of a White repertoire: a single line of 240 half-moves, so it
 * holds 120 White moves. Counting reads only keys and the side to move, so
 * the positions are made up rather than played, which keeps the test fast.
 */
function longLine(): RepertoireGraph {
  const plies = 240;
  return {
    side: 'white',
    chapters: [
      {
        id: 'c1',
        rootKey: plyKey(0),
        intro: null,
        nameSource: { kind: 'index', number: 1 },
      },
    ],
    moves: Array.from({ length: plies }, (_, ply) => ({
      from: plyKey(ply),
      to: plyKey(ply + 1),
      san: `m${String(ply)}`,
      uci: 'a1a2',
      arrows: [],
      circles: [],
      comment: null,
      chapters: ['c1'],
    })),
  };
}

describe('allowance', () => {
  it('is the new moves a day less the moves learned today', () => {
    expect(allowance(day({ learnedToday: 3 }))).toBe(7);
  });

  it('is never below zero', () => {
    expect(allowance(day({ learnedToday: 12 }))).toBe(0);
    expect(
      allowance(
        day({ limits: { reviews: 20, newPerDay: 0 }, learnedToday: 0 }),
      ),
    ).toBe(0);
  });
});

describe('dueCount', () => {
  it('counts the Reviews due at now, not those due later nor new moves', () => {
    const d = day(reviewed(reviewIn(E4, -DAY_MS), reviewIn(NF3, 1)));
    expect(dueCount(d, NOW)).toBe(1);
  });

  it('counts a Review due exactly now', () => {
    const d = day(reviewed(reviewIn(E4, 0)));
    expect(dueCount(d, NOW)).toBe(1);
    expect(dueCount(d, new Date(NOW.getTime() - 1))).toBe(0);
  });

  it('counts a key held by two repertoires once', () => {
    const d = day({
      repertoires: [repertoire(white, 'a'), repertoire(white, 'b')],
      ...reviewed(reviewIn(E4, -1)),
    });
    expect(dueCount(d, NOW)).toBe(1);
  });

  it('ignores paused repertoires and Reviews no active repertoire holds', () => {
    const d = day({
      repertoires: [
        repertoire(white, 'r1', false),
        repertoire(transposing, 'r2'),
      ],
      ...reviewed(reviewIn(E4, -1), reviewIn(BLACK_KEYS[0] ?? '', -1)),
    });
    expect(dueCount(d, NOW)).toBe(0);
  });

  it('is not capped at the largest session size', () => {
    const big = longLine();
    const keys = new Set(playerKeys(big));
    expect(keys.size).toBeGreaterThan(100);
    const d = day({
      repertoires: [repertoire(big)],
      limits: { reviews: 100, newPerDay: 10 },
      ...reviewed(...[...keys].map((k) => reviewIn(k, -1))),
    });
    expect(dueCount(d, NOW)).toBe(keys.size);
  });

  it("equals buildQueue's review count when they fit in a session", () => {
    const graphs = [white, black, transposing];
    const allKeys = [...new Set(graphs.flatMap(playerKeys))];
    expect(() => {
      fc.assert(
        fc.property(
          fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
          fc.array(fc.option(fc.integer({ min: -3, max: 3 })), {
            minLength: allKeys.length,
            maxLength: allKeys.length,
          }),
          (active, offsets) => {
            const repertoires = graphs.map((g, i) =>
              repertoire(g, `r${String(i)}`, active[i] ?? false),
            );
            const reviews = new Map<string, ReviewState>();
            allKeys.forEach((k, i) => {
              const days = offsets[i];
              if (days !== null && days !== undefined)
                reviews.set(k, reviewIn(k, days * DAY_MS));
            });
            const q = buildQueue(
              { repertoires, reviews, learnedToday: 0 },
              NOW,
              { reviews: 100, newPerDay: 0 },
            );
            return (
              q.ok &&
              dueCount({ repertoires, reviews }, NOW) === q.value.reviews.length
            );
          },
        ),
      );
    }).not.toThrow();
  });
});

describe('dueReviews', () => {
  it('holds the due Reviews, the earliest due first, up to the session size', () => {
    const keys = [...playerKeys(white), ...playerKeys(transposing)];
    const d = day({
      repertoires: [repertoire(white, 'w'), repertoire(transposing, 't')],
      limits: { reviews: 10, newPerDay: 10 },
      ...reviewed(...keys.map((k, i) => reviewIn(k, -(i + 1) * 1000))),
    });
    const due = dueReviews(d, NOW);
    expect(due).toHaveLength(7);
    expect(due[0]?.key).toBe(keys.at(-1));
    expect(due.at(-1)?.key).toBe(E4);
  });

  it('cuts at the session size', () => {
    const big = graph(
      '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 7. Rc1 c6 8. Bd3 dxc4 9. Bxc4 Nd5 10. Bxe7 Qxe7 11. O-O Nxc3 12. Rxc3 e5 *',
      'white',
    );
    const keys = playerKeys(big);
    expect(keys.length).toBeGreaterThan(10);
    const d = day({
      repertoires: [repertoire(big)],
      limits: { reviews: 10, newPerDay: 10 },
      ...reviewed(...keys.map((k) => reviewIn(k, -1))),
    });
    expect(dueReviews(d, NOW)).toHaveLength(10);
  });

  it('reads the Reviews it is given, such as a drill graded copy', () => {
    const d = day(reviewed(reviewIn(E4, -1)));
    expect(dueReviews(d, NOW).map((i) => i.key)).toEqual([E4]);
    const graded = { ...d, reviews: new Map([[E4, reviewIn(E4, DAY_MS)]]) };
    expect(dueReviews(graded, NOW)).toEqual([]);
  });

  it('throws on limits out of range: the settings were parsed already', () => {
    expect(() =>
      dueReviews(day({ limits: { reviews: 5, newPerDay: 10 } }), NOW),
    ).toThrow('training limits: reviews');
  });
});

describe('nextDue', () => {
  it('is the earliest Review due after now', () => {
    const d = day(reviewed(reviewIn(E4, 3 * DAY_MS), reviewIn(NF3, DAY_MS)));
    expect(nextDue(d, NOW)).toEqual(new Date(NOW.getTime() + DAY_MS));
  });

  it('skips the Reviews due now', () => {
    const d = day(
      reviewed(reviewIn(E4, 0), reviewIn(NF3, -1), reviewIn(BC4, 5)),
    );
    expect(nextDue(d, NOW)).toEqual(new Date(NOW.getTime() + 5));
  });

  it('is null without a Review due later', () => {
    expect(nextDue(day(), NOW)).toBeNull();
    expect(nextDue(day(reviewed(reviewIn(E4, -1))), NOW)).toBeNull();
  });

  it('leaves out paused repertoires and Reviews no repertoire holds', () => {
    const d = day({
      repertoires: [repertoire(white), repertoire(black, 'b', false)],
      ...reviewed(reviewIn(BLACK_KEYS[0] ?? '', 1), reviewIn('x b - - e5', 2)),
    });
    expect(nextDue(d, NOW)).toBeNull();
  });
});

describe('trainingProgress', () => {
  it('splits the held own moves into learned, due and to learn', () => {
    const d = day(
      reviewed(reviewIn(E4, -1), reviewIn(NF3, 0), reviewIn(BC4, DAY_MS)),
    );
    expect(trainingProgress(d, NOW)).toEqual({
      reviewed: 3,
      due: 2,
      toLearn: 1,
      nextDue: new Date(NOW.getTime() + DAY_MS),
    });
  });

  it('counts a transposed move once and leaves paused repertoires out', () => {
    expect(playerKeys(transposed)).toContain(NC3);
    const d = day({
      repertoires: [
        repertoire(transposing, 'a'),
        repertoire(transposed, 'b'),
        repertoire(white, 'w', false),
      ],
      ...reviewed(reviewIn(NC3, -1), reviewIn(E4, -1)),
    });
    expect(trainingProgress(d, NOW)).toEqual({
      reviewed: 1,
      due: 1,
      toLearn: 4,
      nextDue: null,
    });
  });
});

describe('learnLines and newKeys', () => {
  it('plans new moves up to what is left of the allowance, never a learned one', () => {
    const d = day({
      ...reviewed(reviewIn(E4, DAY_MS)),
      limits: { reviews: 20, newPerDay: 3 },
      learnedToday: 1,
    });
    expect(newKeys(learnLines(d))).toEqual([NF3, BC4]);
  });

  it('plans nothing once the allowance is used', () => {
    expect(learnLines(day({ learnedToday: 10 }))).toEqual([]);
  });

  it('plans only the active repertoires', () => {
    const d = day({
      repertoires: [repertoire(white, 'w', false), repertoire(black, 'b')],
    });
    expect(newKeys(learnLines(d))).toEqual(BLACK_KEYS);
  });
});

describe('trainingCounts', () => {
  it('is every due Review and the new moves the allowance allows', () => {
    const d = day({
      ...reviewed(reviewIn(E4, -1), reviewIn(NF3, -1)),
      limits: { reviews: 10, newPerDay: 1 },
    });
    expect(trainingCounts(d, NOW)).toEqual({ due: 2, toLearn: 1 });
  });
});

describe('toLearnCount', () => {
  it('is the new moves a learn session would teach now', () => {
    expect(toLearnCount(day())).toBe(4);
    expect(toLearnCount(day({ learnedToday: 8 }))).toBe(2);
    expect(toLearnCount(day(reviewed(reviewIn(E4, DAY_MS))))).toBe(3);
    expect(toLearnCount(day({ learnedToday: 10 }))).toBe(0);
  });
});

describe('startState', () => {
  it('is no moves when no repertoire holds a move of the player side', () => {
    const empty = graph('1. e4 *', 'black');
    expect(
      startState(day({ repertoires: [repertoire(empty)] }), 'review', NOW),
    ).toEqual({
      kind: 'noMoves',
    });
    expect(startState(day({ repertoires: [] }), 'learn', NOW)).toEqual({
      kind: 'noMoves',
    });
  });

  it('counts a paused repertoire as holding moves', () => {
    const d = day({ repertoires: [repertoire(white, 'r1', false)] });
    expect(startState(d, 'review', NOW)).toEqual({
      kind: 'nothingDue',
      toLearn: 0,
    });
    expect(startState(d, 'learn', NOW)).toEqual({ kind: 'nothingLeft' });
  });

  it('reviews when a Review is due', () => {
    expect(startState(day(reviewed(reviewIn(E4, 0))), 'review', NOW)).toEqual({
      kind: 'drill',
    });
  });

  it('is nothing due, with the new moves the allowance leaves', () => {
    const d = day({
      ...reviewed(reviewIn(E4, DAY_MS)),
      limits: { reviews: 20, newPerDay: 3 },
      learnedToday: 1,
    });
    expect(startState(d, 'review', NOW)).toEqual({
      kind: 'nothingDue',
      toLearn: 2,
    });
  });

  it('learns while new moves and allowance are left', () => {
    expect(startState(day(), 'learn', NOW)).toEqual({ kind: 'drill' });
  });

  it('is limit reached when moves are left but the allowance is used', () => {
    expect(startState(day({ learnedToday: 10 }), 'learn', NOW)).toEqual({
      kind: 'limitReached',
    });
  });

  it('is nothing left when every active own move is learned', () => {
    const d = day(
      reviewed(...[E4, NF3, BC4, C3].map((k) => reviewIn(k, DAY_MS))),
    );
    expect(startState(d, 'learn', NOW)).toEqual({ kind: 'nothingLeft' });
  });

  it('is nothing due with nothing to learn once today’s allowance is used', () => {
    expect(startState(day({ learnedToday: 12 }), 'review', NOW)).toEqual({
      kind: 'nothingDue',
      toLearn: 0,
    });
  });
});

/**
 * `white` plus an own move no chapter reaches: it has no chapter, so no
 * chapter walk leads to it. Training never offers it, so it is not held.
 */
const withOrphan: RepertoireGraph = {
  ...white,
  moves: [
    ...white.moves,
    {
      from: 'orphan w - -',
      to: 'orphan b - -',
      san: 'e4',
      uci: 'e2e4',
      arrows: [],
      circles: [],
      comment: null,
      chapters: [],
    },
  ],
};

describe('held moves: one definition, the chapter walks', () => {
  const orphanKey =
    playerKeys(withOrphan).find((k) => !playerKeys(white).includes(k)) ?? '';

  it('the fixture move is an own move only the graph list holds', () => {
    expect(orphanKey).not.toBe('');
  });

  it('counts, schedules and offers only walked moves', () => {
    const d = day({
      repertoires: [repertoire(withOrphan)],
      ...reviewed(reviewIn(orphanKey, -1), reviewIn(E4, DAY_MS)),
    });
    expect(dueCount(d, NOW)).toBe(0);
    expect(dueReviews(d, NOW)).toEqual([]);
    expect(trainingProgress(d, NOW)).toEqual({
      reviewed: 1,
      due: 0,
      toLearn: 3,
      nextDue: new Date(NOW.getTime() + DAY_MS),
    });
    expect(
      nextDue(
        { ...d, reviews: new Map([[orphanKey, reviewIn(orphanKey, 5)]]) },
        NOW,
      ),
    ).toBeNull();
  });

  it('has nothing left to learn when every walked move is learned', () => {
    const d = day({
      repertoires: [repertoire(withOrphan)],
      ...reviewed(...[E4, NF3, BC4, C3].map((k) => reviewIn(k, DAY_MS))),
    });
    expect(startState(d, 'learn', NOW)).toEqual({ kind: 'nothingLeft' });
  });

  it('is no moves when only an unreached move is held', () => {
    const only: RepertoireGraph = {
      ...withOrphan,
      moves: withOrphan.moves.filter((m) => m.chapters.length === 0),
    };
    expect(
      startState(day({ repertoires: [repertoire(only)] }), 'review', NOW),
    ).toEqual({
      kind: 'noMoves',
    });
  });
});
