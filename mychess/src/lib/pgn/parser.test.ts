import { describe, it, expect } from 'vitest';
import { parsePgn } from '$lib/pgn/parser';

describe('parsePgn', () => {
  it('parses a minimal PGN game', () => {
    const pgn = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0`;

    const games = parsePgn(pgn);
    expect(games).toHaveLength(1);
    expect(games[0].moves).toHaveLength(4);
    expect(games[0].moves[0].san).toBe('e4');
    expect(games[0].moves[0].color).toBe('white');
    expect(games[0].moves[0].ply).toBe(1);
  });

  it('skips invalid PGN blocks', () => {
    const pgn = `not valid pgn at all...`;
    const games = parsePgn(pgn);
    expect(games).toHaveLength(0);
  });

  it('extracts headers', () => {
    const pgn = `[Event "Rapid"]
[White "Alice"]

1. d4 d5 *`;
    const games = parsePgn(pgn);
    expect(games[0].headers['Event']).toBe('Rapid');
    expect(games[0].headers['White']).toBe('Alice');
  });

  it('follows variations and branches from the shared position', () => {
    // Black's reply to 1.e4 has two lines: main 1...e5 and variation 1...c5.
    const pgn = `1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 *`;
    const { moves } = parsePgn(pgn)[0];

    const sans = moves.map((m) => m.san);
    expect(sans).toContain('e5');
    expect(sans).toContain('c5'); // variation move, previously dropped

    // Both replies branch from the same position (after 1.e4).
    const afterE4 = moves.find((m) => m.san === 'e4')!.fen;
    const branchReplies = moves.filter((m) => m.parentFen === afterE4).map((m) => m.san);
    expect(branchReplies.sort()).toEqual(['c5', 'e5']);
  });

  it('each move has correct parentFen and fen', () => {
    const pgn = `1. e4 e5 *`;
    const games = parsePgn(pgn);
    const moves = games[0].moves;
    // parentFen of first move is starting FEN
    expect(moves[0].parentFen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    // fen of first move matches after e4
    expect(moves[0].fen).toContain('pppppppp');
  });
});
