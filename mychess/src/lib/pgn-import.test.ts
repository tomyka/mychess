import { describe, it, expect } from 'vitest';
import { planImport, planGameImport, resolvePlayerColor } from './pgn-import';

describe('planImport', () => {
  it('returns an error for a PGN with no valid games', () => {
    const result = planImport('not a real pgn', 'white');
    expect(result).toEqual({ error: 'No valid games found in PGN' });
  });

  it('marks white moves as is_player_turn for a white repertoire', () => {
    const result = planImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.gameCount).toBe(1);
    expect(result.moves).toHaveLength(2);
    expect(result.moves[0]).toMatchObject({ san: 'e4', move_number: 1, is_player_turn: true });
    expect(result.moves[1]).toMatchObject({ san: 'e5', move_number: 2, is_player_turn: false });
  });

  it('marks black moves as is_player_turn for a black repertoire', () => {
    const result = planImport('1. e4 e5 *', 'black');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.moves[0]).toMatchObject({ san: 'e4', is_player_turn: false });
    expect(result.moves[1]).toMatchObject({ san: 'e5', is_player_turn: true });
  });

  it('carries the from/to FEN pair for each move', () => {
    const result = planImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.moves[0].fromFen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(result.moves[0].toFen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(result.moves[1].fromFen).toBe(result.moves[0].toFen);
  });

  it('returns an error for a PGN with headers but no actual moves', () => {
    const result = planImport('[Event "test"]\n\n*', 'white');
    expect(result).toEqual({ error: 'No valid games found in PGN' });
  });

  it('merges two games sharing an opening into one set of move rows with matching FENs', () => {
    const twoGames = '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. e4 e5 2. Nf3 *';
    const result = planImport(twoGames, 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.gameCount).toBe(2);
    // Both games start with the same e4/e5 sequence — the shared edges must
    // produce byte-identical FEN pairs, since a later IO layer deduplicates
    // by upserting on (repertoire_id, from_position, san).
    const firstGameE4 = result.moves[0];
    const secondGameE4 = result.moves.find((m, i) => i > 1 && m.san === 'e4');
    expect(secondGameE4).toBeDefined();
    expect(secondGameE4!.fromFen).toBe(firstGameE4.fromFen);
    expect(secondGameE4!.toFen).toBe(firstGameE4.toFen);
  });
});

describe('planImport opening detection', () => {
  it('detects a known opening from the first game', () => {
    const result = planImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.ecoCode).toBe('C20');
    expect(result.ecoName).toBe("King's Pawn Game");
  });

  it('leaves ecoCode/ecoName null when no opening matches', () => {
    const result = planImport('1. a3 a5 *', 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.ecoCode).toBeNull();
    expect(result.ecoName).toBeNull();
  });

  it('falls back to the first game with real moves when an earlier game is header-only', () => {
    const pgn = '[Event "A"]\n\n*\n\n[Event "B"]\n\n1. e4 e5 *';
    const result = planImport(pgn, 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.ecoCode).toBe('C20');
  });
});

describe('resolvePlayerColor', () => {
  it('matches the White header case-insensitively', () => {
    expect(resolvePlayerColor({ White: 'MagnusCarlsen', Black: 'someoneElse' }, 'magnuscarlsen')).toBe('white');
  });

  it('matches the Black header case-insensitively', () => {
    expect(resolvePlayerColor({ White: 'someoneElse', Black: 'MagnusCarlsen' }, 'magnuscarlsen')).toBe('black');
  });

  it('returns null when neither side matches', () => {
    expect(resolvePlayerColor({ White: 'a', Black: 'b' }, 'c')).toBeNull();
  });
});

describe('planGameImport', () => {
  it('returns null when no game matches the username', () => {
    const pgn = '[White "alice"]\n[Black "bob"]\n\n1. e4 e5 *';
    expect(planGameImport(pgn, 'carol')).toBeNull();
  });

  it('resolves is_player_turn per game from whichever side matches the username', () => {
    const pgn =
      '[White "carol"]\n[Black "bob"]\n\n1. e4 e5 *\n\n[White "bob"]\n[Black "carol"]\n\n1. d4 d5 *';
    const result = planGameImport(pgn, 'carol');
    expect(result).not.toBeNull();
    expect(result!.matchedGameCount).toBe(2);
    // Game 1: carol is White — her move (e4) is the player move.
    expect(result!.moves[0]).toMatchObject({ san: 'e4', is_player_turn: true });
    expect(result!.moves[1]).toMatchObject({ san: 'e5', is_player_turn: false });
    // Game 2: carol is Black — her move (d5) is the player move.
    expect(result!.moves[2]).toMatchObject({ san: 'd4', is_player_turn: false });
    expect(result!.moves[3]).toMatchObject({ san: 'd5', is_player_turn: true });
    expect(result!.studiedColor).toBe('white'); // from the first matched game
  });

  it('skips games where neither side matches, keeping only the matched ones', () => {
    const pgn =
      '[White "alice"]\n[Black "bob"]\n\n1. e4 e5 *\n\n[White "carol"]\n[Black "bob"]\n\n1. d4 d5 *';
    const result = planGameImport(pgn, 'carol');
    expect(result).not.toBeNull();
    expect(result!.matchedGameCount).toBe(1);
    expect(result!.moves).toHaveLength(2);
    expect(result!.moves[0].san).toBe('d4');
  });
});
