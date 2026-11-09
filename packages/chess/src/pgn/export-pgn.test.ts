import { Chess } from 'chess.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import { addMove, editComment, setMarks } from '../repertoire/edit';
import {
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type Side,
} from '../repertoire/graph';
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
    comment: string | null;
    nags: readonly number[];
    chapters: readonly string[];
  }[];
}) =>
  g.moves
    .map((m) =>
      JSON.stringify([
        m.from,
        m.san,
        m.arrows,
        m.circles,
        m.comment,
        m.nags,
        m.chapters,
      ]),
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

  it('writes a comment before the marks in one brace comment', () => {
    const graph = graphOf('1. e4 { Best [%cal Gg1f3] } e5 { Solid } *');
    expect(exportPgn(graph)).toContain(
      '1. e4 { Best [%cal Gg1f3] } e5 { Solid } *',
    );
  });

  it('writes a comment with arrows and circles in that order', () => {
    const graph = graphOf('1. e4 { [%csl Gd4] Best [%cal Gg1f3] } *');
    expect(exportPgn(graph)).toContain(
      '1. e4 { Best [%cal Gg1f3] [%csl Gd4] } *',
    );
  });

  it('names chapters through the title option', () => {
    const graph = graphOf('1. e4 e5 *');
    const titled = exportPgn(graph, {
      title: (c) => `Atvirasis debiutas ${c.id}`,
    });
    expect(titled).toContain('[Event "Atvirasis debiutas c1"]');
    expect(titled).not.toContain('C20');
  });

  it('escapes a title like any tag value', () => {
    const graph = graphOf('1. e4 e5 *');
    expect(exportPgn(graph, { title: () => 'A "B"' })).toContain(
      '[Event "A \\"B\\""]',
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

  // Hundreds of import/export round trips: about 2s alone, over 5s when the
  // gate's suites share the machine, so the timeout is only a sanity bound.
  it('round-trips random legal repertoires', { timeout: 30_000 }, () => {
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

  // About 0.5s alone; every builder move also names its chapter from the
  // taxonomy (R-104), so under the gate's shared load it can pass 5s. The
  // timeout is a sanity bound, as for the property above.
  it(
    'round-trips random branching repertoires with marks',
    {
      timeout: 30_000,
    },
    () => {
      const COLORS = ['G', 'R', 'Y', 'B'] as const;
      const COMMENTS = [
        'Idea: d4',
        'Kodėl ne?',
        'Plan { braces } [%cal Ge2e4] gone',
      ] as const;
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

      /** The squares a move is played between. */
      interface Square {
        readonly from: string;
        readonly to: string;
      }

      /** `graph` with a step's arrows, circles and comment on the move just added. */
      const annotate = (
        graph: RepertoireGraph,
        chapterId: string,
        at: { readonly from: string; readonly san: string },
        { squares, mark }: { readonly squares: Square; readonly mark: number },
      ): RepertoireGraph => {
        let annotated = graph;
        const color = COLORS[mark];
        if (color !== undefined) {
          const arrows = [{ from: squares.from, to: squares.to, color }];
          const circles = mark % 2 === 0 ? [{ square: squares.to, color }] : [];
          const marked = setMarks(annotated, chapterId, at, {
            arrows,
            circles,
          });
          if (marked.ok) annotated = marked.value;
        }
        if (mark % 2 === 0) return annotated;
        const text = COMMENTS[mark % COMMENTS.length] ?? '';
        const commented = editComment(
          annotated,
          moveKey(at.from, at.san),
          text,
        );
        if (!commented.ok) throw new Error(commented.refusal.reason);
        return commented.value;
      };

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
          chess.move(move.san);
          const at = { from, san: move.san };
          graph = annotate(added.value, chapterId, at, { squares: move, mark });
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
              m.comment,
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
    },
  );
});

/**
 * apps/web/e2e/fixtures/persona-katalonu.pgn verbatim (the D-M1-2 file, with
 * `$1`, `$14` and comments); keep the two in step.
 */
const KATALONU = `[Event "Open 7.Qc2 a6 8.Qxc4"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "Dovydas Jankauskas"]
[Black "?"]
[Result "*"]

{Open Catalan with 7.Qc2: White wins the c4 pawn back first.} 1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O dxc4 7. Qc2 a6 8. Qxc4 $1 b5 9. Qc2 Bb7 10. Bd2 Be4 11. Qc1 Bb7 12. Bf4 Nd5 13. Nc3 Nxf4 14. Qxf4 Bd6 15. Qd2 Nd7 16. Rfd1 Qe7 17. Rac1 Rfd8 18. e4 $1 {Centras, kol juodieji nebaigė vystymosi.} b4 19. Na4 a5 20. Rc2 Rab8 21. Rdc1 Ba8 $14 *

[Event "6...c5"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "Dovydas Jankauskas"]
[Black "?"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O c5 7. cxd5 Nxd5 8. Nc3 Nc6 9. dxc5 Bxc5 10. Nxd5 exd5 {Isolated pawn on d5: blockade it.} 11. a3 Bf5 12. b4 $1 Bb6 13. Bb2 Re8 14. Rc1 Rc8 15. e3 Be4 16. Qd2 Qe7 17. Rfd1 Rcd8 18. Bd4 Bxd4 19. Nxd4 Nxd4 20. Qxd4 Bxg2 21. Kxg2 $14 *

[Event "Closed 6...Nbd7"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "Dovydas Jankauskas"]
[Black "?"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. g3 d5 4. Bg2 Be7 5. Nf3 O-O 6. O-O Nbd7 7. Qc2 c6 8. Nbd2 b6 9. e4 Bb7 10. b3 Rc8 11. Bb2 Qc7 12. Rad1 Qb8 13. Rfe1 Rfd8 14. e5 Ne8 15. Nf1 c5 16. Ne3 Nc7 17. h4 $1 {Space on the kingside before Black frees himself.} cxd4 18. Nxd4 dxc4 19. Nxc4 Nd5 20. Qe4 Nc5 21. Qg4 $14 *

[Event "3...Bb4+"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "Dovydas Jankauskas"]
[Black "?"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. g3 Bb4+ 4. Bd2 Be7 {Black retreats; the d2 bishop is misplaced, but so is Black's.} 5. Bg2 d5 6. Nf3 O-O 7. O-O c6 8. Qc2 b6 9. Bf4 Ba6 10. Nbd2 Nbd7 11. Rfd1 Rc8 12. e4 c5 13. exd5 exd5 14. Rac1 Re8 15. Qa4 Bb7 16. dxc5 Nxc5 17. Qc2 Ne6 18. Be5 dxc4 19. Nxc4 Bxf3 20. Bxf3 Bc5 21. Qa4 $14 *

[Event "1...g6 / 1...c5 / 1...f5"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "Dovydas Jankauskas"]
[Black "?"]
[Result "*"]

{Sidelines against non-Catalan replies.} 1. d4 Nf6 (1... f5 {Dutch: fianchetto first.} 2. g3 Nf6 3. Bg2 e6 4. Nf3 d5 5. O-O Bd6 6. c4 c6 7. b3 Qe7 8. Ne5 O-O 9. Bb2 b6 10. Nd2 Bb7 11. Rc1 Nbd7 12. Nd3 a5 13. e3 Rac8 14. Re1 Ba6) 2. c4 g6 (2... c5 {Benoni.} 3. d5 e6 4. Nc3 exd5 5. cxd5 d6 6. e4 g6 7. Nf3 Bg7 8. h3 O-O 9. Bd3 b5 10. Nxb5 Re8 11. O-O Nxe4 12. Re1 a6 13. Na3 Nf6 14. Rxe8+ Nxe8 15. Bg5 Qb6 16. Nc4 Qb4) 3. g3 d5 (3... Bg7 {King's Indian.} 4. Bg2 O-O 5. Nc3 d6 6. Nf3 Nbd7 7. O-O e5 8. e4 c6 9. h3 Qb6 10. Re1 exd4 11. Nxd4 Re8 12. Rb1 Nc5 13. Be3 a5 14. Qc2 Nfd7 15. Rbd1 Ne5 16. b3 a4 17. Rb1 axb3 18. axb3 Qc7 19. f4 Ne6 20. Nde2 Nd7 21. Qd2) 4. cxd5 Nxd5 5. Bg2 Bg7 6. e4 Nb6 7. Ne2 c5 8. d5 e6 9. O-O O-O 10. Nec3 exd5 11. exd5 Na6 12. Na3 Bf5 13. Nab5 Qd7 14. a4 Rfd8 15. Bf4 Nb4 16. Re1 a6 17. Nd6 Bg4 18. Qd2 N4xd5 19. Nxd5 Nxd5 20. Bxd5 Qxd6 21. Bxd6 Rxd6 $14 *`;

describe('exportPgn: NAGs (R-175)', () => {
  it('writes each NAG as $n after the SAN and before the comment', () => {
    const graph = graphOf('1. e4! { Best } e5 $14 $146 2. Nf3?! *');
    expect(exportPgn(graph)).toContain(
      '1. e4 $1 { Best } e5 $14 $146 2. Nf3 $6 *',
    );
  });

  it('writes the NAGs of a variation move', () => {
    const graph = graphOf('1. e4 e5 (1... c5 $5 2. Nf3) 2. Nf3 *');
    expect(exportPgn(graph)).toContain('(1... c5 $5 2. Nf3)');
  });

  it('round-trips the persona Catalan file with its NAGs and comments', () => {
    const first = graphOf(KATALONU);
    const qxc4 = must(first.moves.find((m) => m.san === 'Qxc4'));
    const ba8 = must(first.moves.find((m) => m.san === 'Ba8'));
    expect([qxc4.nags, ba8.nags]).toEqual([[1], [14]]);
    const e4 = must(
      first.moves.find((m) => m.comment?.startsWith('Centras') === true),
    );
    expect([e4.san, e4.nags]).toEqual(['e4', [1]]);
    const pgn = exportPgn(first);
    expect(pgn).toContain('8. Qxc4 $1 b5');
    expect(pgn).toContain(
      '18. e4 $1 { Centras, kol juodieji nebaigė vystymosi. } b4',
    );
    const again = graphOf(pgn);
    expect(normalise(again)).toEqual(normalise(first));
    expect(again.chapters.map((c) => c.intro)).toEqual(
      first.chapters.map((c) => c.intro),
    );
  });
});

describe('exportPgn: NAG round trip', () => {
  it('reads back the NAGs it writes, for any NAGs on any line', () => {
    const annotatedLine = fc
      .array(
        fc.tuple(
          fc.nat(40),
          fc.array(fc.integer({ min: 1, max: 255 }), { maxLength: 3 }),
        ),
        { minLength: 1, maxLength: 10 },
      )
      .map((steps) => {
        const chess = new Chess();
        const parts: string[] = [];
        for (const [i, [choice, nags]] of steps.entries()) {
          const legal = chess.moves();
          if (legal.length === 0) break;
          const san = must(legal[choice % legal.length]);
          chess.move(san);
          const number = i % 2 === 0 ? `${String(i / 2 + 1)}. ` : '';
          const written = nags.map((n) => ` $${String(n)}`).join('');
          parts.push(`${number}${san}${written}`);
        }
        return `${parts.join(' ')} *`;
      });
    expect(() => {
      fc.assert(
        fc.property(annotatedLine, (pgn) => {
          const first = graphOf(pgn);
          const again = graphOf(exportPgn(first));
          return (
            JSON.stringify(normalise(again)) ===
            JSON.stringify(normalise(first))
          );
        }),
        RUNS,
      );
    }).not.toThrow();
  });
});
