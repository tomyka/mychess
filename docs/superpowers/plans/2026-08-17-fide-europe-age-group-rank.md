# FIDE Europe Age-Group Rank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Europe-wide, age-bracket-scoped FIDE rank to both score card surfaces (`PlayerHeader.svelte`, `FideLookupCard.svelte`), computed during the existing monthly import without storing non-Lithuanian players.

**Architecture:** During the single streaming pass over FIDE's global list, every European-federation player (54 ECU federations, Russia excluded) is fed into a bounded-memory bucket-counting accumulator (`Map<AgeBracket, Map<rating, count>>` per rating kind) via the existing `keep` callback in `import-job.ts` — no parser changes needed, since `keep` already runs for every parsed player regardless of its return value. After the stream ends, the accumulator is finalized (sorted + cumulative-summed per bucket) and used to compute each Lithuanian player's rank as `1 + count(strictly higher ratings in their own bracket)`. Only Lithuanian rows are stored, gaining 3 new nullable columns.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, Supabase (Postgres), Vitest, `@testing-library/svelte`.

**Spec:** `docs/superpowers/specs/2026-08-17-fide-europe-age-group-rank-design.md`
**Issue:** tomyka/mychess#74

---

## Task 1: European federation list

**Files:**
- Create: `mychess/src/lib/fide/federations.ts`
- Test: `mychess/src/lib/fide/federations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// mychess/src/lib/fide/federations.test.ts
import { describe, it, expect } from 'vitest';
import { EUROPEAN_FEDERATIONS, isEuropeanFederation } from './federations';

describe('isEuropeanFederation', () => {
  it('includes ECU member federations', () => {
    expect(isEuropeanFederation('LTU')).toBe(true);
    expect(isEuropeanFederation('GER')).toBe(true);
    expect(isEuropeanFederation('ENG')).toBe(true);
  });

  it('excludes non-European federations', () => {
    expect(isEuropeanFederation('USA')).toBe(false);
    expect(isEuropeanFederation('CHN')).toBe(false);
  });

  it('excludes Russia despite historical FIDE Europe zone grouping', () => {
    expect(isEuropeanFederation('RUS')).toBe(false);
  });

  it('has exactly 54 member federations (current ECU membership)', () => {
    expect(EUROPEAN_FEDERATIONS.size).toBe(54);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/fide/federations.test.ts`
Expected: FAIL — `Cannot find module './federations'`

- [ ] **Step 3: Write the implementation**

```ts
// mychess/src/lib/fide/federations.ts
// Current European Chess Union (ECU) membership — 54 federations, per
// europechess.org/federations (checked Aug 2026). Russia is deliberately
// excluded despite FIDE's historical "Europe zone" grouping: it has been
// suspended from the ECU since 2022, and its large rated population would
// otherwise materially shift every other federation's Europe rank.
export const EUROPEAN_FEDERATIONS: ReadonlySet<string> = new Set([
  'ALB', 'AND', 'ARM', 'AUT', 'AZE', 'BLR', 'BEL', 'BIH', 'BUL', 'CRO',
  'CYP', 'CZE', 'DEN', 'ENG', 'EST', 'FAI', 'FIN', 'FRA', 'GEO', 'GER',
  'GRE', 'GCI', 'HUN', 'ISL', 'IRL', 'ISR', 'ITA', 'JCI', 'KOS', 'LAT',
  'LIE', 'LTU', 'LUX', 'MLT', 'MDA', 'MNC', 'MNE', 'NED', 'MKD', 'NOR',
  'POL', 'POR', 'ROU', 'SMR', 'SCO', 'SRB', 'SVK', 'SLO', 'ESP', 'SWE',
  'SUI', 'TUR', 'UKR', 'WLS'
]);

export function isEuropeanFederation(federation: string): boolean {
  return EUROPEAN_FEDERATIONS.has(federation);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fide/federations.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/fide/federations.ts src/lib/fide/federations.test.ts
git commit -m "feat: add European federation list for FIDE rank scoping"
git push
```

---

## Task 2: Europe rank accumulator

**Files:**
- Modify: `mychess/src/lib/fide/rank.ts`
- Test: `mychess/src/lib/fide/rank.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `mychess/src/lib/fide/rank.test.ts` (add the import and the two new `describe` blocks; leave everything already in the file untouched):

```ts
import { ageBracket, computeRanks, createEuropeRankAccumulator, attachEuropeRanks } from './rank';
```

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/fide/rank.test.ts`
Expected: FAIL — `createEuropeRankAccumulator`/`attachEuropeRanks` are not exported

- [ ] **Step 3: Write the implementation**

Append to `mychess/src/lib/fide/rank.ts` (after the existing `computeRanks` function — nothing existing needs to change):

```ts
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
  const buckets: Record<RatingKind, Map<AgeBracket, Map<number, number>>> = {
    standard: new Map(),
    rapid: new Map(),
    blitz: new Map(),
  };
  let finalized: Record<RatingKind, Map<AgeBracket, FinalizedBucket>> | null = null;

  return {
    add(p) {
      const bracket = ageBracket(p.birthYear, currentYear);
      if (!bracket) return;
      for (const kind of ['standard', 'rapid', 'blitz'] as const) {
        const rating = RATING_ACCESSORS[kind](p);
        if (rating == null) continue;
        let byBracket = buckets[kind].get(bracket);
        if (!byBracket) buckets[kind].set(bracket, (byBracket = new Map()));
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
      const bracket = ageBracket(p.birthYear, currentYear);
      if (!bracket) return null;
      const rating = RATING_ACCESSORS[kind](p);
      if (rating == null) return null;
      const bucket = finalized[kind].get(bracket);
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
```

Also extend the DB row/profile types and `mapFideRow`, right where the existing ones are defined:

```ts
export type FideRatingRow = {
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

export function mapFideRow(row: FideRatingRow): FideRatingProfile {
  return {
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
    europeAgeGroupRankBlitz: row.europe_age_group_rank_blitz,
  };
}
```

(This replaces the existing `FideRatingRow`, `FideRatingProfile`, and `mapFideRow` definitions in `rank.ts` — same shape, 3 fields added to each.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/fide/rank.test.ts`
Expected: PASS (all existing + 6 new tests)

- [ ] **Step 5: Type-check**

Run (from `mychess/`): `npm run check`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/fide/rank.ts src/lib/fide/rank.test.ts
git commit -m "feat: add Europe age-group rank accumulator"
git push
```

---

## Task 3: Database migration — REQUIRES USER ACTION

**Files:**
- Create: `mychess/supabase/migrations/0050_fide_europe_age_group_rank.sql`

**Why this is its own task, before any code reads/writes the new columns:** per `CLAUDE.md`, Claude cannot apply Supabase migrations directly in this environment. Task 4 (`import-job.ts`) will start writing these columns and Task 5 (`+page.server.ts`) will start selecting them — both must wait until the columns actually exist in production, or they'll fail at runtime (the `import` job would error out its whole monthly run; the dashboard/lookup queries would 500). Do not proceed past Step 3 below until the user confirms the migration ran.

- [ ] **Step 1: Write the migration file**

```sql
-- mychess/supabase/migrations/0050_fide_europe_age_group_rank.sql
-- Adds the Europe-wide, age-bracket-scoped rank columns. Computed from the
-- same monthly import as the existing country/age-group ranks, but scored
-- against all European-federation players (see src/lib/fide/federations.ts)
-- rather than just Lithuania. Only Lithuanian rows are ever stored here —
-- this does not grow fide_players' row count.
alter table public.fide_players
  add column if not exists europe_age_group_rank_standard integer,
  add column if not exists europe_age_group_rank_rapid    integer,
  add column if not exists europe_age_group_rank_blitz    integer;
```

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/0050_fide_europe_age_group_rank.sql
git commit -m "feat: add fide_players europe age-group rank columns"
git push
```

- [ ] **Step 3: Ask the user to apply it**

Paste the SQL above for the user to run in the Supabase dashboard's SQL editor against production (or trigger the `migrate.yml` GitHub Action, if that's how this repo's migrations are normally applied — check `.github/workflows/` for a `migrate.yml` first). **Wait for the user to confirm it ran successfully before starting Task 4.**

---

## Task 4: Wire the accumulator into the import job

**Files:**
- Modify: `mychess/src/lib/fide/import-job.ts`

No new test file — per this codebase's convention, `import-job.ts` (Supabase I/O orchestration) is exercised through the pure-logic tests in Tasks 1–2 plus manual/integration runs, not unit-tested directly (see `CLAUDE.md`'s "Code split: pure logic vs. Supabase I/O").

- [ ] **Step 1: Update imports and the `keep` callback**

In `mychess/src/lib/fide/import-job.ts`, change:

```ts
import { createClient } from '@supabase/supabase-js';
import { streamPlayersList } from './download';
import { createFideStreamParser } from './parse';
import { computeRanks } from './rank';
```

to:

```ts
import { createClient } from '@supabase/supabase-js';
import { streamPlayersList } from './download';
import { createFideStreamParser } from './parse';
import { computeRanks, createEuropeRankAccumulator, attachEuropeRanks } from './rank';
import { isEuropeanFederation } from './federations';
```

Then change the streaming block from:

```ts
    let total = 0;
    const parser = createFideStreamParser((p) => {
      total++;
      return p.federation === 'LTU';
    });
    await streamPlayersList((chunk) => parser.push(chunk));
    const ltu = parser.finish();
    result.total = total;
    result.ltu = ltu.length;

    const ranked = computeRanks(ltu, currentYear);
    const nowIso = now.toISOString();
```

to:

```ts
    let total = 0;
    const europeAcc = createEuropeRankAccumulator(currentYear);
    const parser = createFideStreamParser((p) => {
      total++;
      // Every European-federation player counts toward the Europe rank
      // pool, even though only Lithuanians are kept in `players` below.
      if (isEuropeanFederation(p.federation)) europeAcc.add(p);
      return p.federation === 'LTU';
    });
    await streamPlayersList((chunk) => parser.push(chunk));
    const ltu = parser.finish();
    result.total = total;
    result.ltu = ltu.length;

    europeAcc.finalize();
    const ranked = attachEuropeRanks(computeRanks(ltu, currentYear), europeAcc);
    const nowIso = now.toISOString();
```

- [ ] **Step 2: Add the 3 new columns to the upsert payload**

Change:

```ts
        age_group_rank_standard: p.ageGroupRankStandard,
        age_group_rank_rapid: p.ageGroupRankRapid,
        age_group_rank_blitz: p.ageGroupRankBlitz,
        list_date: listDate,
        updated_at: nowIso,
```

to:

```ts
        age_group_rank_standard: p.ageGroupRankStandard,
        age_group_rank_rapid: p.ageGroupRankRapid,
        age_group_rank_blitz: p.ageGroupRankBlitz,
        europe_age_group_rank_standard: p.europeAgeGroupRankStandard,
        europe_age_group_rank_rapid: p.europeAgeGroupRankRapid,
        europe_age_group_rank_blitz: p.europeAgeGroupRankBlitz,
        list_date: listDate,
        updated_at: nowIso,
```

- [ ] **Step 3: Type-check and run the full test suite**

Run: `npm run check` — expected: 0 errors
Run: `npm test` — expected: all existing tests still pass (this file has no dedicated tests, but the change must not break anything importing from it)

- [ ] **Step 4: Commit**

```bash
git add src/lib/fide/import-job.ts
git commit -m "feat: compute Europe age-group rank during FIDE import"
git push
```

---

## Task 5: Surface the new rank in page data

**Files:**
- Modify: `mychess/src/routes/(player)/+page.server.ts`

- [ ] **Step 1: Add the 3 columns to both `fide_players` selects**

The public lookup query (around line 34):

```ts
      .select('name, std_rating, rapid_rating, blitz_rating, country_rank_standard, country_rank_rapid, country_rank_blitz, age_bracket, age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz')
```

becomes:

```ts
      .select('name, std_rating, rapid_rating, blitz_rating, country_rank_standard, country_rank_rapid, country_rank_blitz, age_bracket, age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz, europe_age_group_rank_standard, europe_age_group_rank_rapid, europe_age_group_rank_blitz')
```

The dashboard query (around lines 85-89):

```ts
          .select(
            'name, std_rating, rapid_rating, blitz_rating, ' +
            'country_rank_standard, country_rank_rapid, country_rank_blitz, age_bracket, ' +
            'age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz'
          )
```

becomes:

```ts
          .select(
            'name, std_rating, rapid_rating, blitz_rating, ' +
            'country_rank_standard, country_rank_rapid, country_rank_blitz, age_bracket, ' +
            'age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz, ' +
            'europe_age_group_rank_standard, europe_age_group_rank_rapid, europe_age_group_rank_blitz'
          )
```

- [ ] **Step 2: Add `europeAgeGroupRank` to the `fideRatings` object**

Change:

```ts
  const fideRatings = fideProfile
    ? {
        standard: {
          rating: fideProfile.stdRating,
          countryRank: fideProfile.countryRankStandard,
          ageGroupRank: fideProfile.ageGroupRankStandard
        },
        rapid: {
          rating: fideProfile.rapidRating,
          countryRank: fideProfile.countryRankRapid,
          ageGroupRank: fideProfile.ageGroupRankRapid
        },
        blitz: {
          rating: fideProfile.blitzRating,
          countryRank: fideProfile.countryRankBlitz,
          ageGroupRank: fideProfile.ageGroupRankBlitz
        }
      }
    : null;
```

to:

```ts
  const fideRatings = fideProfile
    ? {
        standard: {
          rating: fideProfile.stdRating,
          countryRank: fideProfile.countryRankStandard,
          ageGroupRank: fideProfile.ageGroupRankStandard,
          europeAgeGroupRank: fideProfile.europeAgeGroupRankStandard
        },
        rapid: {
          rating: fideProfile.rapidRating,
          countryRank: fideProfile.countryRankRapid,
          ageGroupRank: fideProfile.ageGroupRankRapid,
          europeAgeGroupRank: fideProfile.europeAgeGroupRankRapid
        },
        blitz: {
          rating: fideProfile.blitzRating,
          countryRank: fideProfile.countryRankBlitz,
          ageGroupRank: fideProfile.ageGroupRankBlitz,
          europeAgeGroupRank: fideProfile.europeAgeGroupRankBlitz
        }
      }
    : null;
```

- [ ] **Step 3: Type-check**

Run: `npm run check`
Expected: 0 errors (this route has no dedicated server test file, per existing convention)

- [ ] **Step 4: Commit**

```bash
git add "src/routes/(player)/+page.server.ts"
git commit -m "feat: pass Europe age-group rank into page data"
git push
```

---

## Task 6: PlayerHeader tile — 3rd cell

**Files:**
- Modify: `mychess/src/lib/components/PlayerHeader.svelte`
- Modify: `mychess/src/lib/components/PlayerHeader.test.ts`

- [ ] **Step 1: Write the failing test changes**

Replace the whole contents of `mychess/src/lib/components/PlayerHeader.test.ts` with:

```ts
// mychess/src/lib/components/PlayerHeader.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import PlayerHeader from './PlayerHeader.svelte';

afterEach(() => cleanup());

const FULL_RATINGS = {
  standard: { rating: 1842, countryRank: 12, ageGroupRank: 3, europeAgeGroupRank: 210 },
  rapid: { rating: 1790, countryRank: 18, ageGroupRank: 5, europeAgeGroupRank: 340 },
  blitz: { rating: 1705, countryRank: 24, ageGroupRank: 7, europeAgeGroupRank: 410 }
};

describe('PlayerHeader', () => {
  it('shows the link-FIDE prompt and no rating tiles when there is no FIDE ID', () => {
    render(PlayerHeader, { props: { profile: { display_name: 'Tomas' }, fideRatings: null } });
    expect(screen.getByText('Link FIDE account →')).toBeTruthy();
    expect(screen.queryByText('Standard')).toBeNull();
  });

  it('derives initials from first_name/last_name when both are set', () => {
    render(PlayerHeader, {
      props: {
        profile: { display_name: 'Tomas Konovalovas', first_name: 'Tomas', last_name: 'Konovalovas' },
        fideRatings: null
      }
    });
    expect(screen.getByText('TK')).toBeTruthy();
  });

  it('falls back to display_name-based initials when first_name/last_name are missing', () => {
    render(PlayerHeader, { props: { profile: { display_name: 'Tomas' }, fideRatings: null } });
    expect(screen.getByText('TO')).toBeTruthy();
  });

  it('shows all three tiles with real numbers when fully rated', () => {
    render(PlayerHeader, {
      props: { profile: { display_name: 'Tomas', fide_id: '1503014' }, fideRatings: FULL_RATINGS }
    });
    expect(screen.getByText('1842')).toBeTruthy();
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.getByText('#210')).toBeTruthy();
    expect(screen.getByText('1790')).toBeTruthy();
    expect(screen.getByText('#18')).toBeTruthy();
    expect(screen.getByText('#5')).toBeTruthy();
    expect(screen.getByText('#340')).toBeTruthy();
    expect(screen.getByText('1705')).toBeTruthy();
    expect(screen.getByText('#24')).toBeTruthy();
    expect(screen.getByText('#7')).toBeTruthy();
    expect(screen.getByText('#410')).toBeTruthy();
  });

  it('shows a dash and N/A for a variant with no rating', () => {
    const ratings = {
      ...FULL_RATINGS,
      blitz: { rating: null, countryRank: null, ageGroupRank: null, europeAgeGroupRank: null }
    };
    render(PlayerHeader, {
      props: { profile: { display_name: 'Tomas', fide_id: '1503014' }, fideRatings: ratings }
    });
    expect(screen.getByText('1842')).toBeTruthy();
    expect(screen.getByText('1790')).toBeTruthy();
    expect(screen.getAllByText('–').length).toBe(1);
    expect(screen.getAllByText('N/A').length).toBe(3);
  });

  it('shows placeholders in all three tiles when fideRatings is null but a FIDE ID exists', () => {
    render(PlayerHeader, {
      props: { profile: { display_name: 'Tomas', fide_id: '1503014' }, fideRatings: null }
    });
    expect(screen.getAllByText('–').length).toBe(3);
    expect(screen.getAllByText('N/A').length).toBe(9);
    expect(screen.getByText('FIDE ID: 1503014')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/components/PlayerHeader.test.ts`
Expected: FAIL — `#210`/`#340`/`#410` not found, and the N/A counts don't match yet (component doesn't render the 3rd cell)

- [ ] **Step 3: Update the component**

In `mychess/src/lib/components/PlayerHeader.svelte`, change the type and empty-tile constant:

```svelte
  type FideTypeRatings = { rating: number | null; countryRank: number | null; ageGroupRank: number | null };
```

to:

```svelte
  type FideTypeRatings = { rating: number | null; countryRank: number | null; ageGroupRank: number | null; europeAgeGroupRank: number | null };
```

and:

```svelte
  const EMPTY_TILE: FideTypeRatings = { rating: null, countryRank: null, ageGroupRank: null };
```

to:

```svelte
  const EMPTY_TILE: FideTypeRatings = { rating: null, countryRank: null, ageGroupRank: null, europeAgeGroupRank: null };
```

Then widen the tile (92px was already tight for 2 stat cells; a 3rd needs more room) and add the new cell. Change:

```svelte
        <div class="w-[92px] text-center bg-(--color-bg) border border-gray-100 rounded-lg px-1 py-2">
```

to:

```svelte
        <div class="w-[124px] text-center bg-(--color-bg) border border-gray-100 rounded-lg px-1 py-2">
```

And change the stats row from:

```svelte
          <div class="flex mt-1 border-t border-(--color-border) pt-1">
            <div class="flex-1 border-r border-(--color-border)">
              <p class="text-[11px] font-semibold text-(--color-text)">{entry.countryRank != null ? `#${entry.countryRank}` : 'N/A'}</p>
              <p class="text-[8px] text-(--color-muted)">LTU</p>
            </div>
            <div class="flex-1">
              <p class="text-[11px] font-semibold text-(--color-text)">{entry.ageGroupRank != null ? `#${entry.ageGroupRank}` : 'N/A'}</p>
              <p class="text-[8px] text-(--color-muted)">AGE</p>
            </div>
          </div>
```

to:

```svelte
          <div class="flex mt-1 border-t border-(--color-border) pt-1">
            <div class="flex-1 border-r border-(--color-border)">
              <p class="text-[11px] font-semibold text-(--color-text)">{entry.countryRank != null ? `#${entry.countryRank}` : 'N/A'}</p>
              <p class="text-[8px] text-(--color-muted)">LTU</p>
            </div>
            <div class="flex-1 border-r border-(--color-border)">
              <p class="text-[11px] font-semibold text-(--color-text)">{entry.ageGroupRank != null ? `#${entry.ageGroupRank}` : 'N/A'}</p>
              <p class="text-[8px] text-(--color-muted)">AGE</p>
            </div>
            <div class="flex-1">
              <p class="text-[11px] font-semibold text-(--color-text)">{entry.europeAgeGroupRank != null ? `#${entry.europeAgeGroupRank}` : 'N/A'}</p>
              <p class="text-[8px] text-(--color-muted)">EUR</p>
            </div>
          </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/components/PlayerHeader.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/PlayerHeader.svelte src/lib/components/PlayerHeader.test.ts
git commit -m "feat: show Europe age-group rank on the dashboard FIDE tiles"
git push
```

---

## Task 7: FideLookupCard — new table row

**Files:**
- Modify: `mychess/src/lib/components/FideLookupCard.svelte`
- Modify: `mychess/src/lib/components/FideLookupCard.test.ts`

- [ ] **Step 1: Write the failing test changes**

Replace the whole contents of `mychess/src/lib/components/FideLookupCard.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
import { goto } from '$app/navigation';

import FideLookupCard from './FideLookupCard.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const player = {
  name: 'Carlsen, Magnus',
  stdRating: 2839, rapidRating: 2828, blitzRating: 2887,
  countryRankStandard: 1, countryRankRapid: 2, countryRankBlitz: 3,
  ageBracket: 'U18', ageGroupRankStandard: 4, ageGroupRankRapid: 5, ageGroupRankBlitz: 6,
  europeAgeGroupRankStandard: 7, europeAgeGroupRankRapid: 8, europeAgeGroupRankBlitz: 9
};

const noBirthYear = {
  name: 'No Birthday',
  stdRating: 1500, rapidRating: null, blitzRating: null,
  countryRankStandard: 10, countryRankRapid: null, countryRankBlitz: null,
  ageBracket: null, ageGroupRankStandard: null, ageGroupRankRapid: null, ageGroupRankBlitz: null,
  europeAgeGroupRankStandard: null, europeAgeGroupRankRapid: null, europeAgeGroupRankBlitz: null
};

describe('FideLookupCard', () => {
  it('renders the FIDE id input', () => {
    render(FideLookupCard, { props: { query: '', result: null } });
    expect(screen.getByLabelText(/FIDE ID/i)).toBeTruthy();
  });

  it('shows ratings for all three chess types', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText('Carlsen, Magnus')).toBeTruthy();
    expect(screen.getByText('2839')).toBeTruthy();
    expect(screen.getByText('2828')).toBeTruthy();
    expect(screen.getByText('2887')).toBeTruthy();
  });

  it('shows national rank for all three types', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('#2')).toBeTruthy();
    expect(screen.getByText('#3')).toBeTruthy();
  });

  it('shows the age-group rank row labelled with the bracket', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText(/^U18 rank$/i)).toBeTruthy();
    expect(screen.getByText('#4')).toBeTruthy();
    expect(screen.getByText('#5')).toBeTruthy();
    expect(screen.getByText('#6')).toBeTruthy();
  });

  it('shows the Europe age-group rank row labelled with the bracket', () => {
    render(FideLookupCard, { props: { query: '1503014', result: { found: true, player } } });
    expect(screen.getByText(/U18 rank \(Europe\)/i)).toBeTruthy();
    expect(screen.getByText('#7')).toBeTruthy();
    expect(screen.getByText('#8')).toBeTruthy();
    expect(screen.getByText('#9')).toBeTruthy();
  });

  it('omits both age-group rows when the bracket is unknown', () => {
    render(FideLookupCard, { props: { query: '9', result: { found: true, player: noBirthYear } } });
    expect(screen.getByText('#10')).toBeTruthy(); // national rank row still present
    expect(screen.queryByText(/U\d+ rank|Age group rank/i)).toBeNull();
  });

  it('shows a not-found message when the id has no record', () => {
    render(FideLookupCard, { props: { query: '999', result: { found: false } } });
    expect(screen.getByText(/No FIDE record/i)).toBeTruthy();
  });

  it('shows a dropdown of name matches and navigates to the selected player', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => ({ results: [{ fideId: '1503014', name: 'Carlsen, Magnus', federation: 'NOR' }] })
    })) as any;

    render(FideLookupCard, { props: { query: '', result: null } });
    await fireEvent.input(screen.getByLabelText(/FIDE ID/i), { target: { value: 'Carlsen' } });

    const item = await screen.findByText(/Carlsen, Magnus/); // waits through debounce + fetch
    await fireEvent.click(item);
    expect(goto).toHaveBeenCalledWith('/?fide=1503014');
  });
});
```

(Note: the existing "shows the age-group rank row" test's matcher changed from `/U18 rank/i` to `/^U18 rank$/i` — otherwise it would also match the new "U18 rank (Europe)" row's text, which defeats the point of having two distinct assertions.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/components/FideLookupCard.test.ts`
Expected: FAIL — no "U18 rank (Europe)" text, `#7`/`#8`/`#9` not found

- [ ] **Step 3: Update the component**

In `mychess/src/lib/components/FideLookupCard.svelte`, extend the `player` type in the `$props<...>()` call:

```ts
  let { query = '', result = null } = $props<{
    query?: string;
    result?: { found: boolean; player?: {
      name: string;
      stdRating: number | null; rapidRating: number | null; blitzRating: number | null;
      countryRankStandard: number | null; countryRankRapid: number | null; countryRankBlitz: number | null;
      ageBracket: string | null;
      ageGroupRankStandard: number | null; ageGroupRankRapid: number | null; ageGroupRankBlitz: number | null;
    } } | null;
  }>();
```

to:

```ts
  let { query = '', result = null } = $props<{
    query?: string;
    result?: { found: boolean; player?: {
      name: string;
      stdRating: number | null; rapidRating: number | null; blitzRating: number | null;
      countryRankStandard: number | null; countryRankRapid: number | null; countryRankBlitz: number | null;
      ageBracket: string | null;
      ageGroupRankStandard: number | null; ageGroupRankRapid: number | null; ageGroupRankBlitz: number | null;
      europeAgeGroupRankStandard: number | null; europeAgeGroupRankRapid: number | null; europeAgeGroupRankBlitz: number | null;
    } } | null;
  }>();
```

Add a derived label next to the existing `ageLabel`:

```ts
  const ageLabel = $derived(
    p?.ageBracket && p.ageBracket !== 'open' ? `${p.ageBracket} rank` : 'Age group rank'
  );
```

to:

```ts
  const ageLabel = $derived(
    p?.ageBracket && p.ageBracket !== 'open' ? `${p.ageBracket} rank` : 'Age group rank'
  );
  const europeAgeLabel = $derived(
    p?.ageBracket && p.ageBracket !== 'open' ? `${p.ageBracket} rank (Europe)` : 'Age group rank (Europe)'
  );
```

Add the new row right after the existing age-group row (same `{#if p.ageBracket}` block):

```svelte
            {#if p.ageBracket}
              <tr>
                <td class="text-left text-(--color-muted) py-1">{ageLabel}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankStandard)}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankRapid)}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankBlitz)}</td>
              </tr>
            {/if}
```

to:

```svelte
            {#if p.ageBracket}
              <tr>
                <td class="text-left text-(--color-muted) py-1">{ageLabel}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankStandard)}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankRapid)}</td>
                <td class="text-right text-(--color-text)">{rank(p.ageGroupRankBlitz)}</td>
              </tr>
              <tr>
                <td class="text-left text-(--color-muted) py-1">{europeAgeLabel}</td>
                <td class="text-right text-(--color-text)">{rank(p.europeAgeGroupRankStandard)}</td>
                <td class="text-right text-(--color-text)">{rank(p.europeAgeGroupRankRapid)}</td>
                <td class="text-right text-(--color-text)">{rank(p.europeAgeGroupRankBlitz)}</td>
              </tr>
            {/if}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/components/FideLookupCard.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/FideLookupCard.svelte src/lib/components/FideLookupCard.test.ts
git commit -m "feat: show Europe age-group rank on the FIDE lookup card"
git push
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run (from `mychess/`): `npm test`
Expected: all test files pass, no regressions

- [ ] **Step 2: Run the full type/Svelte check**

Run: `npm run check`
Expected: 0 errors

- [ ] **Step 3: Confirm the migration is live**

Ask the user to confirm `0050_fide_europe_age_group_rank.sql` (Task 3) has actually been applied to production, if they haven't already confirmed it earlier in this session.

- [ ] **Step 4: Optional — trigger an immediate backfill**

The new columns will populate automatically on the next monthly cron run, but the user may want the score cards to show real numbers sooner. Two ways to trigger it immediately, per the existing `2026-07-02-fide-lithuania-ranks-design.md`:
- `npm run fide:import` locally (needs `PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in the environment), or
- `POST /api/fide/import` with the `CRON_SECRET` bearer token.

This step is optional and doesn't block calling the feature done — just flag it to the user as a choice.
