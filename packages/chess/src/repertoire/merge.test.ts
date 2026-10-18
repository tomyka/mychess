import { Chess } from 'chess.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  growth,
  imported,
  LINEAR_GROWTH,
  must,
  START,
} from '../pgn/test-support';
import {
  isPlayerMove,
  moveKey,
  type RepertoireGraph,
  type Side,
} from './graph';
import { mergeInto } from './merge';
import { chapterWalks, lines, mainLine } from './walk';

const graphOf = (text: string, side: Side = 'white') =>
  imported(text, side).graph;

function merged(existing: RepertoireGraph, text: string, side: Side = 'white') {
  const r = mergeInto(existing, imported(text, side));
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

const keysOf = (g: RepertoireGraph) =>
  new Set(g.moves.map((m) => moveKey(m.from, m.san)));

describe('mergeInto (R-101)', () => {
  it('adds the imported games as new chapters after the existing ones', () => {
    const existing = graphOf(
      '[Event "Italian"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 *',
      'black',
    );
    const { graph, skipped } = merged(
      existing,
      '[Event "Scotch"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 *',
      'black',
    );
    expect(skipped).toEqual([]);
    expect(graph.side).toBe('black');
    expect(graph.chapters.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(graph.chapters[0]).toBe(existing.chapters[0]);
    expect(lines(graph, 'c2').map((l) => l.map((m) => m.san))).toEqual([
      ['e4', 'e5', 'Nf3', 'Nc6', 'd4'],
    ]);
  });

  it('merges positions: a shared move is stored once and gains the new chapter', () => {
    const existing = graphOf('1. e4 e5 2. Nf3 *');
    const { graph } = merged(existing, '1. e4 e5 2. Nf3 Nc6 *');
    const e4 = must(graph.moves.find((m) => m.san === 'e4'));
    expect(e4.chapters).toEqual(['c1', 'c2']);
    expect(graph.moves).toHaveLength(4);
    expect(must(graph.moves.at(-1)).chapters).toEqual(['c2']);
  });

  it('merges a transposition into the existing position', () => {
    const existing = graphOf('1. d4 Nf6 2. c4 e6 *', 'black');
    const { graph } = merged(existing, '1. c4 e6 2. d4 Nf6 *', 'black');
    const keys = new Set(graph.moves.map((m) => m.to));
    expect(graph.moves).toHaveLength(8);
    expect(keys.size).toBe(7);
  });

  it('keeps the existing comment and marks, and fills in what the existing move lacks', () => {
    const existing = graphOf('1. e4 { Mine [%cal Gg1f3] } e5 Nf3 *');
    const { graph } = merged(
      existing,
      '1. e4 { Theirs [%cal Rd2d4] } e5 { New [%csl Gd4] } Nf3 { [%cal Bf1c4] } *',
    );
    const e4 = must(graph.moves.find((m) => m.san === 'e4'));
    expect([e4.comment, e4.arrows, e4.circles]).toEqual([
      'Mine',
      [{ from: 'g1', to: 'f3', color: 'G' }],
      [],
    ]);
    const e5 = must(graph.moves.find((m) => m.san === 'e5'));
    expect([e5.comment, e5.circles]).toEqual([
      'New',
      [{ square: 'd4', color: 'G' }],
    ]);
    const nf3 = must(graph.moves.find((m) => m.san === 'Nf3'));
    expect([nf3.comment, nf3.arrows]).toEqual([
      null,
      [{ from: 'f1', to: 'c4', color: 'B' }],
    ]);
  });

  it('keeps an existing circle without taking imported arrows', () => {
    const existing = graphOf('1. e4 { [%csl Rd5] } *');
    const { graph } = merged(existing, '1. e4 { [%cal Gg1f3] } e5 *');
    const e4 = must(graph.moves.find((m) => m.san === 'e4'));
    expect([e4.arrows, e4.circles]).toEqual([
      [],
      [{ square: 'd5', color: 'R' }],
    ]);
  });

  it('leaves out a second answer with the moves only it reached, naming the game and move (R-54)', () => {
    const existing = graphOf('1. e4 e5 2. Nf3 *');
    const r = merged(
      existing,
      '[Event "A"]\n\n1. e4 e5 2. Bc4 Nf6 3. d3 *\n\n[Event "B"]\n\n1. e4 c5 2. Nf3 *',
    );
    expect(r.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'Bc4', move: 2 },
    ]);
    expect(r.graph.moves.some((m) => m.san === 'Nf6')).toBe(false);
    expect(r.graph.moves.some((m) => m.san === 'd3')).toBe(false);
    // Game A kept 1. e4 e5, so it is a chapter; game B is the next.
    expect(r.graph.chapters.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('numbers a Black second answer by its full move', () => {
    const existing = graphOf('1. e4 c5 2. Nf3 d6 *', 'black');
    const r = merged(existing, '1. e4 c5 2. Nf3 Nc6 3. d4 *', 'black');
    expect(r.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'Nc6', move: 2 },
    ]);
    expect(r.graph.moves.some((m) => m.san === 'd4')).toBe(false);
  });

  it('reports the game of the second answer by its place in the file', () => {
    const existing = graphOf('1. e4 e5 2. Nf3 Nc6 3. Bc4 *');
    const r = merged(
      existing,
      '[Event "A"]\n\n1. e4 c5 2. Nf3 *\n\n[Event "B"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *',
    );
    expect(r.skipped).toEqual([
      { game: 2, reason: 'pgn.secondAnswer', san: 'Bb5', move: 3 },
    ]);
  });

  it('adds no chapter for a game none of whose moves fit', () => {
    const existing = graphOf('1. e4 *');
    const r = merged(existing, '1. d4 d5 *');
    expect(r.graph.chapters.map((c) => c.id)).toEqual(['c1']);
    expect(r.graph.moves).toEqual(existing.moves);
  });

  it('leaves out what only a refused move reached, but not a position a kept move reaches', () => {
    // Black answers 1. c4 with e5, so the import's 1. c4 Nf6 is refused,
    // with its 2. d4. The position after 1. c4 Nf6 2. d4 is also reached by
    // 1. d4 Nf6 2. c4, which is kept, so its 2... e6 3. Nc3 stay.
    const existing = graphOf('1. c4 e5 *', 'black');
    const r = merged(
      existing,
      '1. d4 (1. c4 Nf6 2. d4) 1... Nf6 2. c4 e6 3. Nc3 *',
      'black',
    );
    expect(r.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'Nf6', move: 1 },
    ]);
    expect(lines(r.graph, 'c2').map((l) => l.map((m) => m.san))).toEqual([
      ['c4'],
      ['d4', 'Nf6', 'c4', 'e6', 'Nc3'],
    ]);
    expect(r.graph.moves.filter((m) => m.san === 'd4')).toHaveLength(1);
  });

  it('walks a position two imported routes reach once', () => {
    // 1. d4 Nf6 2. c4 and 1. c4 Nf6 2. d4 reach one position, where the
    // existing repertoire answers 2... g6, so the import's 2... e6 is refused
    // and reported once.
    const existing = graphOf('1. d4 Nf6 2. c4 g6 *', 'black');
    const r = merged(
      existing,
      '1. d4 (1. c4 Nf6 2. d4 e6) 1... Nf6 2. c4 e6 *',
      'black',
    );
    expect(r.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'e6', move: 2 },
    ]);
    expect(r.graph.moves.map((m) => m.san)).toEqual([
      'd4',
      'Nf6',
      'c4',
      'g6',
      'c4',
      'Nf6',
      'd4',
    ]);
  });

  it('keeps the existing main line at a shared position (R-79)', () => {
    const existing = graphOf('1. e4 e5 2. Nf3 *');
    const { graph } = merged(existing, '1. e4 c5 2. Nf3 *');
    expect(mainLine(graph, 'c1').map((m) => m.san)).toEqual([
      'e4',
      'e5',
      'Nf3',
    ]);
    expect(mainLine(graph, 'c2').map((m) => m.san)).toEqual([
      'e4',
      'c5',
      'Nf3',
    ]);
  });

  it('numbers imported untitled chapters after the existing chapters', () => {
    const existing = graphOf('1. a3 *');
    const { graph } = merged(existing, '1. a3 a6 2. h3 *');
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'index', number: 1 },
      { kind: 'index', number: 2 },
    ]);
  });

  it('numbers past every number in use, not the chapter count', () => {
    const existing: RepertoireGraph = {
      ...graphOf('1. a3 *'),
      chapters: [
        {
          ...must(graphOf('1. a3 *').chapters[0]),
          nameSource: { kind: 'index', number: 5 },
        },
      ],
    };
    const { graph } = merged(existing, '1. a3 a6 *');
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'index', number: 5 },
      { kind: 'index', number: 6 },
    ]);
  });

  it('keeps a header name and names an added chapter by its merged main line', () => {
    const { graph } = merged(
      graphOf('1. e4 e5 2. Nf3 *', 'black'),
      '[Event "Mine"]\n\n1. a3 *\n\n[Event "Bishop"]\n\n1. e4 e5 2. Bc4 *',
      'black',
    );
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'eco', eco: 'C40' },
      { kind: 'header', name: 'Mine' },
      { kind: 'eco', eco: 'C23' },
    ]);
    // For White, 2. Bc4 is a second answer, so that chapter is only 1. e4 e5.
    const white = merged(graphOf('1. e4 e5 2. Nf3 *'), '1. e4 e5 2. Bc4 *');
    expect(white.graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'eco', eco: 'C40' },
      { kind: 'eco', eco: 'C20' },
    ]);
  });

  it('refuses a repertoire of the other side', () => {
    expect(mergeInto(graphOf('1. e4 *'), imported('1. e4 *', 'black'))).toEqual(
      {
        ok: false,
        refusal: { reason: 'repertoire.sideMismatch' },
      },
    );
  });

  it('does not change the existing graph', () => {
    const existing = graphOf('1. e4 e5 *');
    const before = JSON.stringify(existing);
    merged(existing, '1. e4 { x [%cal Gg1f3] } e5 { y } 2. Nf3 *');
    expect(JSON.stringify(existing)).toBe(before);
  });

  it('starts an imported chapter from its own root, numbering moves from it', () => {
    // After 1. e4, Black to move: the chapter's first half-move is Black's,
    // so White's 2. Bc4 is move 2, as export would number it.
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const existing = graphOf('1. e4 e5 2. Nf3 *');
    const r = merged(existing, `[FEN "${fen}"]\n\n1... e5 2. Bc4 *`);
    const added = must(r.graph.chapters[1]);
    expect(added.rootKey).toBe(must(existing.moves[0]).to);
    expect(added.rootKey).not.toBe(START);
    expect(r.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'Bc4', move: 2 },
    ]);
    expect(lines(r.graph, 'c2').map((l) => l.map((m) => m.san))).toEqual([
      ['e5'],
    ]);
  });
});

describe('mergeInto: properties', () => {
  /** A random legal line from the start, as SAN. */
  const line = fc
    .array(fc.nat(40), { minLength: 1, maxLength: 10 })
    .map((choices) => {
      const chess = new Chess();
      const sans: string[] = [];
      for (const c of choices) {
        const legal = chess.moves();
        if (legal.length === 0) break;
        const san = must(legal[c % legal.length]);
        chess.move(san);
        sans.push(san);
      }
      return sans;
    });
  const pgnOf = (games: readonly (readonly string[])[]) =>
    games
      .map(
        (sans) =>
          sans
            .map((s, i) => (i % 2 === 0 ? `${String(i / 2 + 1)}. ${s}` : s))
            .join(' ') + ' *',
      )
      .join('\n\n');
  const games = fc.array(line, { minLength: 1, maxLength: 3 });

  /** Every chapter's moves are exactly the moves its root reaches. */
  const reachable = (graph: RepertoireGraph): boolean => {
    const walks = chapterWalks(graph);
    return graph.chapters.every((c) => {
      const walked = new Set(walks(c.id).moves());
      return graph.moves.every(
        (m) => m.chapters.includes(c.id) === walked.has(m),
      );
    });
  };

  /** No position has two moves of the repertoire's side (R-54). */
  const oneAnswer = (graph: RepertoireGraph): boolean => {
    const answered = graph.moves
      .filter((m) => isPlayerMove(graph, m))
      .map((m) => m.from);
    return new Set(answered).size === answered.length;
  };

  it('keeps the existing moves, adds only imported ones and keeps the rules', () => {
    expect(() => {
      fc.assert(
        fc.property(
          fc.constantFrom<Side>('white', 'black'),
          games,
          games,
          (side, a, b) => {
            const existing = graphOf(pgnOf(a), side);
            const incoming = imported(pgnOf(b), side);
            const r = mergeInto(existing, incoming);
            if (!r.ok) return false;
            const keys = keysOf(r.value.graph);
            const before = keysOf(existing);
            const offered = keysOf(incoming.graph);
            const all = [...keys].every((k) => before.has(k) || offered.has(k));
            const kept = [...before].every((k) => keys.has(k));
            const complete =
              r.value.skipped.length > 0 ||
              [...offered].every((k) => keys.has(k));
            return (
              all &&
              kept &&
              complete &&
              reachable(r.value.graph) &&
              oneAnswer(r.value.graph)
            );
          },
        ),
        { numRuns: 25 },
      );
    }).not.toThrow();
  });
});

describe('mergeInto: cost', () => {
  /** `count` pseudo-random games of 30 half-moves, the same for one seed. */
  function randomGames(count: number, start: number): string {
    let seed = start;
    const random = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const games: string[] = [];
    for (let g = 0; g < count; g++) {
      const chess = new Chess();
      const parts: string[] = [];
      for (let ply = 0; ply < 30 && chess.moves().length > 0; ply++) {
        const legal = chess.moves();
        const san = must(legal[random(legal.length)]);
        chess.move(san);
        parts.push((ply % 2 === 0 ? `${String(ply / 2 + 1)}. ` : '') + san);
      }
      games.push(`[Event "G${String(g)}"]\n\n${parts.join(' ')} { note } *`);
    }
    return games.join('\n\n');
  }

  it('grows linearly with the repertoires', () => {
    const inputOf = (n: number) => ({
      existing: graphOf(randomGames(n, 1), 'black'),
      incoming: imported(randomGames(n, 2), 'black'),
    });
    const merge = ({ existing, incoming }: ReturnType<typeof inputOf>) =>
      mergeInto(existing, incoming);
    expect(growth(inputOf, merge, 10)).toBeLessThan(LINEAR_GROWTH);
  }, 300_000);
});
