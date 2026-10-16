import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fenOf, positionKey } from '../position-key';
import {
  isPlayerMove,
  lines,
  mainLine,
  moveKey,
  playerKeys,
  type RepertoireGraph,
} from './graph';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

const START = positionKey(
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
);
const AFTER_E4 = positionKey(
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
);
const AFTER_E5 = positionKey(
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
);
const AFTER_C5 = positionKey(
  'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
);

const move = (from: string, to: string, san: string, uci: string) => ({
  from,
  to,
  san,
  uci,
  arrows: [],
  circles: [],
  chapters: ['c1'],
});

const graph: RepertoireGraph = {
  side: 'white',
  chapters: [
    {
      id: 'c1',
      rootKey: START,
      intro: null,
      nameSource: { kind: 'index', number: 1 },
    },
  ],
  moves: [
    move(START, AFTER_E4, 'e4', 'e2e4'),
    move(AFTER_E4, AFTER_E5, 'e5', 'e7e5'),
    move(AFTER_E4, AFTER_C5, 'c5', 'c7c5'),
  ],
};

describe('repertoire graph', () => {
  it('keys a move by its position and SAN', () => {
    expect(moveKey(START, 'e4')).toBe(`${START}|e4`);
  });

  it('turns a position key into a FEN chess.js accepts', () => {
    expect(fenOf(START)).toBe(`${START} 0 1`);
  });

  it("knows which moves are the player's", () => {
    expect(isPlayerMove(graph, must(graph.moves[0]))).toBe(true);
    expect(isPlayerMove(graph, must(graph.moves[1]))).toBe(false);
    expect(
      isPlayerMove({ ...graph, side: 'black' }, must(graph.moves[1])),
    ).toBe(true);
  });

  it("lists the review keys of the player's moves only", () => {
    expect(playerKeys(graph)).toEqual([moveKey(START, 'e4')]);
  });

  it('enumerates every start-to-leaf line of a chapter', () => {
    expect(lines(graph, 'c1').map((l) => l.map((m) => m.san))).toEqual([
      ['e4', 'e5'],
      ['e4', 'c5'],
    ]);
  });

  it('takes the first-inserted child for the main line', () => {
    expect(mainLine(graph, 'c1').map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('returns no lines for an unknown chapter', () => {
    expect(lines(graph, 'nope')).toEqual([]);
    expect(mainLine(graph, 'nope')).toEqual([]);
  });
});

/** A synthetic chapter over abstract positions; mainLine never reads a key. */
const synthetic = (
  edges: readonly (readonly [number, number, string])[],
  chapterOfEdge: (index: number) => string = () => 'c1',
): RepertoireGraph => ({
  side: 'white',
  chapters: ['c1', 'c2'].map((id) => ({
    id,
    rootKey: 'p0',
    intro: null,
    nameSource: { kind: 'index', number: 1 },
  })),
  moves: edges.map(([from, to, san], i) => ({
    ...move(`p${String(from)}`, `p${String(to)}`, san, san),
    chapters: [chapterOfEdge(i)],
  })),
});

describe('mainLine', () => {
  it('walks a heavily transposing chapter without enumerating its lines', () => {
    // Two moves lead from each position to the next: 2^40 lines, one main line.
    const edges = Array.from({ length: 40 }, (_, i) => [
      [i, i + 1, `a${String(i)}`] as const,
      [i, i + 1, `b${String(i)}`] as const,
    ]).flat();
    const main = mainLine(synthetic(edges), 'c1');
    expect(main.map((m) => m.san)).toEqual(
      Array.from({ length: 40 }, (_, i) => `a${String(i)}`),
    );
  }, 1000);

  it('skips a child of another chapter and a move back onto the line', () => {
    const g = synthetic(
      [
        [0, 1, 'x'],
        [0, 2, 'y'],
        [2, 0, 'back'],
        [2, 3, 'z'],
      ],
      (i) => (i === 0 ? 'c2' : 'c1'),
    );
    expect(mainLine(g, 'c1').map((m) => m.san)).toEqual(['y', 'z']);
  });

  it('has no lines and an empty main line for a chapter without moves', () => {
    const g = synthetic([[0, 1, 'x']]);
    expect(lines(g, 'c2')).toEqual([]);
    expect(mainLine(g, 'c2')).toEqual([]);
  });

  it('stops at a repetition when no other child is left', () => {
    const g = synthetic([
      [0, 1, 'x'],
      [1, 0, 'back'],
    ]);
    expect(mainLine(g, 'c1').map((m) => m.san)).toEqual(['x']);
  });

  it('is the first line on random small graphs', () => {
    const edge = fc.tuple(fc.nat(5), fc.nat(5), fc.boolean());
    expect(() => {
      fc.assert(
        fc.property(fc.array(edge, { maxLength: 14 }), (raw) => {
          const g = synthetic(
            raw.map(([from, to], i) => [from, to, `m${String(i)}`] as const),
            (i) => (raw[i]?.[2] === true ? 'c2' : 'c1'),
          );
          return ['c1', 'c2'].every(
            (id) =>
              JSON.stringify(mainLine(g, id)) ===
              JSON.stringify(lines(g, id)[0] ?? []),
          );
        }),
      );
    }).not.toThrow();
  });
});
