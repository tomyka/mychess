import { describe, it, expect } from 'vitest';
import { detectOpening, searchOpenings } from './classify';
import type { Opening } from './classify';

const FIXTURE: Opening[] = [
  {
    code: 'B90',
    name: 'Sicilian Defense: Najdorf Variation',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']
  },
  { code: 'B20', name: 'Sicilian Defense', moves: ['e4', 'c5'] },
  { code: 'C20', name: "King's Pawn Game", moves: ['e4', 'e5'] }
];

describe('detectOpening', () => {
  it('returns the longest matching prefix', () => {
    const moves = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'e5'];
    expect(detectOpening(moves, FIXTURE)).toEqual({
      code: 'B90',
      name: 'Sicilian Defense: Najdorf Variation'
    });
  });

  it('falls back to a shorter match when the longer one does not fit', () => {
    const moves = ['e4', 'c5', 'Nc3'];
    expect(detectOpening(moves, FIXTURE)).toEqual({ code: 'B20', name: 'Sicilian Defense' });
  });

  it('returns null when nothing matches', () => {
    expect(detectOpening(['d4', 'd5'], FIXTURE)).toBeNull();
  });

  it('returns null for an empty move list', () => {
    expect(detectOpening([], FIXTURE)).toBeNull();
  });

  it('ignores trailing check/mate annotations when comparing', () => {
    const withCheck: Opening[] = [{ code: 'X00', name: 'Test Check Line', moves: ['e4', 'e5', 'Qh5+'] }];
    expect(detectOpening(['e4', 'e5', 'Qh5+'], withCheck)).toEqual({ code: 'X00', name: 'Test Check Line' });
    expect(detectOpening(['e4', 'e5', 'Qh5'], withCheck)).toEqual({ code: 'X00', name: 'Test Check Line' });

    const withMate: Opening[] = [{ code: 'X01', name: 'Test Mate Line', moves: ['e4', 'e5', 'Qh5#'] }];
    expect(detectOpening(['e4', 'e5', 'Qh5#'], withMate)).toEqual({ code: 'X01', name: 'Test Mate Line' });
    expect(detectOpening(['e4', 'e5', 'Qh5'], withMate)).toEqual({ code: 'X01', name: 'Test Mate Line' });
  });
});

describe('searchOpenings', () => {
  it('matches by name substring, case-insensitive', () => {
    const results = searchOpenings('najdorf', FIXTURE);
    expect(results.map((o) => o.code)).toEqual(['B90']);
  });

  it('matches by code, case-insensitive', () => {
    const results = searchOpenings('b20', FIXTURE);
    expect(results.map((o) => o.code)).toEqual(['B20']);
  });

  it('returns an empty array for a blank query', () => {
    expect(searchOpenings('', FIXTURE)).toEqual([]);
    expect(searchOpenings('   ', FIXTURE)).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchOpenings('zzz-no-match', FIXTURE)).toEqual([]);
  });
});
