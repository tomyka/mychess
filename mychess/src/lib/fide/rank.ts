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
  ageBracket: AgeBracket | null;
  countryRankStandard: number | null;
  countryRankRapid: number | null;
  countryRankBlitz: number | null;
  ageGroupRankStandard: number | null;
  ageGroupRankRapid: number | null;
  ageGroupRankBlitz: number | null;
}

/**
 * Ranks players by one rating: country rank (all players rated in that rating,
 * sorted descending, 1-based) and age-group rank (within each bracket). Ties
 * preserve input order. Players unrated in that rating get no entry.
 */
function rankByRating(
  players: FidePlayer[],
  currentYear: number,
  rating: (p: FidePlayer) => number | null
): { countryRankById: Map<string, number>; ageGroupRankById: Map<string, number> } {
  const rated = players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => rating(p) != null)
    .sort((x, y) => (rating(y.p)! - rating(x.p)!) || (x.i - y.i));

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

  return { countryRankById, ageGroupRankById };
}

export function computeRanks(players: FidePlayer[], currentYear: number): RankedPlayer[] {
  const std = rankByRating(players, currentYear, (p) => p.stdRating);
  const rapid = rankByRating(players, currentYear, (p) => p.rapidRating);
  const blitz = rankByRating(players, currentYear, (p) => p.blitzRating);

  return players.map((p) => ({
    ...p,
    ageBracket: ageBracket(p.birthYear, currentYear),
    countryRankStandard: std.countryRankById.get(p.fideId) ?? null,
    countryRankRapid: rapid.countryRankById.get(p.fideId) ?? null,
    countryRankBlitz: blitz.countryRankById.get(p.fideId) ?? null,
    ageGroupRankStandard: std.ageGroupRankById.get(p.fideId) ?? null,
    ageGroupRankRapid: rapid.ageGroupRankById.get(p.fideId) ?? null,
    ageGroupRankBlitz: blitz.ageGroupRankById.get(p.fideId) ?? null,
  }));
}
