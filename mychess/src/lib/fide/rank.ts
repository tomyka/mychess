import type { FidePlayer } from './parse';

export type AgeBracket = 'U8' | 'U10' | 'U12' | 'U14' | 'U16' | 'U18' | 'U20' | '50+' | '65+' | 'open';

export function ageBracket(birthYear: number | null, currentYear: number): AgeBracket | null {
  if (birthYear == null) return null;
  const age = currentYear - birthYear;
  if (age <= 8) return 'U8';
  if (age <= 10) return 'U10';
  if (age <= 12) return 'U12';
  if (age <= 14) return 'U14';
  if (age <= 16) return 'U16';
  if (age <= 18) return 'U18';
  if (age <= 20) return 'U20';
  if (age >= 65) return '65+';
  if (age >= 50) return '50+';
  return 'open';
}

export interface RankedPlayer extends FidePlayer {
  countryRank: number | null;
  ageBracket: AgeBracket | null;
  ageGroupRank: number | null;
}

export function computeRanks(players: FidePlayer[], currentYear: number): RankedPlayer[] {
  const rated = players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.stdRating != null)
    .sort((x, y) => (y.p.stdRating! - x.p.stdRating!) || (x.i - y.i));

  const countryRankById = new Map<string, number>();
  rated.forEach(({ p }, idx) => countryRankById.set(p.fideId, idx + 1));

  const ageGroupRankById = new Map<string, number>();
  const perBracketCount = new Map<AgeBracket, number>();
  for (const { p } of rated) {
    const bracket = ageBracket(p.birthYear, currentYear);
    if (!bracket) continue;
    const next = (perBracketCount.get(bracket) ?? 0) + 1;
    perBracketCount.set(bracket, next);
    ageGroupRankById.set(p.fideId, next);
  }

  return players.map((p) => ({
    ...p,
    countryRank: countryRankById.get(p.fideId) ?? null,
    ageBracket: ageBracket(p.birthYear, currentYear),
    ageGroupRank: ageGroupRankById.get(p.fideId) ?? null,
  }));
}
