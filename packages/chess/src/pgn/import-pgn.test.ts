import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import {
  moveKey,
  type RepertoireGraph,
  type RepertoireMove,
  type Side,
} from '../repertoire/graph';
import { importPgn, type ImportedRepertoire } from './import-pgn';
import { growth, imported, LINEAR_GROWTH, must, START } from './test-support';

const two = `[Event "Italian"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 *

[Event "Broken"]

1. e4 e5 2. Ke3?? Nc6 *

[Event "Scotch"]

1. e4 e5 2. Nf3 Nc6 3. d4 *`;

describe('importPgn', () => {
  it('imports the valid games and lists the broken ones (1-based)', () => {
    // Black: for White, the Scotch's 3. d4 would be a second answer to the
    // Italian's 3. Bc4 (see the next test).
    const r = importPgn(two, 'black');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'eco', eco: 'C50' },
      { kind: 'eco', eco: 'C44' },
    ]);
    expect(r.value.skipped).toEqual([
      { game: 2, reason: 'pgn.illegalMove', san: 'Ke3' },
    ]);
  });

  it('builds one chapter per good game, sharing the moves they have in common', () => {
    const { graph, skipped } = imported(two);
    expect(skipped).toEqual([
      { game: 2, reason: 'pgn.illegalMove', san: 'Ke3' },
      { game: 3, reason: 'pgn.secondAnswer', san: 'd4', move: 3 },
    ]);
    expect(graph.side).toBe('white');
    expect(graph.chapters.map((c) => [c.id, c.rootKey])).toEqual([
      ['c1', START],
      ['c2', START],
    ]);
    expect(graph.moves.map((m) => [m.san, m.chapters])).toEqual([
      ['e4', ['c1', 'c2']],
      ['e5', ['c1', 'c2']],
      ['Nf3', ['c1', 'c2']],
      ['Nc6', ['c1', 'c2']],
      ['Bc4', ['c1']],
    ]);
  });

  it('reports a second player answer and keeps the first', () => {
    const r = importPgn('1. e4 (1. d4) e5 *', 'white');
    expect(r.ok && r.value.graph.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(r.ok && r.value.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'd4', move: 1 },
    ]);
  });

  it('skips everything below a second answer', () => {
    const { graph, skipped } = imported('1. e4 (1. d4 d5 2. c4) e5 *');
    expect(graph.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'd4', move: 1 },
    ]);
  });

  it('checks the second answer across games and drops a game left empty', () => {
    const { graph, skipped } = imported(
      '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *\n\n[Event "C"]\n\n1. e4 c5 *',
    );
    expect(graph.chapters.map((c) => [c.id, c.nameSource])).toEqual([
      ['c1', { kind: 'eco', eco: 'C20' }],
      ['c2', { kind: 'eco', eco: 'B20' }],
    ]);
    expect(skipped).toEqual([
      { game: 2, reason: 'pgn.secondAnswer', san: 'd4', move: 1 },
    ]);
  });

  it('checks the second answer for the side the repertoire is for', () => {
    const { graph, skipped } = imported('1. e4 (1. d4) e5 *', 'black');
    expect(skipped).toEqual([]);
    expect(graph.moves.map((m) => m.san)).toEqual(['e4', 'd4', 'e5']);
    const second = imported('1. e4 (1. d4 d5) e5 (1... c5) *', 'black');
    expect(second.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'c5', move: 1 },
    ]);
    expect(second.graph.moves.map((m) => m.san)).toEqual([
      'e4',
      'd4',
      'd5',
      'e5',
    ]);
  });

  it('keeps several opponent replies', () => {
    const r = importPgn('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *', 'white');
    expect(r.ok && r.value.skipped).toEqual([]);
    expect(r.ok && r.value.graph.moves).toHaveLength(5);
  });

  it('refuses a file with no valid game', () => {
    expect(importPgn('1. e4 e5 2. Ke3 *', 'white')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.noValidGames' },
    });
  });

  it('refuses an empty file as having no valid game', () => {
    expect(importPgn('  \n', 'white')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.noValidGames' },
    });
  });

  it('refuses a file over the limits before parsing', () => {
    expect(importPgn('a'.repeat(3 * 1024 * 1024), 'white')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.tooLarge', limit: 2 * 1024 * 1024 },
    });
  });

  it('caps the games it actually splits, Event tags or not', () => {
    const games = (n: number) => '1. e4 e5 *\n'.repeat(n);
    expect(importPgn(games(201), 'white')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.tooManyGames', limit: 200 },
    });
    expect(importPgn(games(200), 'white').ok).toBe(true);
  });

  it('uses the chapter intro and a FEN start', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const r = importPgn(
      `[FEN "${fen}"]\n\n{ From e4 } 1... c5 2. Nf3 *`,
      'white',
    );
    expect(r.ok && r.value.graph.chapters[0]).toEqual(
      expect.objectContaining({ intro: 'From e4', rootKey: positionKey(fen) }),
    );
  });

  it('names a chapter by the opening of its main line, else by header', () => {
    const najdorf = '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6';
    const { graph } = imported(
      `[Event "Mine"]\n\n${najdorf} 6. Be3 (6. Bg5 e6) *\n\n[Event "Odd"]\n\n1. a3 e5 *`,
      'black',
    );
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'eco', eco: 'B90' },
      { kind: 'header', name: 'Odd' },
    ]);
  });

  it('classifies a transposition by position', () => {
    const { graph } = imported('1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 *');
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'eco', eco: 'D37' },
    ]);
  });

  it('does not classify a chapter that starts from a set-up position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const { graph } = imported(`[FEN "${fen}"]\n\n1... c5 *`);
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'index', number: 1 },
    ]);
    // 1. Nf3 from the standard start is an ECO line; after 1. e4 e5 it is not one.
    const afterE5 =
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(
      imported(`[FEN "${afterE5}"]\n\n2. Nf3 *`).graph.chapters.map(
        (c) => c.nameSource,
      ),
    ).toEqual([{ kind: 'index', number: 1 }]);
    expect(imported('1. Nf3 *').graph.chapters[0]?.nameSource.kind).toBe('eco');
  });

  it('names a game no header names by its chapter number', () => {
    const { graph } = imported(
      // 1. a3 matches no ECO entry, so the taxonomy names neither game.
      '[Event "Same"]\n\n1. a3 e5 *\n\n[Event "Same"]\n\n1. a3 c5 *',
    );
    expect(graph.chapters.map((c) => [c.intro, c.nameSource])).toEqual([
      [null, { kind: 'index', number: 1 }],
      [null, { kind: 'index', number: 2 }],
    ]);
  });

  it('carries arrows and circles over, merging them across games', () => {
    const { graph } = imported(
      '1. e4 { [%cal Gg1f3] [%csl Rd5] } e5 *\n\n1. e4 { [%cal Gg1f3,Bf1c4] } c5 *',
    );
    expect(must(graph.moves[0])).toEqual(
      expect.objectContaining({
        san: 'e4',
        arrows: [
          { from: 'g1', to: 'f3', color: 'G' },
          { from: 'f1', to: 'c4', color: 'B' },
        ],
        circles: [{ square: 'd5', color: 'R' }],
      }),
    );
    expect(must(graph.moves[1]).arrows).toEqual([]);
  });

  it('numbers games by their order in the file, broken ones included', () => {
    const { graph, skipped } = imported(
      [
        '[Event "Bad tag"]\n\n1. e4 "oops" *',
        '[Event "Bad FEN"]\n[FEN "not a fen"]\n\n1. e4 *',
        '[Event "No moves"]\n\n*',
        '[Event "Open"]\n\n1. e4 ( 1. d4 *',
        '[Event "Lone"]\n\n( 1. e4 ) *',
        '1. d4 * 1. e4 *',
        '[Event "Good"]\n\n1. c4 *',
      ].join('\n\n'),
    );
    expect(skipped).toEqual([
      { game: 1, reason: 'pgn.unreadable' },
      { game: 2, reason: 'pgn.invalidFen' },
      { game: 3, reason: 'pgn.noMoves' },
      { game: 4, reason: 'pgn.unbalancedVariation' },
      { game: 5, reason: 'pgn.variationWithoutMove' },
      { game: 7, reason: 'pgn.secondAnswer', san: 'e4', move: 1 },
      { game: 8, reason: 'pgn.secondAnswer', san: 'c4', move: 1 },
    ]);
    expect(graph.moves.map((m) => m.san)).toEqual(['d4']);
  });

  it('keeps a game whole when a comment line starts with a bracket', () => {
    const { graph, skipped } = imported(
      '[Event "A"]\n\n1. e4 {a comment\n[%cal Gg1f3] } e5 *',
    );
    expect(skipped).toEqual([]);
    expect(graph.moves.map((m) => [m.san, m.arrows.length])).toEqual([
      ['e4', 1],
      ['e5', 0],
    ]);
  });

  it('isolates an unreadable game from its neighbours', () => {
    const { graph, skipped } = imported(
      '[Event "A"]\n\n1. e4 e5 *\n[Event "B"]\n\n1. e4 "x" *\n[Event "C {"]\n\n1. e4 c5 ; a { here\n*\n[Event "D"]\n\n1. e4 "x" *',
    );
    expect(skipped).toEqual([
      { game: 2, reason: 'pgn.unreadable' },
      { game: 4, reason: 'pgn.unreadable' },
    ]);
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      { kind: 'eco', eco: 'C20' },
      { kind: 'eco', eco: 'B20' },
    ]);
  });

  it('merges a transposition into one move', () => {
    const { graph } = imported(
      '1. d4 Nf6 2. c4 e6 3. Nc3 *\n\n1. c4 e6 2. d4 Nf6 3. Nc3 *',
      'black',
    );
    expect(graph.moves).toHaveLength(9);
    expect(
      graph.moves.filter((m) => m.san === 'Nc3').map((m) => m.chapters),
    ).toEqual([['c1', 'c2']]);
  });

  it('gives a second answer the full-move number of a set-up position', () => {
    const fen =
      'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const white = imported(
      `[FEN "${fen}"]\n\n3. Bc4 (3. d4) 3... Bc5 (3... Nf6) *`,
    );
    expect(white.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'd4', move: 3 },
    ]);
    const black = imported(
      `[FEN "${fen}"]\n\n3. Bc4 Bc5 (3... Nf6) *`,
      'black',
    );
    expect(black.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'Nf6', move: 3 },
    ]);
  });

  it('skips a variation hanging from a move below a second answer', () => {
    const { graph, skipped } = imported(
      '1. e4 (1. d4 d5 (1... Nf6 2. c4) 2. c4) e5 *',
    );
    expect(graph.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'd4', move: 1 },
    ]);
  });

  it('skips everything below a second answer, whatever the order of the lines', () => {
    // 1... c5 after 1. e4 e6 2. d4 is a second answer to 2... d5; below it,
    // 3. d5 exd5 starts from the position 1. d4 c5 2. e4 e6 also reaches.
    const transpositionFirst = imported(
      '1. e4 (1. d4 c5 2. e4 e6 3. d5) 1... e6 2. d4 d5 (2... c5 3. d5 exd5) *',
      'black',
    );
    const transpositionLast = imported(
      '1. d4 (1. e4 e6 2. d4 d5 (2... c5 3. d5 exd5)) 1... c5 2. e4 e6 3. d5 *',
      'black',
    );
    const moves = (r: ImportedRepertoire) =>
      r.graph.moves.map((m) => moveKey(m.from, m.san)).sort();
    for (const r of [transpositionFirst, transpositionLast]) {
      expect(r.skipped).toEqual([
        { game: 1, reason: 'pgn.secondAnswer', san: 'c5', move: 2 },
      ]);
      expect(r.graph.moves.map((m) => m.san)).not.toContain('exd5');
      expect(r.graph.moves).toHaveLength(9);
    }
    expect(moves(transpositionFirst)).toEqual(moves(transpositionLast));
  });

  it('keeps the variations beside a skipped answer', () => {
    const { graph, skipped } = imported(
      '1. e4 e5 2. Nf3 (2. Bc4 Nf6) (2. d4 exd4) 2... Nc6 (2... d6) *',
      'black',
    );
    expect(skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'd6', move: 2 },
    ]);
    expect(graph.moves.map((m) => m.san)).toEqual([
      'e4',
      'e5',
      'Nf3',
      'Bc4',
      'Nf6',
      'd4',
      'exd4',
      'Nc6',
    ]);
  });

  it('stores each move with its coordinates, promotion included', () => {
    const { graph } = imported(
      '[FEN "8/P7/8/8/8/8/k7/4K3 w - - 0 1"]\n\n1. a8=Q+ Kb3 *',
    );
    expect(graph.moves.map((m) => [m.san, m.uci])).toEqual([
      ['a8=Q+', 'a7a8q'],
      ['Kb3', 'a2b3'],
    ]);
  });

  it('splits a huge line with an unclosed comment in linear time', () => {
    const text = (repeats: number) =>
      `1. e4 ${'{ " '.repeat(repeats)}\n[Event "x"]\n\n1. e4 *`;
    const largest = text(480_000);
    expect(largest.length).toBeGreaterThan(1_900_000);
    expect(importPgn(largest, 'white')).toEqual({
      ok: false,
      refusal: { reason: 'pgn.noValidGames' },
    });
    const ratio = growth(text, (t) => importPgn(t, 'white'), 60_000);
    expect(ratio).toBeLessThan(LINEAR_GROWTH);
  }, 300_000);

  it('imports 200 games of about 1.9 MB, in time linear in the games', () => {
    const text = bigFile(200);
    expect(text.length).toBeGreaterThan(1_800_000);
    expect(text.length).toBeLessThan(2 * 1024 * 1024);
    const r = importPgn(text, 'black');
    expect(r.ok && r.value.skipped).toEqual([]);
    expect(r.ok && r.value.graph.chapters).toHaveLength(200);
    expect(r.ok && r.value.graph.moves.length).toBeGreaterThan(5000);
    // 10 games against 80 rather than 25 against 200: the growth is the
    // same proof, and six runs of the full file would take most of a minute
    // on a loaded CI runner.
    const ratio = growth(bigFile, (t) => importPgn(t, 'black'), 10);
    expect(ratio).toBeLessThan(LINEAR_GROWTH);
  }, 300_000);
});

// Ported from the strict parsePgn's tests when it was deleted (#260): the
// replay, marks, intro and naming cases importPgn shares.

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -';

/** The one move of `graph` with this SAN. */
function only(graph: RepertoireGraph, san: string): RepertoireMove {
  const found = graph.moves.filter((m) => m.san === san);
  expect(found).toHaveLength(1);
  return must(found[0]);
}

/** Each move as the SANs that reach it from the start; positions must not merge. */
function paths(graph: RepertoireGraph): string[] {
  const into = new Map(graph.moves.map((m) => [m.to, m]));
  const path = (m: RepertoireMove): string => {
    const before = into.get(m.from);
    return before === undefined ? m.san : `${path(before)} ${m.san}`;
  };
  return graph.moves.map(path);
}

/** The graph of a file that imports with nothing skipped. */
function clean(text: string, side: Side = 'white'): RepertoireGraph {
  const r = imported(text, side);
  expect(r.skipped).toEqual([]);
  return r.graph;
}

describe('importPgn: replaying moves into the graph', () => {
  it('keys each move by the positions before and after it', () => {
    expect(clean('1. e4 e5 *').moves).toEqual([
      {
        from: START,
        to: AFTER_E4,
        san: 'e4',
        uci: 'e2e4',
        arrows: [],
        circles: [],
        chapters: ['c1'],
      },
      {
        from: AFTER_E4,
        to: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -',
        san: 'e5',
        uci: 'e7e5',
        arrows: [],
        circles: [],
        chapters: ['c1'],
      },
    ]);
  });

  it('branches a variation from the position before the move it replaces', () => {
    const graph = clean('1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *');
    expect(
      graph.moves.filter((m) => m.from === AFTER_E4).map((m) => m.san),
    ).toEqual(['e5', 'c5']);
    expect(paths(graph)).toEqual([
      'e4',
      'e4 e5',
      'e4 c5',
      'e4 c5 Nf3',
      'e4 c5 Nf3 d6',
      'e4 e5 Nf3',
      'e4 e5 Nf3 Nc6',
    ]);
  });

  it('resumes the right branch after nested variations', () => {
    const graph = clean(
      '1. e4 e5 (1... c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4) 2. Nf3 Nc6 *',
    );
    expect(paths(graph)).toEqual([
      'e4',
      'e4 e5',
      'e4 c5',
      'e4 c5 Nf3',
      'e4 c5 Nf3 d6',
      'e4 c5 Nf3 Nc6',
      'e4 c5 Nf3 Nc6 d4',
      'e4 c5 Nf3 d6 d4',
      'e4 e5 Nf3',
      'e4 e5 Nf3 Nc6',
    ]);
  });

  it('merges a transposition within one game into one position', () => {
    const graph = clean(
      '1. d4 (1. c4 e6 2. d4 Nf6 3. Nc3) 1... Nf6 2. c4 e6 3. Nc3 *',
      'black',
    );
    expect(only(graph, 'Nc3').from).toBe(
      'rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -',
    );
  });

  it('lists a chapter once for a move it reaches twice', () => {
    expect(only(clean('1. e4 (1. e4 c5) 1... e5 *'), 'e4').chapters).toEqual([
      'c1',
    ]);
  });

  it('keeps positions apart that differ only in the en passant square', () => {
    const graph = clean('1. e4 a6 (1... d5 2. e5 a6 3. Nf3) 2. e5 d5 3. Nf3 *');
    expect(
      graph.moves.filter((m) => m.san === 'Nf3').map((m) => m.from),
    ).toEqual([
      'rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq -',
      'rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6',
    ]);
  });

  it('merges a return to the start, but not one that lost castling rights', () => {
    const graph = clean(
      '1. Nf3 Nf6 2. Ng1 (2. Rg1 Ng8 3. Rh1 Nf6 4. Ng1 Ng8) 2... Ng8 *',
      'black',
    );
    expect(graph.moves.filter((m) => m.san === 'Ng8').map((m) => m.to)).toEqual(
      [
        'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKBR1 w Qkq -',
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Qkq -',
        START,
      ],
    );
  });

  it('starts from a FEN header and stores moves in canonical SAN', () => {
    const graph = clean(
      '[SetUp "1"]\n[FEN "8/P7/8/8/8/8/8/k6K w - - 0 1"]\n\n1. a8Q *',
    );
    expect(must(graph.chapters[0]).rootKey).toBe('8/P7/8/8/8/8/8/k6K w - -');
    expect(graph.moves.map((m) => m.san)).toEqual(['a8=Q+']);
  });

  it('tolerates spaces around a FEN header value', () => {
    const graph = clean('[FEN " 8/P7/8/8/8/8/8/k6K w - - 0 1 "] 1. a8=Q *');
    expect(must(graph.chapters[0]).rootKey).toBe('8/P7/8/8/8/8/8/k6K w - -');
  });

  it('merges a FEN header root with the same position reached by moves', () => {
    const graph = clean(
      [
        '1. e4 e5 *',
        '[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]',
        '1... e5 *',
      ].join('\n'),
    );
    expect(must(graph.chapters[1]).rootKey).toBe(AFTER_E4);
    expect(only(graph, 'e5').chapters).toEqual(['c1', 'c2']);
  });

  it('reads past NAGs and suffix glyphs, which a move does not keep', () => {
    const graph = clean('1. e4! $14 e5?! $6 2. Nf3 *');
    expect(graph.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('accepts castling written with zeros', () => {
    const graph = clean(
      '[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. 0-0 0-0-0 *',
    );
    expect(graph.moves.map((m) => m.san)).toEqual(['O-O', 'O-O-O']);
  });
});

describe('importPgn: arrows and circles (R-65)', () => {
  it('keeps arrows on the move they follow', () => {
    const graph = clean('1. e4 { [%cal Gg1f3] } e5 *');
    expect(only(graph, 'e4')).toMatchObject({
      arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
      circles: [],
    });
    expect(only(graph, 'e5')).toMatchObject({ arrows: [], circles: [] });
  });

  it('reads marks beside prose and a clock in one comment', () => {
    const graph = clean('1. e4 {Main idea [%csl Rd5] [%clk 0:03:00]} *');
    expect(only(graph, 'e4')).toMatchObject({
      arrows: [],
      circles: [{ square: 'd5', color: 'R' }],
    });
  });

  it('collects the marks of several comments on one move', () => {
    const graph = clean('1. e4 {[%cal Gg1f3]} {[%cal Rd7d5][%csl Yd5]} *');
    expect(only(graph, 'e4')).toMatchObject({
      arrows: [
        { from: 'g1', to: 'f3', color: 'G' },
        { from: 'd7', to: 'd5', color: 'R' },
      ],
      circles: [{ square: 'd5', color: 'Y' }],
    });
  });

  it("gives marks before a variation's first move to that move", () => {
    const graph = clean('1. e4 ({[%cal Gc2c4]} 1. d4) *', 'black');
    expect(only(graph, 'd4').arrows).toEqual([
      { from: 'c2', to: 'c4', color: 'G' },
    ]);
  });

  it('unites the marks of a move reached twice, without repeats', () => {
    const graph = clean(
      [
        '1. e4 {[%cal Gg1f3][%csl Rd5]} *',
        '1. e4 {[%cal Gg1f3,Bb1c3][%csl Rd5]} *',
      ].join('\n\n'),
    );
    expect(only(graph, 'e4')).toMatchObject({
      arrows: [
        { from: 'g1', to: 'f3', color: 'G' },
        { from: 'b1', to: 'c3', color: 'B' },
      ],
      circles: [{ square: 'd5', color: 'R' }],
    });
  });

  it('turns a zero-length arrow into a circle on the move', () => {
    expect(only(clean('1. e4 {[%cal Ge4e4]} *'), 'e4')).toMatchObject({
      arrows: [],
      circles: [{ square: 'e4', color: 'G' }],
    });
  });
});

describe('importPgn: the chapter intro (R-66)', () => {
  const introOf = (text: string) => must(clean(text).chapters[0]).intro;

  it('keeps a comment before the first move as the intro', () => {
    expect(introOf('{ The Italian } 1. e4 e5 *')).toBe('The Italian');
  });

  it('has no intro when no comment comes before the first move', () => {
    expect(introOf('1. e4 {best} *')).toBeNull();
  });

  it('joins several comments before the first move', () => {
    expect(introOf('{One.} {Two.} 1. e4 *')).toBe('One. Two.');
  });

  it('drops commands from the intro, and an intro that is only commands', () => {
    expect(introOf('{[%csl Gd4] Centre} 1. e4 *')).toBe('Centre');
    expect(introOf('{[%csl Gd4]} 1. e4 *')).toBeNull();
  });

  it('drops marks before the first move: there is no move to draw them on', () => {
    const graph = clean('{[%cal Ge2e4]} 1. e4 *');
    expect(must(graph.chapters[0]).intro).toBeNull();
    expect(only(graph, 'e4')).toMatchObject({ arrows: [], circles: [] });
  });

  it('keeps an intro per chapter, after a FEN start too', () => {
    const graph = clean(
      [
        '[Event "A"]\n\n{Open} 1. e4 *',
        '[Event "B"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]\n\n{ From e4 } 1... c5 *',
      ].join('\n\n'),
    );
    expect(graph.chapters.map((c) => c.intro)).toEqual(['Open', 'From e4']);
  });
});

// 1. a3 matches no ECO entry, so these chapters keep the names their headers give.
describe('importPgn: splitting and naming games', () => {
  const namesOf = (text: string, side: Side = 'white') =>
    clean(text, side).chapters.map((c) => c.nameSource);
  const header = (name: string) => ({ kind: 'header', name });
  const index = (number: number) => ({ kind: 'index', number });

  it('names each game by its Event header, CRLF line ends included', () => {
    const text = [
      '[Event "Najdorf"]',
      '[White "?"]',
      '',
      '1. a3 c5 *',
      '',
      '[Event "Caro-Kann"]',
      '',
      '1. a3 c6 *',
    ].join('\r\n');
    expect(namesOf(text)).toEqual([header('Najdorf'), header('Caro-Kann')]);
  });

  it('splits games on tags even without a blank line or result', () => {
    const graph = clean('[Event "A"]\n1. a3\n[Event "B"]\n1. h3', 'black');
    expect(graph.chapters.map((c) => c.nameSource)).toEqual([
      header('A'),
      header('B'),
    ]);
    expect(only(graph, 'h3').chapters).toEqual(['c2']);
  });

  it('splits header-less games on their results', () => {
    const graph = clean('1. e4 * 1. d4 1-0', 'black');
    expect(graph.chapters).toHaveLength(2);
    expect(only(graph, 'd4').chapters).toEqual(['c2']);
  });

  it('names games by White, then Black, when Event is shared by every game', () => {
    expect(
      namesOf(
        [
          '[Event "My repertoire"][White "Sicilian"][Black "x"] 1. a3 c5 *',
          '[Event "My repertoire"][White "?"][Black "French"] 1. a3 e6 *',
          '[Event "My repertoire"][White ""][Black ""] 1. a3 e5 *',
        ].join('\n'),
      ),
    ).toEqual([header('Sicilian'), header('French'), index(3)]);
  });

  it('leaves a game unnamed when its headers repeat in other games', () => {
    expect(
      namesOf(
        [
          '[White "Me"][Black "You"] 1. a3 e5 *',
          '[White "Me"][Black "You"] 1. a3 c5 *',
        ].join('\n'),
      ),
    ).toEqual([index(1), index(2)]);
  });

  it('passes over the "?" placeholder when naming a game', () => {
    expect(namesOf('[Event "?"][White "Sicilian"] 1. a3 c5 *')).toEqual([
      header('Sicilian'),
    ]);
  });

  it('trims a header value before naming a game by it', () => {
    expect(namesOf('[Event "  Scotch  "] 1. a3 *')).toEqual([header('Scotch')]);
  });
});

describe('importPgn: broken games beside good ones', () => {
  const skippedOf = (text: string) => imported(text, 'black').skipped;

  it('does not count a stray result as a game', () => {
    expect(skippedOf('1. e4 * * 1. d4 Ke7 *')).toEqual([
      { game: 2, reason: 'pgn.illegalMove', san: 'Ke7' },
    ]);
  });

  it('skips words that are not moves', () => {
    expect(skippedOf('1. e4 *\n\nnot valid pgn at all...')).toEqual([
      { game: 2, reason: 'pgn.illegalMove', san: 'not' },
    ]);
  });

  it('skips a game with an unmatched close of a variation', () => {
    expect(skippedOf('1. d4 *\n\n1. e4 e5) *')).toEqual([
      { game: 2, reason: 'pgn.unbalancedVariation' },
    ]);
  });
});
/** A deterministic string hash, to pick the same answer in the same position. */
function hash(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++)
    h = (h * 31 + text.charCodeAt(i)) % 1_000_003;
  return h;
}

/**
 * `count` annotated games of 30 plies for Black (200 make about 1.9 MB):
 * White's moves are pseudo-random, Black's answer depends only on the
 * position, so no game has a second answer. Thousands of distinct moves,
 * every one with a comment and an arrow.
 */
function bigFile(count: number): string {
  let seed = 12_345;
  const random = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };
  const note = ` { [%cal Ga1a2] ${'n'.repeat(290)} }`;
  const games: string[] = [];
  for (let g = 0; g < count; g++) {
    const chess = new Chess();
    const parts: string[] = [];
    for (let ply = 0; ply < 30; ply++) {
      const legal = chess.moves();
      if (legal.length === 0) break;
      const white = ply % 2 === 0;
      const pick = white
        ? random(legal.length)
        : hash(positionKey(chess.fen())) % legal.length;
      const san = must(legal[pick]);
      chess.move(san);
      parts.push((white ? `${String(ply / 2 + 1)}. ` : '') + san + note);
    }
    games.push(`[Event "G${String(g)}"]\n\n${parts.join(' ')} *`);
  }
  return games.join('\n\n');
}
