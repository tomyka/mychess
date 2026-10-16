import { describe, expect, it } from 'vitest';
import { positionKey } from '../position-key';
import { importPgn } from './import-pgn';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function imported(text: string, side: 'white' | 'black' = 'white') {
  const r = importPgn(text, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

const START = positionKey(
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
);

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
      { kind: 'header', name: 'Italian' },
      { kind: 'header', name: 'Scotch' },
    ]);
    expect(r.value.skipped).toEqual([
      { game: 2, reason: 'pgn.illegalMove', san: 'Ke3' },
    ]);
  });

  it('builds one chapter per good game, sharing the moves they have in common', () => {
    const { graph, skipped } = imported(two);
    expect(skipped).toEqual([
      { game: 2, reason: 'pgn.illegalMove', san: 'Ke3' },
      { game: 3, reason: 'pgn.secondAnswer', san: 'd4' },
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
      { game: 1, reason: 'pgn.secondAnswer', san: 'd4' },
    ]);
  });

  it('skips everything below a second answer', () => {
    const { graph, skipped } = imported('1. e4 (1. d4 d5 2. c4) e5 *');
    expect(graph.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
    expect(skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'd4' },
    ]);
  });

  it('checks the second answer across games and drops a game left empty', () => {
    const { graph, skipped } = imported(
      '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *\n\n[Event "C"]\n\n1. e4 c5 *',
    );
    expect(graph.chapters.map((c) => [c.id, c.nameSource])).toEqual([
      ['c1', { kind: 'header', name: 'A' }],
      ['c2', { kind: 'header', name: 'C' }],
    ]);
    expect(skipped).toEqual([
      { game: 2, reason: 'pgn.secondAnswer', san: 'd4' },
    ]);
  });

  it('checks the second answer for the side the repertoire is for', () => {
    const { graph, skipped } = imported('1. e4 (1. d4) e5 *', 'black');
    expect(skipped).toEqual([]);
    expect(graph.moves.map((m) => m.san)).toEqual(['e4', 'd4', 'e5']);
    const second = imported('1. e4 (1. d4 d5) e5 (1... c5) *', 'black');
    expect(second.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'c5' },
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

  it('names a game no header names by its chapter number', () => {
    const { graph } = imported(
      '[Event "Same"]\n\n1. e4 e5 *\n\n[Event "Same"]\n\n1. e4 c5 *',
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
      { game: 7, reason: 'pgn.secondAnswer', san: 'e4' },
      { game: 8, reason: 'pgn.secondAnswer', san: 'c4' },
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
      { kind: 'header', name: 'A' },
      { kind: 'header', name: 'C {' },
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
});
