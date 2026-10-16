import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import type { RepertoireGraph, RepertoireMove } from './graph';
import { chapterWalks, lines, mainLine, type WalkedMove } from './walk';

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
const AFTER_NF3 = positionKey(
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
);

const move = (
  from: string,
  to: string,
  san: string,
  chapters: readonly string[] = ['c1'],
): RepertoireMove => ({
  from,
  to,
  san,
  uci: '',
  arrows: [],
  circles: [],
  chapters,
});

const chapter = (id: string, rootKey: string) => ({
  id,
  rootKey,
  intro: null,
  nameSource: { kind: 'index', number: 1 } as const,
});

/** 1. e4 e5 (1... c5) 2. Nf3, in insertion order e4, e5, c5, Nf3. */
const italian: RepertoireGraph = {
  side: 'white',
  chapters: [chapter('c1', START)],
  moves: [
    move(START, AFTER_E4, 'e4'),
    move(AFTER_E4, AFTER_E5, 'e5'),
    move(AFTER_E4, AFTER_C5, 'c5'),
    move(AFTER_E5, AFTER_NF3, 'Nf3'),
  ],
};

/**
 * A chapter over abstract positions `p0`, `p1`, ...; `p0` is the root of
 * both chapters. The walks never read a position key, so any edges will do.
 */
const synthetic = (
  edges: readonly (readonly [number, number, string])[],
  chapterOfEdge: (index: number) => string = () => 'c1',
): RepertoireGraph => ({
  side: 'white',
  chapters: [chapter('c1', 'p0'), chapter('c2', 'p0')],
  moves: edges.map(([from, to, san], i) =>
    move(`p${String(from)}`, `p${String(to)}`, san, [chapterOfEdge(i)]),
  ),
});

/** Two moves lead from each position to the next: 2^40 lines. */
const diamond = synthetic(
  Array.from({ length: 40 }, (_, i) => [
    [i, i + 1, `a${String(i)}`] as const,
    [i, i + 1, `b${String(i)}`] as const,
  ]).flat(),
);

const sans = (moves: readonly RepertoireMove[]) => moves.map((m) => m.san);
const sansOfLines = (all: readonly (readonly RepertoireMove[])[]) =>
  all.map(sans);

/** A walk tree as nested SANs: `[san, next]`. */
type Shape = readonly [string, readonly Shape[]];
const shape = (walked: readonly WalkedMove[]): Shape[] =>
  walked.map((w) => [w.move.san, shape(w.next)]);

const flatten = (walked: readonly WalkedMove[]): RepertoireMove[] =>
  walked.flatMap((w) => [w.move, ...flatten(w.next)]);

const walkOf = (graph: RepertoireGraph, chapterId = 'c1') =>
  chapterWalks(graph)(chapterId);

describe('lines', () => {
  it('enumerates every start-to-leaf line, children in insertion order', () => {
    expect(sansOfLines(lines(italian, 'c1'))).toEqual([
      ['e4', 'e5', 'Nf3'],
      ['e4', 'c5'],
    ]);
  });

  it('has no lines for an unknown chapter or a chapter without moves', () => {
    expect(lines(italian, 'nope')).toEqual([]);
    expect(lines(synthetic([[0, 1, 'x']]), 'c2')).toEqual([]);
  });

  it('leaves out the moves of other chapters', () => {
    const g = synthetic(
      [
        [0, 1, 'x'],
        [0, 2, 'y'],
        [2, 3, 'z'],
      ],
      (i) => (i === 2 ? 'c2' : 'c1'),
    );
    expect(sansOfLines(lines(g, 'c1'))).toEqual([['x'], ['y']]);
  });

  it('ends a line with the move that returns to a position already on it', () => {
    const g = synthetic([
      [0, 1, 'x'],
      [1, 0, 'back'],
      [1, 2, 'y'],
    ]);
    expect(sansOfLines(lines(g, 'c1'))).toEqual([
      ['x', 'back'],
      ['x', 'y'],
    ]);
  });

  it('walks each move order of a transposition as its own line', () => {
    const g = synthetic([
      [0, 1, 'a'],
      [0, 1, 'b'],
      [1, 2, 'c'],
    ]);
    expect(sansOfLines(lines(g, 'c1'))).toEqual([
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });
});

describe('mainLine', () => {
  it('takes the first-inserted child at each position', () => {
    expect(sans(mainLine(italian, 'c1'))).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('is empty for an unknown chapter or a chapter without moves', () => {
    expect(mainLine(italian, 'nope')).toEqual([]);
    expect(mainLine(synthetic([[0, 1, 'x']]), 'c2')).toEqual([]);
  });

  it('walks a heavily transposing chapter without enumerating its lines', () => {
    expect(sans(mainLine(diamond, 'c1'))).toEqual(
      Array.from({ length: 40 }, (_, i) => `a${String(i)}`),
    );
  }, 1000);

  it('skips a child of another chapter', () => {
    const g = synthetic(
      [
        [0, 1, 'x'],
        [0, 2, 'y'],
        [2, 3, 'z'],
      ],
      (i) => (i === 0 ? 'c2' : 'c1'),
    );
    expect(sans(mainLine(g, 'c1'))).toEqual(['y', 'z']);
  });

  it('ends with a first child that returns onto the line', () => {
    const g = synthetic([
      [0, 2, 'y'],
      [2, 0, 'back'],
      [2, 3, 'z'],
    ]);
    expect(sans(mainLine(g, 'c1'))).toEqual(['y', 'back']);
  });
});

describe('the walk that takes each move once', () => {
  it('is depth first, children in insertion order', () => {
    const walk = walkOf(italian);
    expect(sans(walk.moves())).toEqual(['e4', 'e5', 'Nf3', 'c5']);
    expect(shape(walk.tree())).toEqual([
      [
        'e4',
        [
          ['e5', [['Nf3', []]]],
          ['c5', []],
        ],
      ],
    ]);
  });

  it('gives a move into a position already walked no continuation', () => {
    const g = synthetic([
      [0, 1, 'a'],
      [0, 1, 'b'],
      [1, 2, 'c'],
    ]);
    expect(shape(walkOf(g).tree())).toEqual([
      ['a', [['c', []]]],
      ['b', []],
    ]);
    expect(sans(walkOf(g).moves())).toEqual(['a', 'c', 'b']);
  });

  it('keeps a move back onto the path, without continuing from it', () => {
    const g = synthetic([
      [0, 1, 'x'],
      [1, 0, 'back'],
    ]);
    expect(shape(walkOf(g).tree())).toEqual([['x', [['back', []]]]]);
  });

  it('is empty for an unknown chapter', () => {
    expect(walkOf(italian, 'nope').moves()).toEqual([]);
    expect(walkOf(italian, 'nope').tree()).toEqual([]);
  });

  it('takes a heavily transposing chapter in its size, not its lines', () => {
    const walk = walkOf(diamond);
    expect(walk.moves()).toHaveLength(80);
    expect(flatten(walk.tree())).toHaveLength(80);
  }, 1000);
});

/** The chapter's moves its root reaches, found breadth first. */
function reachable(graph: RepertoireGraph, chapterId: string): Set<string> {
  const moves = graph.moves.filter((m) => m.chapters.includes(chapterId));
  const seen = new Set(['p0']);
  const out = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const m of moves) {
      if (seen.has(m.from) && !out.has(m.san)) {
        out.add(m.san);
        seen.add(m.to);
        grew = true;
      }
    }
  }
  return out;
}

/** Whether a line repeats no position, but for its last move landing on it. */
function endsRightly(graph: RepertoireGraph, line: readonly RepertoireMove[]) {
  const positions = ['p0', ...line.map((m) => m.to)];
  const last = line.at(-1);
  if (last === undefined) return false;
  const repeated = positions.slice(0, -1).includes(last.to);
  const leaf = !graph.moves.some(
    (m) =>
      m.from === last.to && m.chapters.some((c) => last.chapters.includes(c)),
  );
  return (
    new Set(positions.slice(0, -1)).size === positions.length - 1 &&
    (repeated || leaf)
  );
}

describe('the walks agree on random small graphs', () => {
  const edge = fc.tuple(fc.nat(5), fc.nat(5), fc.boolean());
  const graphs = fc.array(edge, { maxLength: 12 }).map((raw) =>
    synthetic(
      raw.map(([from, to], i) => [from, to, `m${String(i)}`] as const),
      (i) => (raw[i]?.[2] === true ? 'c2' : 'c1'),
    ),
  );
  /** Asserts `check` for both chapters of random graphs; throws on a counterexample. */
  const forBoth =
    (check: (g: RepertoireGraph, id: string) => boolean) => (): void => {
      fc.assert(
        fc.property(graphs, (g) => ['c1', 'c2'].every((id) => check(g, id))),
      );
    };

  it('the main line is the first line', () => {
    expect(
      forBoth(
        (g, id) =>
          JSON.stringify(mainLine(g, id)) ===
          JSON.stringify(lines(g, id)[0] ?? []),
      ),
    ).not.toThrow();
  });

  it('takes every move the root reaches exactly once, in tree order', () => {
    expect(
      forBoth((g, id) => {
        const walk = walkOf(g, id);
        const moves = sans(walk.moves());
        return (
          JSON.stringify(moves) ===
            JSON.stringify(sans(flatten(walk.tree()))) &&
          new Set(moves).size === moves.length &&
          JSON.stringify([...moves].sort()) ===
            JSON.stringify([...reachable(g, id)].sort())
        );
      }),
    ).not.toThrow();
  });

  it('the lines cover every move the chapter reaches, and only those', () => {
    expect(
      forBoth((g, id) => {
        const inLines = new Set(sans(lines(g, id).flat()));
        return (
          JSON.stringify([...inLines].sort()) ===
          JSON.stringify([...reachable(g, id)].sort())
        );
      }),
    ).not.toThrow();
  });

  it('each line ends at a leaf or on a move back onto it', () => {
    expect(
      forBoth((g, id) => lines(g, id).every((line) => endsRightly(g, line))),
    ).not.toThrow();
  });
});
