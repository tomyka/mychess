import { describe, expect, it } from 'vitest';
import { imported, START } from '../pgn/test-support';
import type { RepertoireGraph } from './graph';
import { summarize } from './summary';

describe('summarize (the import summary, R-64)', () => {
  it('counts chapters, lines, moves, positions and transpositions', () => {
    const { graph, skipped } = imported(
      '[Event "A"]\n\n1. d4 Nf6 2. c4 (2. Nf3 e6) 2... e6 *\n\n[Event "B"]\n\n1. c4 e6 2. d4 Nf6 *',
      'black',
    );
    expect(skipped).toEqual([]);
    expect(summarize(graph)).toEqual({
      chapters: 2,
      lines: 3,
      moves: 10,
      positions: 10,
      transpositions: 1,
    });
  });

  it('counts a shared line end once per chapter that ends there', () => {
    const { graph } = imported(
      '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. e4 e5 *',
      'black',
    );
    expect(summarize(graph)).toEqual({
      chapters: 2,
      lines: 2,
      moves: 2,
      positions: 3,
      transpositions: 0,
    });
  });

  it('counts a chapter root among the positions, and an empty repertoire as nothing', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const { graph } = imported(`[FEN "${fen}"]\n\n1... c5 *`, 'black');
    expect(summarize(graph).positions).toBe(2);
    // Two roots, one of them also a move's target: start, after 1. e4, after 1... c5.
    const withStart: RepertoireGraph = {
      ...graph,
      chapters: [
        ...graph.chapters,
        {
          id: 'c2',
          rootKey: START,
          intro: null,
          nameSource: { kind: 'index', number: 2 },
        },
      ],
    };
    expect(summarize(withStart).positions).toBe(3);
    const empty: RepertoireGraph = { side: 'white', chapters: [], moves: [] };
    expect(summarize(empty)).toEqual({
      chapters: 0,
      lines: 0,
      moves: 0,
      positions: 0,
      transpositions: 0,
    });
  });

  it('does not count a move into a position the chapter continues from as a line end', () => {
    // 1. Nf3 Nf6 2. Ng1 Ng8 returns to the start, which continues.
    const { graph } = imported('1. Nf3 Nf6 2. Ng1 Ng8 *');
    expect(summarize(graph)).toMatchObject({ lines: 0, transpositions: 0 });
  });
});
