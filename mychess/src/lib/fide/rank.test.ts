import { describe, it, expect } from 'vitest';
import { ageBracket, computeRanks } from './rank';
import type { FidePlayer } from './parse';

describe('ageBracket', () => {
  const YEAR = 2026;

  it('returns null when birth year is null', () => {
    expect(ageBracket(null, YEAR)).toBeNull();
  });

  it('classifies juniors by upper bound of each bracket', () => {
    expect(ageBracket(2019, YEAR)).toBe('U8');
    expect(ageBracket(2018, YEAR)).toBe('U8');
    expect(ageBracket(2017, YEAR)).toBe('U10');
    expect(ageBracket(2016, YEAR)).toBe('U10');
    expect(ageBracket(2014, YEAR)).toBe('U12');
    expect(ageBracket(2012, YEAR)).toBe('U14');
    expect(ageBracket(2010, YEAR)).toBe('U16');
    expect(ageBracket(2008, YEAR)).toBe('U18');
    expect(ageBracket(2006, YEAR)).toBe('U20');
  });

  it('classifies adults between U20 and senior as open', () => {
    expect(ageBracket(2005, YEAR)).toBe('open');
    expect(ageBracket(1977, YEAR)).toBe('open');
  });

  it('classifies seniors, checking 65+ before 50+', () => {
    expect(ageBracket(1976, YEAR)).toBe('50+');
    expect(ageBracket(1962, YEAR)).toBe('50+');
    expect(ageBracket(1961, YEAR)).toBe('65+');
    expect(ageBracket(1950, YEAR)).toBe('65+');
  });
});

function player(overrides: Partial<FidePlayer>): FidePlayer {
  return {
    fideId: '1', name: 'X', federation: 'LTU', sex: 'M',
    birthYear: 1990, stdRating: 2000, rapidRating: null, blitzRating: null,
    ...overrides,
  };
}

describe('computeRanks', () => {
  const YEAR = 2026;

  it('ranks standard-rated players by rating descending', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: 1800 }),
      player({ fideId: 'b', stdRating: 2200 }),
      player({ fideId: 'c', stdRating: 2000 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRank]));
    expect(byId).toEqual({ b: 1, c: 2, a: 3 });
  });

  it('gives players without a standard rating a null country rank', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: 1800 }),
      player({ fideId: 'b', stdRating: null }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRank]));
    expect(byId).toEqual({ a: 1, b: null });
  });

  it('ranks within age brackets independently', () => {
    const ranked = computeRanks([
      player({ fideId: 'kid1', birthYear: 2016, stdRating: 1200 }),
      player({ fideId: 'kid2', birthYear: 2016, stdRating: 1400 }),
      player({ fideId: 'adult', birthYear: 1990, stdRating: 2000 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.ageGroupRank]));
    expect(byId).toEqual({ kid2: 1, kid1: 2, adult: 1 });
  });

  it('gives unrated or bracketless players a null age-group rank', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', birthYear: null, stdRating: 2000 }),
      player({ fideId: 'b', birthYear: 2016, stdRating: null }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.ageGroupRank]));
    expect(byId).toEqual({ a: null, b: null });
  });

  it('breaks ties by preserving input order (distinct sequential ranks)', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: 2000 }),
      player({ fideId: 'b', stdRating: 2000 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRank]));
    expect(byId).toEqual({ a: 1, b: 2 });
  });
});
