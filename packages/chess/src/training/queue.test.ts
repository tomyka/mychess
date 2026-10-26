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
import { lines } from '../repertoire/walk';
import {
  buildQueue,
  dueCount,
  QUEUE_LIMITS,
  type QueueInput,
  type QueueLimits,
} from './queue';
import {
  DAY_MS,
  grade,
  startReview,
  type Outcome,
  type ReviewState,
} from './schedule';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const now = new Date('2026-10-16T08:00:00Z');
function graph(pgn: string, side: Side): RepertoireGraph {
  const r = importPgn(pgn, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value.graph;
}
const white = graph('1. e4 e5 2. Nf3 Nc6 3. Bc4 *', 'white');
const black = graph('1. e4 c6 2. d4 d5 *', 'black');

// Black answers 1... Nf6 to each of White's twenty first moves, then 2... Nd5.
const FIRST_MOVES = [
  'd4',
  'c4',
  'Nf3',
  'Nc3',
  'a3',
  'a4',
  'b3',
  'b4',
  'c3',
  'd3',
  'e3',
  'f3',
  'f4',
  'g3',
  'g4',
  'h3',
  'h4',
  'Na3',
  'Nh3',
];
const wide = graph(
  `1. e4 ${FIRST_MOVES.map((m) => `(1. ${m} Nf6)`).join(' ')} 1... Nf6 2. e5 Nd5 *`,
  'black',
);

const input = (
  repertoires: QueueInput['repertoires'],
  reviews: ReadonlyMap<string, ReviewState> = new Map(),
  learnedToday = 0,
): QueueInput => ({ repertoires, reviews, learnedToday });

/** A Review for `key` whose first review fell due `daysAgo` days before now. */
const dueReview = (key: string, daysAgo: number): ReviewState =>
  startReview(key, new Date(now.getTime() - (daysAgo + 1) * DAY_MS));

/** The queue for limits that are valid; a refusal fails the test. */
function queueOf(queueInput: QueueInput, at: Date, limits?: QueueLimits) {
  const r = buildQueue(queueInput, at, limits);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

describe('queue limits (R-62)', () => {
  const keys = playerKeys(wide);
  const allDue = new Map(keys.map((k, i) => [k, dueReview(k, i + 1)]));
  const wideInput = (exclude?: ReadonlySet<string>): QueueInput => ({
    ...input([{ id: 'r1', graph: wide, active: true }], allDue),
    ...(exclude === undefined ? {} : { exclude }),
  });

  it('defaults to 20 reviews a session and 10 new moves a day', () => {
    expect(QUEUE_LIMITS).toEqual({ reviews: 20, newPerDay: 10 });
  });

  it('takes the session size and the daily new-move limit as input', () => {
    const q = queueOf(wideInput(), now, { reviews: 10, newPerDay: 3 });
    expect(q.reviews).toHaveLength(10);
    const fresh = queueOf(
      input([{ id: 'r1', graph: wide, active: true }]),
      now,
      { reviews: 10, newPerDay: 3 },
    );
    expect(fresh.newMoves).toHaveLength(3);
  });

  it('accepts a session size from 10 to 100', () => {
    for (const reviews of [10, 55, 100]) {
      expect(buildQueue(wideInput(), now, { reviews, newPerDay: 10 }).ok).toBe(
        true,
      );
    }
  });

  it('refuses a session size outside 10 to 100 or not whole', () => {
    for (const reviews of [9, 101, 0, -20, 20.5, Number.NaN]) {
      expect(buildQueue(wideInput(), now, { reviews, newPerDay: 10 })).toEqual({
        ok: false,
        refusal: { reason: 'queue.invalidLimit', limit: 'reviews' },
      });
    }
  });

  it('refuses a daily new-move limit that is negative or not whole', () => {
    for (const newPerDay of [-1, 2.5, Number.NaN]) {
      expect(buildQueue(wideInput(), now, { reviews: 20, newPerDay })).toEqual({
        ok: false,
        refusal: { reason: 'queue.invalidLimit', limit: 'newPerDay' },
      });
    }
    expect(
      queueOf(input([{ id: 'r1', graph: wide, active: true }]), now, {
        reviews: 20,
        newPerDay: 0,
      }).newMoves,
    ).toEqual([]);
  });

  /** The reviews after grading every key of `batch` with `outcome` at `at`. */
  const graded = (
    batch: readonly { readonly key: string }[],
    outcome: (key: string) => Outcome,
    at: Date,
  ): Map<string, ReviewState> => {
    const next = new Map(allDue);
    for (const { key } of batch) {
      next.set(key, grade(must(allDue.get(key)), outcome(key), at));
    }
    return next;
  };

  it('continues a session: graded reviews are no longer due, so the next batch holds other moves', () => {
    const first = queueOf(wideInput(), now);
    expect(first.reviews).toHaveLength(QUEUE_LIMITS.reviews);
    const seen = new Set(first.reviews.map((i) => i.key));
    const next = queueOf(
      {
        ...input(
          [{ id: 'r1', graph: wide, active: true }],
          graded(first.reviews, () => 'pass', now),
        ),
        exclude: seen,
      },
      now,
    );
    expect(next.reviews.map((i) => i.key)).toEqual(
      keys.filter((k) => !seen.has(k)),
    );
  });

  it('continues a session with a lapsed move once it is due again (R-78)', () => {
    const first = queueOf(wideInput(), now);
    const lapsed = must(first.reviews[0]).key;
    const reviews = graded(
      first.reviews,
      (key) => (key === lapsed ? 'lapse' : 'pass'),
      now,
    );
    const dueAgain = must(reviews.get(lapsed)).fsrs.due;
    expect(dueAgain.getTime() - now.getTime()).toBeLessThan(3_600_000);
    const next = queueOf(
      {
        ...input([{ id: 'r1', graph: wide, active: true }], reviews),
        exclude: new Set(first.reviews.map((i) => i.key)),
      },
      dueAgain,
    );
    expect(next.reviews.map((i) => i.key)).toContain(lapsed);
  });

  it('leaves a key shown for learning this session out of the new moves', () => {
    const [e4, ...rest] = playerKeys(white);
    const q = queueOf(
      {
        ...input([{ id: 'r1', graph: white, active: true }]),
        exclude: new Set([must(e4)]),
      },
      now,
    );
    expect(q.newMoves.map((i) => i.key)).toEqual(rest);
    expect(rest.map((k) => k.split('|')[1])).toEqual(['Nf3', 'Bc4']);
  });
});

describe('buildQueue', () => {
  it('offers the player moves without a Review as new moves, in line order', () => {
    const q = queueOf(input([{ id: 'r1', graph: white, active: true }]), now);
    expect(q.newMoves.map((i) => i.san)).toEqual(['e4', 'Nf3', 'Bc4']);
    expect(q.reviews).toEqual([]);
  });

  it('describes each item by key, repertoire, position and move', () => {
    const q = queueOf(input([{ id: 'r1', graph: white, active: true }]), now);
    const first = must(white.moves[0]);
    expect(q.newMoves[0]).toEqual({
      key: moveKey(first.from, 'e4'),
      repertoireId: 'r1',
      fromKey: first.from,
      san: 'e4',
    });
  });

  it('offers due Reviews, tagged with their repertoire', () => {
    const key = moveKey(must(white.moves[0]).from, 'e4');
    const review = startReview(key, new Date(now.getTime() - 2 * DAY_MS));
    const q = queueOf(
      input(
        [{ id: 'r1', graph: white, active: true }],
        new Map([[key, review]]),
      ),
      now,
    );
    expect(q.reviews).toEqual([
      expect.objectContaining({ key, repertoireId: 'r1', san: 'e4' }),
    ]);
    expect(q.newMoves.map((i) => i.san)).toEqual(['Nf3', 'Bc4']);
  });

  it('offers a Review due exactly now, but not one due later', () => {
    const [e4, nf3] = playerKeys(white).map(must);
    const reviews = new Map([
      [must(e4), startReview(must(e4), new Date(now.getTime() - DAY_MS))],
      [must(nf3), startReview(must(nf3), now)],
    ]);
    const q = queueOf(
      input([{ id: 'r1', graph: white, active: true }], reviews),
      now,
    );
    expect(q.reviews.map((i) => i.san)).toEqual(['e4']);
    expect(q.newMoves.map((i) => i.san)).toEqual(['Bc4']);
  });

  it('orders reviews by due date and caps them', () => {
    const keys = playerKeys(wide);
    expect(keys).toHaveLength(QUEUE_LIMITS.reviews + 1);
    // The later a move comes in the graph, the longer it has been due.
    const reviews = new Map(keys.map((k, i) => [k, dueReview(k, i + 1)]));
    const q = queueOf(
      input([{ id: 'r1', graph: wide, active: true }], reviews),
      now,
    );
    expect(q.reviews.map((i) => i.key)).toEqual(
      [...keys].reverse().slice(0, QUEUE_LIMITS.reviews),
    );
  });

  it('caps new moves at the daily allowance, in line order', () => {
    const q = queueOf(input([{ id: 'r1', graph: wide, active: true }]), now);
    const inLineOrder = [
      ...new Set(
        wide.chapters
          .flatMap((c) => lines(wide, c.id).flat())
          .filter((m) => isPlayerMove(wide, m))
          .map((m) => moveKey(m.from, m.san)),
      ),
    ];
    expect(inLineOrder.slice(0, 3).map((k) => k.split('|')[1])).toEqual([
      'Nf6',
      'Nd5',
      'Nf6',
    ]);
    expect(q.newMoves.map((i) => i.key)).toEqual(
      inLineOrder.slice(0, QUEUE_LIMITS.newPerDay),
    );
  });

  it('skips repertoires excluded from training (a paused assignment)', () => {
    const q = queueOf(
      input([
        { id: 'r1', graph: white, active: false },
        { id: 'r2', graph: black, active: true },
      ]),
      now,
    );
    expect(q.newMoves.map((i) => i.repertoireId)).toEqual(['r2', 'r2']);
  });

  it('subtracts moves already learned today from the new-move allowance', () => {
    const q = queueOf(
      input(
        [{ id: 'r1', graph: white, active: true }],
        new Map(),
        QUEUE_LIMITS.newPerDay - 1,
      ),
      now,
    );
    expect(q.newMoves).toHaveLength(1);
  });

  it('shows the same review key once even if two repertoires hold it', () => {
    const q = queueOf(
      input([
        { id: 'a', graph: white, active: true },
        { id: 'b', graph: white, active: true },
      ]),
      now,
    );
    expect(q.newMoves.map((i) => i.repertoireId)).toEqual(['a', 'a', 'a']);
  });

  it('takes a move shared by two chapters once', () => {
    const twoChapters = graph(
      '1. e4 e5 2. Nf3 *\n\n1. e4 c5 2. Nf3 *',
      'white',
    );
    const q = queueOf(
      input([{ id: 'r1', graph: twoChapters, active: true }]),
      now,
    );
    expect(q.newMoves.map((i) => i.san)).toEqual(['e4', 'Nf3', 'Nf3']);
    expect(new Set(q.newMoves.map((i) => i.key)).size).toBe(3);
  });

  it('offers a player move that returns to an earlier position', () => {
    const back = graph('1. Nf3 Nf6 2. Ng1 Ng8 *', 'black');
    const q = queueOf(input([{ id: 'r1', graph: back, active: true }]), now);
    expect(q.newMoves.map((i) => i.san)).toEqual(['Nf6', 'Ng8']);
  });

  it('keeps answers from different sides apart', () => {
    const q = queueOf(
      input([
        { id: 'w', graph: white, active: true },
        { id: 'b', graph: black, active: true },
      ]),
      now,
    );
    expect(q.newMoves.map((i) => `${i.repertoireId}:${i.san}`)).toEqual([
      'w:e4',
      'w:Nf3',
      'w:Bc4',
      'b:c6',
      'b:d5',
    ]);
  });

  it('walks a heavily transposing repertoire without enumerating its lines', () => {
    // Abstract positions, alternately White and Black to move; two moves lead
    // from each to the next, so the chapter has 2^40 lines: enumerating them
    // never finishes, so the timeout is only a sanity bound.
    const at = (i: number) => `p${String(i)} ${i % 2 === 0 ? 'w' : 'b'}`;
    const moves = Array.from({ length: 40 }, (_, i) =>
      ['a', 'b'].map((letter) => ({
        from: at(i),
        to: at(i + 1),
        san: `${letter}${String(i)}`,
        uci: '',
        arrows: [],
        circles: [],
        comment: null,
        chapters: ['c1'],
      })),
    ).flat();
    const diamond: RepertoireGraph = {
      side: 'white',
      chapters: [
        {
          id: 'c1',
          rootKey: at(0),
          intro: null,
          nameSource: { kind: 'index', number: 1 },
        },
      ],
      moves,
    };
    const keys = playerKeys(diamond);
    expect(keys).toHaveLength(40);
    // Every player move but the deepest second choice has a review not yet due.
    const deepest = moveKey(at(38), 'b38');
    const reviews = new Map(
      keys
        .filter((k) => k !== deepest)
        .map((k) => [k, startReview(k, now)] as const),
    );
    const q = queueOf(
      input([{ id: 'r1', graph: diamond, active: true }], reviews),
      now,
    );
    expect(q.newMoves.map((i) => i.san)).toEqual(['b38']);
    expect(q.reviews).toEqual([]);
  }, 60_000);

  it('fills up to its limits and never past them', () => {
    expect(() => {
      fc.assert(
        fc.property(
          fc.nat(30),
          fc.nat(5),
          fc.integer({ min: 10, max: 100 }),
          fc.nat(15),
          (learnedToday, daysAgo, sessionSize, newPerDay) => {
            const reviews = new Map(
              playerKeys(wide)
                .slice(0, 12)
                .map((k) => [k, dueReview(k, daysAgo)]),
            );
            const q = queueOf(
              input(
                [{ id: 'r1', graph: wide, active: true }],
                reviews,
                learnedToday,
              ),
              now,
              { reviews: sessionSize, newPerDay },
            );
            return (
              q.newMoves.length ===
                Math.max(0, Math.min(9, newPerDay - learnedToday)) &&
              q.reviews.length === Math.min(12, sessionSize)
            );
          },
        ),
      );
    }).not.toThrow();
  });
});

/** A made-up position key: the side to move alternates, starting with White. */
const plyKey = (ply: number): string =>
  `p${String(ply)} ${ply % 2 === 0 ? 'w' : 'b'} - -`;

/**
 * One chapter of a White repertoire: a single line of 240 half-moves, so it
 * holds 120 White moves. dueCount reads only keys and the side to move, so
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

describe('dueCount', () => {
  const [e4 = '', nf3 = ''] = playerKeys(white);
  const only = (g: RepertoireGraph, active = true) => [
    { id: 'r1', graph: g, active },
  ];

  it('counts the Reviews due at now, not those due later nor new moves', () => {
    const reviews = new Map([
      [e4, startReview(e4, new Date(now.getTime() - DAY_MS))],
      [nf3, startReview(nf3, now)],
    ]);
    expect(dueCount({ repertoires: only(white), reviews }, now)).toBe(1);
  });

  it('counts a Review due exactly now', () => {
    const reviews = new Map([[e4, startReview(e4, now)]]);
    const due = must(reviews.get(e4)).fsrs.due;
    expect(dueCount({ repertoires: only(white), reviews }, due)).toBe(1);
    expect(
      dueCount(
        { repertoires: only(white), reviews },
        new Date(due.getTime() - 1),
      ),
    ).toBe(0);
  });

  it('counts a key held by two repertoires once', () => {
    const reviews = new Map([[e4, dueReview(e4, 1)]]);
    const repertoires = [
      { id: 'a', graph: white, active: true },
      { id: 'b', graph: white, active: true },
    ];
    expect(dueCount({ repertoires, reviews }, now)).toBe(1);
  });

  it('ignores paused repertoires and Reviews no active repertoire holds', () => {
    const blackKey = must(playerKeys(black)[0]);
    const reviews = new Map([
      [e4, dueReview(e4, 1)],
      [blackKey, dueReview(blackKey, 1)],
    ]);
    const repertoires = [
      { id: 'r1', graph: white, active: false },
      { id: 'r2', graph: wide, active: true },
    ];
    expect(dueCount({ repertoires, reviews }, now)).toBe(0);
  });

  it('is not capped at the largest session size', () => {
    const big = longLine();
    const keys = new Set(playerKeys(big));
    expect(keys.size).toBeGreaterThan(100);
    const reviews = new Map([...keys].map((k) => [k, dueReview(k, 1)]));
    expect(dueCount({ repertoires: only(big), reviews }, now)).toBe(keys.size);
  });

  it("equals buildQueue's review count when they fit in a session", () => {
    const graphs = [white, black, wide];
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
            const repertoires = graphs.map((g, i) => ({
              id: `r${String(i)}`,
              graph: g,
              active: active[i] ?? false,
            }));
            const reviews = new Map<string, ReviewState>();
            allKeys.forEach((k, i) => {
              const days = offsets[i];
              if (days !== null && days !== undefined) {
                reviews.set(k, dueReview(k, days));
              }
            });
            const q = queueOf(input(repertoires, reviews), now, {
              reviews: 100,
              newPerDay: 0,
            });
            return dueCount({ repertoires, reviews }, now) === q.reviews.length;
          },
        ),
      );
    }).not.toThrow();
  });
});
