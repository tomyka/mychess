import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import { importPgn, type ImportedRepertoire } from './import-pgn';
import { imported, must, START } from './test-support';

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
      r.graph.moves.map((m) => `${m.from}|${m.san}`).sort();
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
    const text = `1. e4 ${'{ " '.repeat(480_000)}\n[Event "x"]\n\n1. e4 *`;
    expect(text.length).toBeGreaterThan(1_900_000);
    const start = performance.now();
    const r = importPgn(text, 'white');
    expect(performance.now() - start).toBeLessThan(1000);
    expect(r).toEqual({ ok: false, refusal: { reason: 'pgn.noValidGames' } });
  });

  it('imports 200 games of about 1.9 MB in linear time', () => {
    const text = bigFile();
    expect(text.length).toBeGreaterThan(1_800_000);
    expect(text.length).toBeLessThan(2 * 1024 * 1024);
    const start = performance.now();
    const r = importPgn(text, 'black');
    expect(performance.now() - start).toBeLessThan(5000);
    expect(r.ok && r.value.skipped).toEqual([]);
    expect(r.ok && r.value.graph.chapters).toHaveLength(200);
    expect(r.ok && r.value.graph.moves.length).toBeGreaterThan(5000);
  }, 30_000);
});

/** A deterministic string hash, to pick the same answer in the same position. */
function hash(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++)
    h = (h * 31 + text.charCodeAt(i)) % 1_000_003;
  return h;
}

/**
 * 200 annotated games of 30 plies for Black: White's moves are pseudo-random,
 * Black's answer depends only on the position, so no game has a second
 * answer. Thousands of distinct moves, every one with a comment and an arrow.
 */
function bigFile(): string {
  let seed = 12_345;
  const random = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % n;
  };
  const note = ` { [%cal Ga1a2] ${'n'.repeat(290)} }`;
  const games: string[] = [];
  for (let g = 0; g < 200; g++) {
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
