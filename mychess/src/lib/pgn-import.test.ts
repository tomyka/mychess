import { describe, it, expect } from 'vitest';
import { planImport } from './pgn-import';

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
});
