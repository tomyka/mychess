import { describe, expect, it } from 'vitest';
import { findLegalMove, inCheck, legalMoves } from './legal-moves';
import { positionKey, START_KEY } from './position-key';

const PROMOTE = positionKey('8/P7/8/8/8/8/8/k6K w - - 0 1');
const CASTLE = positionKey('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');

describe('legalMoves', () => {
  it('gives the 20 opening moves with squares and SAN', () => {
    const moves = legalMoves(START_KEY);
    expect(moves).toHaveLength(20);
    expect(moves).toContainEqual({
      orig: 'g1',
      dest: 'f3',
      san: 'Nf3',
      promotion: null,
    });
  });

  it('gives each promotion piece its own move', () => {
    const promotions = legalMoves(PROMOTE).filter((m) => m.orig === 'a7');
    expect(promotions.map((m) => m.promotion).sort()).toEqual([
      'b',
      'n',
      'q',
      'r',
    ]);
    expect(promotions).toContainEqual({
      orig: 'a7',
      dest: 'a8',
      san: 'a8=Q+',
      promotion: 'q',
    });
  });

  it('gives castling as the king moving two squares', () => {
    expect(legalMoves(CASTLE)).toContainEqual({
      orig: 'e1',
      dest: 'g1',
      san: 'O-O',
      promotion: null,
    });
  });
});

describe('findLegalMove (the typed move)', () => {
  it.each([['Nf3'], ['Nf3+'], ['Nf3!?'], ['g1f3'], [' G1F3 ']])(
    'finds %j',
    (typed) => {
      expect(findLegalMove(START_KEY, typed)).toEqual({
        orig: 'g1',
        dest: 'f3',
        san: 'Nf3',
        promotion: null,
      });
    },
  );

  it('reads 0-0 as O-O', () => {
    expect(findLegalMove(CASTLE, '0-0')?.san).toBe('O-O');
    expect(findLegalMove(CASTLE, '0-0-0')?.san).toBe('O-O-O');
  });

  it('finds a promotion by SAN or by coordinates with the piece', () => {
    expect(findLegalMove(PROMOTE, 'a8=N')?.promotion).toBe('n');
    expect(findLegalMove(PROMOTE, 'a7a8r')?.san).toBe('a8=R+');
    expect(findLegalMove(PROMOTE, 'a7a8')).toBeNull();
  });

  it.each([[''], ['  '], ['Nf6'], ['e5'], ['zz']])(
    'finds nothing for %j',
    (typed) => {
      expect(findLegalMove(START_KEY, typed)).toBeNull();
    },
  );
});

describe('inCheck', () => {
  it('says whether the side to move is in check', () => {
    expect(inCheck(START_KEY)).toBe(false);
    expect(inCheck(positionKey('4k3/8/8/8/8/8/8/4K2r w - - 0 1'))).toBe(true);
  });
});
