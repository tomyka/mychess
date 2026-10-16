import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { importPgn } from '../pgn/import-pgn';
import {
  isPlayerMove,
  lines,
  moveKey,
  playerKeys,
  type RepertoireGraph,
  type Side,
} from '../repertoire/graph';
import { buildQueue, QUEUE_LIMITS, type QueueInput } from './queue';
import { startReview, type ReviewCard } from './schedule';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const DAY = 86_400_000;
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
  cards: ReadonlyMap<string, ReviewCard> = new Map(),
  learnedToday = 0,
): QueueInput => ({ repertoires, cards, learnedToday });

/** A card for `key` whose first review fell due `daysAgo` days before now. */
const dueCard = (key: string, daysAgo: number): ReviewCard =>
  startReview(key, new Date(now.getTime() - (daysAgo + 1) * DAY));

describe('buildQueue', () => {
  it('offers the player moves without a card as new moves, in line order', () => {
    const q = buildQueue(
      input([{ id: 'r1', graph: white, paused: false }]),
      now,
    );
    expect(q.newMoves.map((i) => i.san)).toEqual(['e4', 'Nf3', 'Bc4']);
    expect(q.reviews).toEqual([]);
  });

  it('describes each item by key, repertoire, position and move', () => {
    const q = buildQueue(
      input([{ id: 'r1', graph: white, paused: false }]),
      now,
    );
    const first = must(white.moves[0]);
    expect(q.newMoves[0]).toEqual({
      key: moveKey(first.from, 'e4'),
      repertoireId: 'r1',
      fromKey: first.from,
      san: 'e4',
    });
  });

  it('offers due cards as reviews, tagged with their repertoire', () => {
    const key = moveKey(must(white.moves[0]).from, 'e4');
    const card = startReview(key, new Date(now.getTime() - 2 * DAY));
    const q = buildQueue(
      input(
        [{ id: 'r1', graph: white, paused: false }],
        new Map([[key, card]]),
      ),
      now,
    );
    expect(q.reviews).toEqual([
      expect.objectContaining({ key, repertoireId: 'r1', san: 'e4' }),
    ]);
    expect(q.newMoves.map((i) => i.san)).toEqual(['Nf3', 'Bc4']);
  });

  it('offers a card due exactly now, but not one due later', () => {
    const [e4, nf3] = playerKeys(white).map(must);
    const cards = new Map([
      [must(e4), startReview(must(e4), new Date(now.getTime() - DAY))],
      [must(nf3), startReview(must(nf3), now)],
    ]);
    const q = buildQueue(
      input([{ id: 'r1', graph: white, paused: false }], cards),
      now,
    );
    expect(q.reviews.map((i) => i.san)).toEqual(['e4']);
    expect(q.newMoves.map((i) => i.san)).toEqual(['Bc4']);
  });

  it('orders reviews by due date and caps them', () => {
    const keys = playerKeys(wide);
    expect(keys).toHaveLength(QUEUE_LIMITS.reviews + 1);
    // The later a move comes in the graph, the longer it has been due.
    const cards = new Map(keys.map((k, i) => [k, dueCard(k, i + 1)]));
    const q = buildQueue(
      input([{ id: 'r1', graph: wide, paused: false }], cards),
      now,
    );
    expect(q.reviews.map((i) => i.key)).toEqual(
      [...keys].reverse().slice(0, QUEUE_LIMITS.reviews),
    );
  });

  it('caps new moves at the daily allowance, in line order', () => {
    const q = buildQueue(
      input([{ id: 'r1', graph: wide, paused: false }]),
      now,
    );
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

  it('skips paused repertoires', () => {
    const q = buildQueue(
      input([
        { id: 'r1', graph: white, paused: true },
        { id: 'r2', graph: black, paused: false },
      ]),
      now,
    );
    expect(q.newMoves.map((i) => i.repertoireId)).toEqual(['r2', 'r2']);
  });

  it('subtracts moves already learned today from the new-move allowance', () => {
    const q = buildQueue(
      input(
        [{ id: 'r1', graph: white, paused: false }],
        new Map(),
        QUEUE_LIMITS.newPerDay - 1,
      ),
      now,
    );
    expect(q.newMoves).toHaveLength(1);
  });

  it('shows the same review key once even if two repertoires hold it', () => {
    const q = buildQueue(
      input([
        { id: 'a', graph: white, paused: false },
        { id: 'b', graph: white, paused: false },
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
    const q = buildQueue(
      input([{ id: 'r1', graph: twoChapters, paused: false }]),
      now,
    );
    expect(q.newMoves.map((i) => i.san)).toEqual(['e4', 'Nf3', 'Nf3']);
    expect(new Set(q.newMoves.map((i) => i.key)).size).toBe(3);
  });

  it('offers a player move that returns to an earlier position', () => {
    const back = graph('1. Nf3 Nf6 2. Ng1 Ng8 *', 'black');
    const q = buildQueue(
      input([{ id: 'r1', graph: back, paused: false }]),
      now,
    );
    expect(q.newMoves.map((i) => i.san)).toEqual(['Nf6', 'Ng8']);
  });

  it('keeps answers from different sides apart', () => {
    const q = buildQueue(
      input([
        { id: 'w', graph: white, paused: false },
        { id: 'b', graph: black, paused: false },
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
    // from each to the next, so the chapter has 2^40 lines.
    const at = (i: number) => `p${String(i)} ${i % 2 === 0 ? 'w' : 'b'}`;
    const moves = Array.from({ length: 40 }, (_, i) =>
      ['a', 'b'].map((letter) => ({
        from: at(i),
        to: at(i + 1),
        san: `${letter}${String(i)}`,
        uci: '',
        arrows: [],
        circles: [],
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
    // Every player move but the deepest second choice has a card not yet due.
    const deepest = moveKey(at(38), 'b38');
    const cards = new Map(
      keys
        .filter((k) => k !== deepest)
        .map((k) => [k, startReview(k, now)] as const),
    );
    const q = buildQueue(
      input([{ id: 'r1', graph: diamond, paused: false }], cards),
      now,
    );
    expect(q.newMoves.map((i) => i.san)).toEqual(['b38']);
    expect(q.reviews).toEqual([]);
  }, 1000);

  it('never exceeds its limits', () => {
    expect(() => {
      fc.assert(
        fc.property(fc.nat(30), fc.nat(5), (learnedToday, daysAgo) => {
          const cards = new Map(
            playerKeys(wide)
              .slice(0, 12)
              .map((k) => [k, dueCard(k, daysAgo)]),
          );
          const q = buildQueue(
            input(
              [{ id: 'r1', graph: wide, paused: false }],
              cards,
              learnedToday,
            ),
            now,
          );
          return (
            q.newMoves.length <=
              Math.max(0, QUEUE_LIMITS.newPerDay - learnedToday) &&
            q.reviews.length <= QUEUE_LIMITS.reviews
          );
        }),
      );
    }).not.toThrow();
  });
});
