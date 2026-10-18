import { describe, expect, it } from 'vitest';
import { destsOf, isKey, pieceAt, squaresOf } from './squares';

describe('isKey', () => {
  it('accepts a board square', () => {
    expect(isKey('e4')).toBe(true);
    expect(isKey('a1')).toBe(true);
    expect(isKey('h8')).toBe(true);
  });

  it('refuses anything that is not exactly one square', () => {
    expect(isKey('i9')).toBe(false);
    expect(isKey('e44')).toBe(false);
    expect(isKey('a0')).toBe(false);
    expect(isKey('xe4')).toBe(false);
    expect(isKey('')).toBe(false);
  });
});

describe('squaresOf', () => {
  it('gives the two squares of a UCI move', () => {
    expect(squaresOf('e2e4')).toEqual(['e2', 'e4']);
  });

  it('drops the promotion piece', () => {
    expect(squaresOf('e7e8q')).toEqual(['e7', 'e8']);
  });

  it('gives no squares for anything else', () => {
    expect(squaresOf('')).toEqual([]);
    expect(squaresOf('e2')).toEqual([]);
    expect(squaresOf('e2z9')).toEqual([]);
  });
});

describe('destsOf', () => {
  const move = (orig: string, dest: string) => ({
    orig,
    dest,
    san: '',
    promotion: null,
  });

  it('groups the destinations by the square moved from', () => {
    expect(
      destsOf([move('g1', 'f3'), move('g1', 'h3'), move('e2', 'e4')]),
    ).toEqual(
      new Map([
        ['g1', ['f3', 'h3']],
        ['e2', ['e4']],
      ]),
    );
  });

  it('lists a destination once when several promotions reach it', () => {
    expect(
      destsOf([
        { orig: 'e7', dest: 'e8', san: 'e8=Q', promotion: 'q' },
        { orig: 'e7', dest: 'e8', san: 'e8=N', promotion: 'n' },
      ]),
    ).toEqual(new Map([['e7', ['e8']]]));
  });

  it('skips a move whose squares are not board squares', () => {
    expect(destsOf([move('z9', 'e4'), move('e2', 'z9')])).toEqual(new Map());
  });
});

describe('pieceAt', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const AFTER_E4_C5 =
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

  it('names the piece on a square by colour and role', () => {
    expect(pieceAt(START, 'e1')).toEqual({ color: 'white', role: 'king' });
    expect(pieceAt(START, 'd8')).toEqual({ color: 'black', role: 'queen' });
    expect(pieceAt(START, 'a1')).toEqual({ color: 'white', role: 'rook' });
    expect(pieceAt(START, 'c8')).toEqual({ color: 'black', role: 'bishop' });
    expect(pieceAt(START, 'g1')).toEqual({ color: 'white', role: 'knight' });
    expect(pieceAt(START, 'h7')).toEqual({ color: 'black', role: 'pawn' });
  });

  it('reads past empty squares in a rank', () => {
    expect(pieceAt(AFTER_E4_C5, 'e4')).toEqual({
      color: 'white',
      role: 'pawn',
    });
    expect(pieceAt(AFTER_E4_C5, 'c5')).toEqual({
      color: 'black',
      role: 'pawn',
    });
    expect(pieceAt(AFTER_E4_C5, 'e2')).toBeNull();
    expect(pieceAt(AFTER_E4_C5, 'c7')).toBeNull();
    expect(pieceAt(AFTER_E4_C5, 'd5')).toBeNull();
  });

  it('finds nothing on an empty board', () => {
    expect(pieceAt('8/8/8/8/8/8/8/8 w - - 0 1', 'a8')).toBeNull();
  });
});
