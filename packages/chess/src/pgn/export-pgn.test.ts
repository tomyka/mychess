import { Chess } from 'chess.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import { addMove, setMarks } from '../repertoire/edit';
import type { Chapter, RepertoireGraph, Side } from '../repertoire/graph';
import { exportPgn } from './export-pgn';
import { importPgn } from './import-pgn';
import { imported, must, START } from './test-support';

/**
 * Property runs, bounded so each property stays well under two seconds
 * under coverage instrumentation.
 */
const RUNS = { numRuns: 25 };

const graphOf = (text: string, side: Side = 'white'): RepertoireGraph =>
  imported(text, side).graph;

const normalise = (g: {
  moves: readonly {
    from: string;
    san: string;
    arrows: unknown;
    circles: unknown;
    chapters: readonly string[];
  }[];
}) =>
  g.moves
    .map((m) =>
      JSON.stringify([m.from, m.san, m.arrows, m.circles, m.chapters]),
    )
    .sort();

const withChapters = (
  graph: RepertoireGraph,
  edit: (chapter: Chapter) => Chapter,
): RepertoireGraph => ({ ...graph, chapters: graph.chapters.map(edit) });

describe('exportPgn', () => {
  it('writes one game per chapter with intro, marks and variations', () => {
    const r = importPgn(
      '[Event "Italian"]\n\n{ Intro } 1. e4 { [%cal Gg1f3] } e5 (1... c5 2. Nf3) 2. Nf3 *',
      'white',
    );
    if (!r.ok) throw new Error('import failed');
    const pgn = exportPgn(r.value.graph);
    expect(pgn).toContain('[Event "C40"]');
    expect(pgn).toContain('{ Intro }');
    expect(pgn).toContain('[%cal Gg1f3]');
    expect(pgn).toContain('(1... c5 2. Nf3)');
  });

  it('writes the exact text of a chapter', () => {
    const graph = graphOf(
      '[Event "Italian"]\n\n{ Intro } 1. e4 { [%cal Gg1f3,Rf1c4] [%csl Bd5] } e5 (1... c5 2. Nf3) (1... e6) 2. Nf3 *\n\n[Event "Sicilian"]\n\n1. e4 c5 2. Nf3 d6 *',
    );
    expect(exportPgn(graph)).toBe(
      [
        '[Event "C40"]',
        '[Result "*"]',
        '',
        '{ Intro } 1. e4 { [%cal Gg1f3,Rf1c4] [%csl Bd5] } e5 (1... c5 2. Nf3) (1... e6) 2. Nf3 *',
        '',
        '[Event "B50"]',
        '[Result "*"]',
        '',
        '1. e4 { [%cal Gg1f3,Rf1c4] [%csl Bd5] } c5 2. Nf3 d6 *',
      ].join('\n'),
    );
  });

  it('writes several circles in one command', () => {
    const graph = graphOf('1. e4 { [%csl Gd4,Re5] } *');
    expect(exportPgn(graph)).toContain('1. e4 { [%csl Gd4,Re5] } *');
  });

  it('numbers a Black move after a variation, and a FEN start', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const graph = graphOf(
      `[FEN "${fen}"]\n\n1... c5 2. Nf3 (2. c3 d5) 2... d6 *`,
      'black',
    );
    expect(exportPgn(graph)).toBe(
      [
        '[Event "Chapter 1"]',
        '[SetUp "1"]',
        `[FEN "${positionKey(fen)} 0 1"]`,
        '[Result "*"]',
        '',
        '1... c5 2. Nf3 (2. c3 d5) 2... d6 *',
      ].join('\n'),
    );
  });

  it('numbers from 1 whatever the source FEN counters, as its FEN tag says', () => {
    // A position key drops the move counters, so the exported FEN tag ends
    // "0 1" and the movetext numbering starts at 1 to match it.
    const fen =
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 12';
    const graph = graphOf(`[FEN "${fen}"]\n\n12. Bb5 a6 *`, 'white');
    expect(exportPgn(graph)).toContain(
      `[FEN "${positionKey(fen)} 0 1"]\n[Result "*"]\n\n1. Bb5 a6 *`,
    );
  });

  it('names a chapter by its custom name, header name or ECO code', () => {
    const graph = graphOf('1. e4 e5 *');
    const named = (nameSource: Chapter['nameSource']) =>
      exportPgn(withChapters(graph, (c) => ({ ...c, nameSource })));
    expect(named({ kind: 'custom', name: 'My "e4"\\' })).toContain(
      '[Event "My \\"e4\\"\\\\"]',
    );
    expect(named({ kind: 'header', name: 'Open' })).toContain('[Event "Open"]');
    expect(named({ kind: 'eco', eco: 'C20' })).toContain('[Event "C20"]');
    expect(named({ kind: 'index', number: 7 })).toContain(
      '[Event "Chapter 7"]',
    );
  });

  it('keeps an escaped name and an intro with a brace through a round trip', () => {
    // 1. a3 matches no ECO entry, so the re-import keeps the header name.
    const graph = withChapters(graphOf('1. a3 e5 *'), (c) => ({
      ...c,
      intro: 'Close } early',
      nameSource: { kind: 'custom', name: 'A "B" \\ C' },
    }));
    const again = must(graphOf(exportPgn(graph)).chapters[0]);
    expect(again.nameSource).toEqual({ kind: 'header', name: 'A "B" \\ C' });
    expect(again.intro).toBe('Close early');
  });

  it('writes the main line in full when a variation transposes into it', () => {
    const graph = graphOf('1. e4 e6 (1... d6 2. d4 e6 3. Nc3 Nf6) 2. d4 d6 *');
    expect(exportPgn(graph)).toContain(
      '1. e4 e6 (1... d6 2. d4 e6) 2. d4 d6 3. Nc3 Nf6 *',
    );
  });

  it('writes each position of a transposition once', () => {
    const graph = graphOf(
      '1. d4 (1. c4 e6 2. d4 Nf6 3. Nc3 Bb4) 1... Nf6 2. c4 e6 3. Nc3 Bb4 *',
      'black',
    );
    expect(graph.moves).toHaveLength(10);
    expect(exportPgn(graph)).toContain(
      '1. d4 (1. c4 e6 2. d4 Nf6) 1... Nf6 2. c4 e6 3. Nc3 Bb4 *',
    );
  });

  it('ends a line that repeats a position', () => {
    const graph = graphOf('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 *');
    expect(graph.moves).toHaveLength(4);
    expect(exportPgn(graph)).toContain('1. Nf3 Nf6 2. Ng1 Ng8 *');
  });

  it('writes a chapter without moves as an empty game', () => {
    // 1. a3 matches no ECO entry, so the chapter keeps its numbered name.
    const graph = withChapters(graphOf('1. a3 *'), (c) => ({
      ...c,
      id: 'other',
    }));
    expect(exportPgn(graph)).toBe('[Event "Chapter 1"]\n[Result "*"]\n\n*');
  });

  it('round-trips random legal repertoires', () => {
    const line = fc
      .array(fc.nat(40), { minLength: 1, maxLength: 12 })
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
    const pgnOf = (sans: readonly string[]) =>
      sans
        .map((s, i) => (i % 2 === 0 ? `${String(i / 2 + 1)}. ${s}` : s))
        .join(' ') + ' *';
    expect(() => {
      fc.assert(
        fc.property(line, (sans) => {
          const pgn = pgnOf(sans);
          const first = importPgn(pgn, 'white');
          if (!first.ok) return false;
          const again = importPgn(exportPgn(first.value.graph), 'white');
          return (
            again.ok &&
            JSON.stringify(normalise(again.value.graph)) ===
              JSON.stringify(normalise(first.value.graph))
          );
        }),
        RUNS,
      );
    }).not.toThrow();
    expect(() => {
      fc.assert(
        fc.property(fc.array(line, { minLength: 1, maxLength: 4 }), (games) => {
          const pgn = games.map(pgnOf).join('\n\n');
          for (const side of ['white', 'black'] as const) {
            const first = importPgn(pgn, side);
            if (!first.ok) return false;
            const again = importPgn(exportPgn(first.value.graph), side);
            if (!again.ok) return false;
            if (
              JSON.stringify(normalise(again.value.graph)) !==
              JSON.stringify(normalise(first.value.graph))
            ) {
              return false;
            }
          }
          return true;
        }),
        RUNS,
      );
    }).not.toThrow();
  });

  it('round-trips random branching repertoires with marks', () => {
    const COLORS = ['G', 'R', 'Y', 'B'] as const;
    // Each step: a move choice, and whether (and in which colour) to mark it.
    const step = fc.tuple(fc.nat(40), fc.nat(7));
    const branch = fc.tuple(
      fc.nat(2),
      fc.array(step, { minLength: 1, maxLength: 10 }),
    );
    const repertoire = fc.tuple(
      fc.constantFrom<Side>('white', 'black'),
      fc.array(branch, { minLength: 1, maxLength: 8 }),
    );

    const addLine = (
      start: RepertoireGraph,
      chapterId: string,
      steps: readonly (readonly [number, number])[],
    ): RepertoireGraph => {
      let graph = start;
      const chess = new Chess();
      for (const [choice, mark] of steps) {
        const legal = chess.moves({ verbose: true });
        if (legal.length === 0) break;
        const move = must(legal[choice % legal.length]);
        const from = positionKey(chess.fen());
        const added = addMove(graph, chapterId, from, move.san);
        if (!added.ok) break;
        graph = added.value;
        chess.move(move.san);
        const color = COLORS[mark];
        if (color !== undefined) {
          const arrows = [{ from: move.from, to: move.to, color }];
          const circles = mark % 2 === 0 ? [{ square: move.to, color }] : [];
          const marked = setMarks(
            graph,
            chapterId,
            { from, san: move.san },
            {
              arrows,
              circles,
            },
          );
          if (marked.ok) graph = marked.value;
        }
      }
      return graph;
    };

    /** Each move with its chapters as indexes, so renumbered ids compare equal. */
    const canonical = (graph: RepertoireGraph) => {
      const ids = graph.chapters.map((c) => c.id);
      return graph.moves
        .map((m) =>
          JSON.stringify([
            m.from,
            m.san,
            m.arrows,
            m.circles,
            m.chapters.map((c) => ids.indexOf(c)).sort(),
          ]),
        )
        .sort();
    };

    expect(() => {
      fc.assert(
        fc.property(repertoire, ([side, branches]) => {
          const chapters: Chapter[] = [1, 2, 3].map((number) => ({
            id: `c${String(number)}`,
            rootKey: START,
            intro: null,
            nameSource: { kind: 'index', number },
          }));
          let graph: RepertoireGraph = { side, chapters, moves: [] };
          for (const [chapter, steps] of branches) {
            graph = addLine(graph, `c${String(chapter + 1)}`, steps);
          }
          // A chapter without moves exports as an empty game, which the import skips.
          graph = {
            ...graph,
            chapters: graph.chapters.filter((c) =>
              graph.moves.some((m) => m.chapters.includes(c.id)),
            ),
          };
          const again = importPgn(exportPgn(graph), side);
          return (
            again.ok &&
            again.value.skipped.length === 0 &&
            JSON.stringify(canonical(again.value.graph)) ===
              JSON.stringify(canonical(graph))
          );
        }),
        RUNS,
      );
    }).not.toThrow();
  });
});
