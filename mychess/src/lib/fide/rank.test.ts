import { describe, it, expect } from 'vitest';
import { ageBracket, computeRanks, createEuropeRankAccumulator, attachEuropeRanks } from './rank';
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
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRankStandard]));
    expect(byId).toEqual({ b: 1, c: 2, a: 3 });
  });

  it('gives players without a standard rating a null standard country rank', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: 1800 }),
      player({ fideId: 'b', stdRating: null }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRankStandard]));
    expect(byId).toEqual({ a: 1, b: null });
  });

  it('ranks rapid and blitz independently of standard', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: null, rapidRating: 1663, blitzRating: 1530 }),
      player({ fideId: 'b', stdRating: 2000, rapidRating: 1500, blitzRating: 1400 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r]));
    expect(byId.a.countryRankStandard).toBeNull();
    expect(byId.b.countryRankStandard).toBe(1);
    expect(byId.a.countryRankRapid).toBe(1);
    expect(byId.b.countryRankRapid).toBe(2);
    expect(byId.a.countryRankBlitz).toBe(1);
    expect(byId.b.countryRankBlitz).toBe(2);
  });

  it('ranks within age brackets independently, per rating', () => {
    const ranked = computeRanks([
      player({ fideId: 'player1', birthYear: 2016, stdRating: 1200, rapidRating: 1000 }),
      player({ fideId: 'player2', birthYear: 2016, stdRating: 1400, rapidRating: 900 }),
      player({ fideId: 'adult', birthYear: 1990, stdRating: 2000, rapidRating: 2000 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r]));
    expect(byId.player2.ageGroupRankStandard).toBe(1);
    expect(byId.player1.ageGroupRankStandard).toBe(2);
    expect(byId.adult.ageGroupRankStandard).toBe(1);
    expect(byId.player1.ageGroupRankRapid).toBe(1);
    expect(byId.player2.ageGroupRankRapid).toBe(2);
  });

  it('gives unrated or bracketless players null ranks for that rating', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', birthYear: null, stdRating: 2000 }),
      player({ fideId: 'b', birthYear: 2016, stdRating: null }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r]));
    expect(byId.a.ageGroupRankStandard).toBeNull();
    expect(byId.b.ageGroupRankStandard).toBeNull();
    expect(byId.b.countryRankStandard).toBeNull();
  });

  it('assigns the age bracket once, regardless of rating', () => {
    const ranked = computeRanks([player({ fideId: 'a', birthYear: 2016 })], YEAR);
    expect(ranked[0].ageBracket).toBe('U10');
  });

  it('breaks ties by preserving input order (distinct sequential ranks)', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', stdRating: 2000 }),
      player({ fideId: 'b', stdRating: 2000 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r.countryRankStandard]));
    expect(byId).toEqual({ a: 1, b: 2 });
  });
});

describe('createEuropeRankAccumulator', () => {
  const YEAR = 2026;

  it('ranks by count of strictly-higher ratings within the same bracket', () => {
    const acc = createEuropeRankAccumulator(YEAR);
    const players = [
      player({ fideId: 'a', birthYear: 2010, stdRating: 1800 }), // U16
      player({ fideId: 'b', birthYear: 2010, stdRating: 2200 }),
      player({ fideId: 'c', birthYear: 2010, stdRating: 2000 })
    ];
    players.forEach((p) => acc.add(p));
    acc.finalize();
    expect(acc.rankOf(players[1], 'standard')).toBe(1); // 2200
    expect(acc.rankOf(players[2], 'standard')).toBe(2); // 2000
    expect(acc.rankOf(players[0], 'standard')).toBe(3); // 1800
  });

  it('gives tied ratings the same rank', () => {
    const acc = createEuropeRankAccumulator(YEAR);
    const players = [
      player({ fideId: 'a', birthYear: 2010, stdRating: 2000 }),
      player({ fideId: 'b', birthYear: 2010, stdRating: 2000 })
    ];
    players.forEach((p) => acc.add(p));
    acc.finalize();
    expect(acc.rankOf(players[0], 'standard')).toBe(1);
    expect(acc.rankOf(players[1], 'standard')).toBe(1);
  });

  it('keeps age brackets independent', () => {
    const acc = createEuropeRankAccumulator(YEAR);
    const u16 = player({ fideId: 'junior', birthYear: 2010, stdRating: 2200 });
    const adult = player({ fideId: 'adult', birthYear: 1990, stdRating: 1000 });
    [u16, adult].forEach((p) => acc.add(p));
    acc.finalize();
    expect(acc.rankOf(u16, 'standard')).toBe(1);
    expect(acc.rankOf(adult, 'standard')).toBe(1);
  });

  it('returns null for players with no bracket or no rating for that kind', () => {
    const acc = createEuropeRankAccumulator(YEAR);
    const noBracket = player({ fideId: 'a', birthYear: null, stdRating: 2000 });
    const unrated = player({ fideId: 'b', birthYear: 2010, stdRating: null });
    [noBracket, unrated].forEach((p) => acc.add(p));
    acc.finalize();
    expect(acc.rankOf(noBracket, 'standard')).toBeNull();
    expect(acc.rankOf(unrated, 'standard')).toBeNull();
  });

  it('ranks each rating kind independently', () => {
    const acc = createEuropeRankAccumulator(YEAR);
    const a = player({ fideId: 'a', birthYear: 2010, stdRating: 1000, rapidRating: 2000 });
    const b = player({ fideId: 'b', birthYear: 2010, stdRating: 2000, rapidRating: 1000 });
    [a, b].forEach((p) => acc.add(p));
    acc.finalize();
    expect(acc.rankOf(a, 'standard')).toBe(2);
    expect(acc.rankOf(b, 'standard')).toBe(1);
    expect(acc.rankOf(a, 'rapid')).toBe(1);
    expect(acc.rankOf(b, 'rapid')).toBe(2);
  });

  it('throws if rankOf is called before finalize', () => {
    const acc = createEuropeRankAccumulator(YEAR);
    expect(() => acc.rankOf(player({ fideId: 'a' }), 'standard')).toThrow();
  });
});

describe('attachEuropeRanks', () => {
  it('attaches europe age-group ranks onto each ranked player, scored against the wider European pool', () => {
    const YEAR = 2026;
    const ltu = [player({ fideId: 'ltu1', birthYear: 2010, stdRating: 1800 })];

    const acc = createEuropeRankAccumulator(YEAR);
    // A stronger German junior who is never stored, but still counts toward the Europe rank.
    acc.add(player({ fideId: 'ger1', federation: 'GER', birthYear: 2010, stdRating: 2200 }));
    ltu.forEach((p) => acc.add(p));
    acc.finalize();

    const ranked = computeRanks(ltu, YEAR);
    const withEurope = attachEuropeRanks(ranked, acc);
    expect(withEurope[0].europeAgeGroupRankStandard).toBe(2);
    expect(withEurope[0].europeAgeGroupRankRapid).toBeNull(); // unrated in rapid
  });
});
