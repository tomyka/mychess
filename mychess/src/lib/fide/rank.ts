import type { FidePlayer } from './parse';

export type AgeBracket = string;

// One age per bracket, labelled by the player's next birthday ("under
// that age") -- matches FIDE's own ranking tool (rankings.phtml), which
// takes an exact age (age1=N&age2=N), not a span. This used to be a 2-year
// band (U12 meant ages 11 AND 12 pooled together), which materially
// inflated everyone's age-group rank compared to FIDE's own numbers.
export function ageBracket(birthYear: number | null, currentYear: number): AgeBracket | null {
  if (birthYear == null) return null;
  const age = currentYear - birthYear;
  if (age <= 20) return `U${age + 1}`;
  if (age >= 65) return '65+';
  if (age >= 50) return '50+';
  return 'open';
}

/** 'M'/'F' (case/whitespace-insensitive), or null for anything else -- unset, unrecognized, etc. */
function normalizedSex(sex: string | null): 'M' | 'F' | null {
  const s = sex?.trim().toUpperCase();
  return s === 'M' || s === 'F' ? s : null;
}

/**
 * The bucket a player's age-group rank is computed within: age bracket AND
 * sex. Competitive age-group ranking is always gender-split (FIDE's own
 * rankings tool requires picking M or F) -- this used to ignore sex
 * entirely, pooling boys and girls together. A player with no recognizable
 * sex gets no age-group rank at all (returns null), same as one with no
 * birth year.
 */
function ageGroupKey(birthYear: number | null, sex: string | null, currentYear: number): string | null {
  const bracket = ageBracket(birthYear, currentYear);
  const normSex = normalizedSex(sex);
  if (!bracket || !normSex) return null;
  return `${bracket}|${normSex}`;
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
  const perBracketCount = new Map<string, number>();
  for (const { p } of rated) {
    const key = ageGroupKey(p.birthYear, p.sex, currentYear);
    if (!key) continue;
    const next = (perBracketCount.get(key) ?? 0) + 1;
    perBracketCount.set(key, next);
    ageGroupRankById.set(p.fideId, next);
  }

  return { countryRankById, ageGroupRankById };
}

/** A `fide_players` row's rating/rank columns, as selected from the DB (snake_case). */
export type FideRatingRow = {
  fide_id: string;
  name: string;
  std_rating: number | null;
  rapid_rating: number | null;
  blitz_rating: number | null;
  country_rank_standard: number | null;
  country_rank_rapid: number | null;
  country_rank_blitz: number | null;
  age_bracket: string | null;
  age_group_rank_standard: number | null;
  age_group_rank_rapid: number | null;
  age_group_rank_blitz: number | null;
  europe_age_group_rank_standard: number | null;
  europe_age_group_rank_rapid: number | null;
  europe_age_group_rank_blitz: number | null;
};

export type FideRatingProfile = {
  fideId: string;
  name: string;
  stdRating: number | null;
  rapidRating: number | null;
  blitzRating: number | null;
  countryRankStandard: number | null;
  countryRankRapid: number | null;
  countryRankBlitz: number | null;
  ageBracket: string | null;
  ageGroupRankStandard: number | null;
  ageGroupRankRapid: number | null;
  ageGroupRankBlitz: number | null;
  europeAgeGroupRankStandard: number | null;
  europeAgeGroupRankRapid: number | null;
  europeAgeGroupRankBlitz: number | null;
};

/** Maps a `fide_players` row's snake_case rating/rank columns to camelCase. */
export function mapFideRow(row: FideRatingRow): FideRatingProfile {
  return {
    fideId: row.fide_id,
    name: row.name,
    stdRating: row.std_rating,
    rapidRating: row.rapid_rating,
    blitzRating: row.blitz_rating,
    countryRankStandard: row.country_rank_standard,
    countryRankRapid: row.country_rank_rapid,
    countryRankBlitz: row.country_rank_blitz,
    ageBracket: row.age_bracket,
    ageGroupRankStandard: row.age_group_rank_standard,
    ageGroupRankRapid: row.age_group_rank_rapid,
    ageGroupRankBlitz: row.age_group_rank_blitz,
    europeAgeGroupRankStandard: row.europe_age_group_rank_standard,
    europeAgeGroupRankRapid: row.europe_age_group_rank_rapid,
    europeAgeGroupRankBlitz: row.europe_age_group_rank_blitz
  };
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

export type RatingKind = 'standard' | 'rapid' | 'blitz';

const RATING_ACCESSORS: Record<RatingKind, (p: FidePlayer) => number | null> = {
  standard: (p) => p.stdRating,
  rapid: (p) => p.rapidRating,
  blitz: (p) => p.blitzRating,
};

interface FinalizedBucket {
  /** Distinct ratings observed in this (kind, bracket), sorted descending. */
  ratingsDesc: number[];
  /** cumAbove[i] = count of players with a rating strictly greater than ratingsDesc[i]. */
  cumAbove: number[];
}

export interface RankedPlayerWithEurope extends RankedPlayer {
  europeAgeGroupRankStandard: number | null;
  europeAgeGroupRankRapid: number | null;
  europeAgeGroupRankBlitz: number | null;
}

export interface EuropeRankAccumulator {
  /** Feed one European-federation player's ratings into the running counts. */
  add(p: FidePlayer): void;
  /** Freezes the counts into a queryable form. Call once, after all `add()` calls. */
  finalize(): void;
  /** Europe-wide rank within `p`'s own age bracket for one rating kind, or null if `p` has no bracket or no rating of that kind. */
  rankOf(p: FidePlayer, kind: RatingKind): number | null;
}

function rankFromFinalizedBucket(bucket: FinalizedBucket, rating: number): number | null {
  // Binary search a descending array: values to the left are larger, so when
  // ratingsDesc[mid] is greater than the target the target (if present) is
  // further right.
  let lo = 0;
  let hi = bucket.ratingsDesc.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bucket.ratingsDesc[mid] === rating) return bucket.cumAbove[mid] + 1;
    if (bucket.ratingsDesc[mid] > rating) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/**
 * Ranks players against the full European rated population using O(distinct
 * rating values) memory per (rating kind, age bracket) bucket, rather than
 * retaining every European player in memory — see the design spec for why
 * that distinction matters at FIDE's scale.
 */
export function createEuropeRankAccumulator(currentYear: number): EuropeRankAccumulator {
  // Keyed by "bracket|sex" (see ageGroupKey), not just the age bracket.
  const buckets: Record<RatingKind, Map<string, Map<number, number>>> = {
    standard: new Map(),
    rapid: new Map(),
    blitz: new Map(),
  };
  let finalized: Record<RatingKind, Map<string, FinalizedBucket>> | null = null;

  return {
    add(p) {
      const key = ageGroupKey(p.birthYear, p.sex, currentYear);
      if (!key) return;
      for (const kind of ['standard', 'rapid', 'blitz'] as const) {
        const rating = RATING_ACCESSORS[kind](p);
        if (rating == null) continue;
        let byBracket = buckets[kind].get(key);
        if (!byBracket) buckets[kind].set(key, (byBracket = new Map()));
        byBracket.set(rating, (byBracket.get(rating) ?? 0) + 1);
      }
    },

    finalize() {
      finalized = { standard: new Map(), rapid: new Map(), blitz: new Map() };
      for (const kind of ['standard', 'rapid', 'blitz'] as const) {
        for (const [bracket, counts] of buckets[kind]) {
          const ratingsDesc = [...counts.keys()].sort((a, b) => b - a);
          const cumAbove: number[] = [];
          let running = 0;
          for (const rating of ratingsDesc) {
            cumAbove.push(running);
            running += counts.get(rating)!;
          }
          finalized[kind].set(bracket, { ratingsDesc, cumAbove });
        }
      }
    },

    rankOf(p, kind) {
      if (!finalized) throw new Error('EuropeRankAccumulator.rankOf() called before finalize()');
      const key = ageGroupKey(p.birthYear, p.sex, currentYear);
      if (!key) return null;
      const rating = RATING_ACCESSORS[kind](p);
      if (rating == null) return null;
      const bucket = finalized[kind].get(key);
      if (!bucket) return null;
      return rankFromFinalizedBucket(bucket, rating);
    },
  };
}

/** Attaches each player's Europe age-group rank, computed against `acc` (which must already be finalized). */
export function attachEuropeRanks(
  players: RankedPlayer[],
  acc: EuropeRankAccumulator
): RankedPlayerWithEurope[] {
  return players.map((p) => ({
    ...p,
    europeAgeGroupRankStandard: acc.rankOf(p, 'standard'),
    europeAgeGroupRankRapid: acc.rankOf(p, 'rapid'),
    europeAgeGroupRankBlitz: acc.rankOf(p, 'blitz'),
  }));
}
