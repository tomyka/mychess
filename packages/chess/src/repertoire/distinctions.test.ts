import { describe, expect, it } from 'vitest';
import { imported } from '../pgn/test-support';
import { START_KEY } from '../position-key';
import { chapterDistinctions } from './distinctions';
import type { Chapter, RepertoireGraph } from './graph';

const graphOf = (text: string, side: 'white' | 'black' = 'black') =>
  imported(text, side).graph;

const renamed = (
  graph: RepertoireGraph,
  id: string,
  nameSource: Chapter['nameSource'],
): RepertoireGraph => ({
  ...graph,
  chapters: graph.chapters.map((c) => (c.id === id ? { ...c, nameSource } : c)),
});

const ADVANCE = '1. e4 c6 2. d4 d5 3. e5 Bf5 *';
const CLASSICAL = '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 *';
const TWO_KNIGHTS = '1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 *';

/**
 * The main lines of the coach persona's fixture
 * (apps/web/e2e/fixtures/karo-kan.pgn), whose chapters 1 (B12) and 5 (B11)
 * share the title "Karo-Kano gynyba" (#301).
 */
const KARO_KAN = [
  '1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 5. Be2 c5 6. Be3 Nd7 7. O-O Ne7 8. c4 dxc4 9. Na3 Nd5 10. Nxc4 Nxe3 11. Nxe3 Be4 *',
  '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 8. h5 Bh7 9. Bd3 Bxd3 10. Qxd3 e6 *',
  '1. e4 c6 2. d4 d5 3. exd5 cxd5 4. Bd3 Nc6 5. c3 Nf6 6. Bf4 Bg4 7. Qb3 Qd7 8. Nd2 e6 9. Ngf3 Bd6 10. Bxd6 Qxd6 *',
  '1. e4 c6 2. d4 d5 3. exd5 cxd5 4. c4 Nf6 5. Nc3 e6 6. Nf3 Be7 7. cxd5 Nxd5 8. Bd3 Nc6 9. O-O O-O 10. Re1 Bf6 *',
  '1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 4. h3 Bxf3 5. Qxf3 e6 6. d4 Nf6 7. Bd3 dxe4 8. Nxe4 Qxd4 9. c3 Qd8 10. O-O Nbd7 *',
].join('\n\n');

describe('chapterDistinctions (R-158)', () => {
  it('gives each chapter its ECO code and the first move it does not share', () => {
    const graph = graphOf(`${ADVANCE}\n\n${CLASSICAL}\n\n${TWO_KNIGHTS}`);
    const d = chapterDistinctions(graph);
    expect(d.get('c1')).toEqual({
      eco: 'B12',
      firstMove: { ply: 4, san: 'e5', whiteFirst: true },
    });
    expect(d.get('c2')).toEqual({
      eco: 'B18',
      firstMove: { ply: 4, san: 'Nc3', whiteFirst: true },
    });
    expect(d.get('c3')).toEqual({
      eco: 'B11',
      firstMove: { ply: 2, san: 'Nc3', whiteFirst: true },
    });
    expect([...d.keys()]).toEqual(['c1', 'c2', 'c3']);
  });

  it('takes the deepest divergence over all other chapters', () => {
    // c1 parts from c3 at ply 2 but from c2 only at ply 4.
    const graph = graphOf(`${ADVANCE}\n\n${TWO_KNIGHTS}\n\n${CLASSICAL}`);
    expect(chapterDistinctions(graph).get('c1')?.firstMove).toEqual({
      ply: 4,
      san: 'e5',
      whiteFirst: true,
    });
  });

  it('has no first move for a main line that is a prefix of another', () => {
    const graph = graphOf(`1. e4 c6 2. d4 *\n\n${ADVANCE}`);
    const d = chapterDistinctions(graph);
    expect(d.get('c1')?.firstMove).toBeNull();
    expect(d.get('c2')?.firstMove).toEqual({
      ply: 3,
      san: 'd5',
      whiteFirst: true,
    });
  });

  it('parts transposed lines at their first different move', () => {
    const graph = graphOf(
      '1. d4 Nf6 2. c4 e6 3. Nc3 *\n\n1. c4 e6 2. d4 Nf6 3. Nf3 *',
    );
    const d = chapterDistinctions(graph);
    expect(d.get('c1')?.firstMove).toEqual({
      ply: 0,
      san: 'd4',
      whiteFirst: true,
    });
    expect(d.get('c2')?.firstMove).toEqual({
      ply: 0,
      san: 'c4',
      whiteFirst: true,
    });
  });

  it('has no first move for a main line equal to another', () => {
    const graph = graphOf(`${ADVANCE}\n\n${ADVANCE}`);
    const d = chapterDistinctions(graph);
    expect(d.get('c1')?.firstMove).toBeNull();
    expect(d.get('c2')?.firstMove).toBeNull();
  });

  it('gives a FEN-rooted chapter no ECO code unless its name source has one', () => {
    const fen = 'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const graph = graphOf(`[FEN "${fen}"]\n\n2. d4 d5 *\n\n${TWO_KNIGHTS}`);
    const d = chapterDistinctions(graph);
    expect(d.get('c1')).toEqual({
      eco: null,
      firstMove: { ply: 0, san: 'd4', whiteFirst: true },
    });
    const named = renamed(graph, 'c1', { kind: 'eco', eco: 'B12' });
    expect(chapterDistinctions(named).get('c1')?.eco).toBe('B12');
  });

  it('numbers a chapter rooted with Black to move from Black', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const graph = graphOf(
      `[FEN "${fen}"]\n\n1... c6 2. d4 *\n\n[FEN "${fen}"]\n\n1... c6 2. Nc3 *`,
    );
    expect(chapterDistinctions(graph).get('c2')).toEqual({
      eco: null,
      firstMove: { ply: 1, san: 'Nc3', whiteFirst: false },
    });
  });

  it('classifies the main line of a header-named chapter from the start', () => {
    const graph = renamed(
      renamed(graphOf(`${ADVANCE}\n\n${TWO_KNIGHTS}`), 'c1', {
        kind: 'header',
        name: 'Karo-Kann',
      }),
      'c2',
      { kind: 'custom', name: 'Mine' },
    );
    const d = chapterDistinctions(graph);
    expect(d.get('c1')?.eco).toBe('B12');
    expect(d.get('c2')?.eco).toBe('B11');
  });

  it('gives an index-named chapter whose line classifies nothing no ECO code', () => {
    const graph = graphOf('1. a3 e5 *');
    expect(graph.chapters[0]?.nameSource.kind).toBe('index');
    expect(chapterDistinctions(graph).get('c1')?.eco).toBeNull();
  });

  it('starts a single chapter at its first move', () => {
    const d = chapterDistinctions(graphOf(ADVANCE));
    expect(d.get('c1')).toEqual({
      eco: 'B12',
      firstMove: { ply: 0, san: 'e4', whiteFirst: true },
    });
  });

  it('gives a chapter with no moves no first move', () => {
    const graph: RepertoireGraph = {
      side: 'white',
      chapters: [
        {
          id: 'c1',
          rootKey: START_KEY,
          intro: null,
          nameSource: { kind: 'index', number: 1 },
        },
      ],
      moves: [],
    };
    expect(chapterDistinctions(graph).get('c1')).toEqual({
      eco: null,
      firstMove: null,
    });
  });

  it('tells apart the coach fixture chapters that share a title', () => {
    const graph = graphOf(KARO_KAN);
    const d = chapterDistinctions(graph);
    expect(d.get('c1')).toEqual({
      eco: 'B12',
      firstMove: { ply: 4, san: 'e5', whiteFirst: true },
    });
    expect(d.get('c5')).toEqual({
      eco: 'B11',
      firstMove: { ply: 2, san: 'Nc3', whiteFirst: true },
    });
  });
});
