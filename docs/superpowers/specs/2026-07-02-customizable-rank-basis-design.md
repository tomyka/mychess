# Customizable Country-Rank Basis — Design Spec

**Date:** 2026-07-02
**Status:** Approved for planning
**Builds on:** `2026-07-02-fide-lithuania-ranks-design.md`

## Problem

The dashboard "Country rank" and "Age group rank" tiles are computed from the FIDE
**standard** rating only. A player rated in rapid/blitz but unrated in standard (e.g. FIDE ID
12865168: rapid 1663, blitz 1530, standard unrated) sees `––`. Users should be able to choose
which rating drives their ranks.

## Goal

Let a user pick, in Settings, whether their Country-rank and Age-group-rank tiles are computed
from their **standard**, **rapid**, or **blitz** rating.

## Non-goals

- Per-tile independent basis (one setting drives both tiles).
- Ranking against a federation other than Lithuania.
- Fetching new rating data (all three ratings are already imported).
- A basis label/hint on the tiles (tiles keep their current labels).

## Decisions

- The `rank_basis` preference applies to **both** the Country-rank and Age-group-rank tiles.
- Default basis is `standard` (preserves current behaviour).
- Ranks for all three ratings are **precomputed** during the monthly import and stored, rather
  than computed per dashboard load. The import already parses all three ratings; ranking three
  times monthly is cheap and keeps the dashboard read a simple column select.

## Data model

### `profiles` (migration `0016`)
Add:
```sql
alter table public.profiles
  add column if not exists rank_basis text not null default 'standard'
  check (rank_basis in ('standard', 'rapid', 'blitz'));
```

### `fide_players` (migration `0016`)
Replace the two standard-only rank columns with per-rating columns:
```sql
alter table public.fide_players
  add column if not exists country_rank_standard   integer,
  add column if not exists country_rank_rapid      integer,
  add column if not exists country_rank_blitz       integer,
  add column if not exists age_group_rank_standard integer,
  add column if not exists age_group_rank_rapid    integer,
  add column if not exists age_group_rank_blitz    integer;

alter table public.fide_players drop column if exists country_rank;
alter table public.fide_players drop column if exists age_group_rank;
```
`age_bracket` is unchanged (birth-year based, rating-independent).

**Data availability:** after this migration the new columns are null until the import re-runs.
The FIDE import must be re-run (GitHub Action / `npm run fide:import`) to repopulate. Tiles show
`––` in the interim — acceptable.

## Ranking (`src/lib/fide/rank.ts`)

Refactor so ranks are computed once per rating. Introduce a rating selector and a `RatingRanks`
shape.

`RankedPlayer` becomes:
```ts
export interface RankedPlayer extends FidePlayer {
  ageBracket: AgeBracket | null;
  countryRankStandard: number | null;
  countryRankRapid: number | null;
  countryRankBlitz: number | null;
  ageGroupRankStandard: number | null;
  ageGroupRankRapid: number | null;
  ageGroupRankBlitz: number | null;
}
```

Internal helper (pure, tested):
```ts
// Ranks players by the given rating selector: country rank (all rated, desc) and
// age-group rank (within each bracket, desc). Unrated in that rating → null.
function rankByRating(
  players: FidePlayer[],
  currentYear: number,
  rating: (p: FidePlayer) => number | null
): { countryRankById: Map<string, number>; ageGroupRankById: Map<string, number> };
```

`computeRanks(players, currentYear)` calls `rankByRating` three times (standard/rapid/blitz),
computes `ageBracket` once per player, and assembles `RankedPlayer[]`. Ranking semantics per
rating are identical to today's standard behaviour: rated players sorted by that rating
descending get 1-based country ranks; within each age bracket, rated players get 1-based
age-group ranks; players unrated in that rating get `null` for that rating's ranks; ties keep
input order (stable → distinct sequential ranks).

## Import job (`src/lib/fide/import-job.ts`)

Update the upsert row mapping to write the six new columns instead of `country_rank` /
`age_group_rank`:
```ts
country_rank_standard: p.countryRankStandard,
country_rank_rapid: p.countryRankRapid,
country_rank_blitz: p.countryRankBlitz,
age_group_rank_standard: p.ageGroupRankStandard,
age_group_rank_rapid: p.ageGroupRankRapid,
age_group_rank_blitz: p.ageGroupRankBlitz,
```
Everything else (streaming parse, LTU filter, chunked upsert, logging) is unchanged.

## Settings (`src/routes/(kid)/settings/…`)

- **Load** (`+page.server.ts`): return `rankBasis: p?.rank_basis ?? 'standard'`.
- **`save` action:** read `rank_basis` from the form; validate it is one of
  `standard|rapid|blitz` (default to `standard` otherwise); include it in the profiles update.
- **UI** (`+page.svelte`): a labeled `<select name="rank_basis">` in the Profile section with
  options Standard / Rapid / Blitz, bound to `d.rankBasis`. Submits with the existing form.

## Dashboard (`src/routes/(kid)/+page.server.ts`)

- Read `const rankBasis = p?.rank_basis ?? 'standard';`.
- Select the basis-specific columns from `fide_players`:
  `country_rank_${rankBasis}`, `age_group_rank_${rankBasis}`, `age_bracket`.
  (Build the select string from the validated basis; because `rank_basis` is constrained by the
  DB check and re-defaulted in code, only the three known column names are ever interpolated.)
- Map the returned row's `country_rank_<basis>` → `countryRank`, `age_group_rank_<basis>` →
  `ageGroupRank`, `age_bracket` → `ageBracket`. `StatsRow` props and rendering are unchanged.

## Testing

- **`rank.test.ts`:** extend existing tests. `computeRanks` now yields per-rating fields:
  - standard ranking unchanged (existing assertions retargeted to `countryRankStandard` /
    `ageGroupRankStandard`).
  - rapid and blitz ranked independently (a player unrated in standard but rated in rapid gets a
    null `countryRankStandard` and a non-null `countryRankRapid`).
  - unrated-in-a-rating → null for that rating; age-group independence and tie ordering retained.
- **`StatsRow.test.ts`:** unchanged — the component contract (countryRank/ageGroupRank/
  ageBracket props) is the same.
- Settings save/load and dashboard column selection: no unit tests (server load/action, matching
  existing untested pattern); verified manually.

## Error handling

- Invalid/absent `rank_basis` (form or profile) falls back to `standard`.
- Missing `fide_players` row or null rank column → `––` (existing behaviour, unchanged).
- A genuine DB error on the dashboard fide query is logged (existing behaviour).
