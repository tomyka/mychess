# FIDE Europe Age-Group Rank — Design Spec

**Date:** 2026-08-17
**Status:** Approved for planning
**Scope:** Add a "rank within Europe, among players in the same age bracket" stat to the existing FIDE score cards. Builds on `2026-07-02-fide-lithuania-ranks-design.md`.

## Problem

The FIDE score cards (dashboard `PlayerHeader.svelte` tiles, public `FideLookupCard.svelte` lookup)
currently show a player's national (LTU) rank and national age-group rank, computed by
`runFideImport` from FIDE's monthly global list. Players and coaches also want to see how a
player's rating compares across Europe within their own age bracket (e.g. "where do I stand
among European U16 players"), not just within Lithuania.

The importer's `keep` filter currently discards every non-LTU player during parsing — the
`fide_players` table holds Lithuanian rows only. There is no data today to rank a player against
Europe.

## Goals

- Add a Europe-wide, age-bracket-scoped rank (`europeAgeGroupRank{Standard,Rapid,Blitz}`) to
  both score card surfaces, alongside the existing national rank and national age-group rank.
- Compute it from the same monthly streamed import, without a second download or a materialized
  list of hundreds of thousands of European players.
- Keep `fide_players` storage exactly as it is today (LTU rows only) — this feature adds three
  columns to existing rows, it does not grow the table.

## Non-goals

- An overall (all-ages) Europe rank. Age-group-scoped only, per explicit product decision.
- Storing or upserting non-LTU players. Other Europeans remain unsearchable via the public
  lookup card, same as today.
- Historical tracking of Europe rank over time (only the latest list is retained, same as
  existing ranks).
- Competition-standard tie-breaking for the *national* ranks — those are unchanged. (The new
  Europe rank uses its own, different tie convention — see "Ranking detail" below.)

## Federation scope: what counts as "Europe"

Defined as current European Chess Union (ECU) membership — 54 federations — rather than FIDE's
historical geographic zone grouping. Concretely, **Russia (RUS) is excluded** (suspended from
ECU since 2022), even though it was historically grouped under FIDE's Europe zone. This was a
deliberate, explicit product decision (not an oversight) given Russia's large rated population
would otherwise materially shift everyone else's rank.

`src/lib/fide/federations.ts`:

```ts
export const EUROPEAN_FEDERATIONS: ReadonlySet<string> = new Set([
  'ALB','AND','ARM','AUT','AZE','BLR','BEL','BIH','BUL','CRO','CYP','CZE','DEN','ENG','EST',
  'FAI','FIN','FRA','GEO','GER','GRE','GCI','HUN','ISL','IRL','ISR','ITA','JCI','KOS','LAT',
  'LIE','LTU','LUX','MLT','MDA','MNC','MNE','NED','MKD','NOR','POL','POR','ROU','SMR','SCO',
  'SRB','SVK','SLO','ESP','SWE','SUI','TUR','UKR','WLS'
]); // 54 codes = ECU membership, per europechess.org/federations (Aug 2026). RUS intentionally excluded.

export function isEuropeanFederation(federation: string): boolean {
  return EUROPEAN_FEDERATIONS.has(federation);
}
```

## Architecture

Single streaming pass, unchanged download/parse pipeline and **no changes to `parse.ts`**.
`createFideStreamParser`'s existing `keep(p)` callback is already invoked once for every
successfully-parsed player regardless of what it returns — `drain()` calls it as
`if (p && keep(p)) players.push(p)`, so `keep`'s return value only controls array retention, not
whether it runs. (`import-job.ts` already relies on exactly this today, incrementing `total++`
inside `keep` as a side effect.) That means the accumulator can simply be fed from inside the
existing `keep` callback in `import-job.ts`, with no parser API change:

```
stream players_list.zip
   │
   └─ keep(p):  { if (isEuropeanFederation(p.federation)) europeAcc.add(p); return p.federation === 'LTU'; }
                                                            [O(1) accumulate]   [unchanged: push to ltu[] only for LTU]

after the stream ends:
   europeAcc.finalize()
   ranked = computeRanks(ltu, currentYear)             // unchanged national/age-group ranks
   ranked = attachEuropeRanks(ranked, europeAcc)        // adds 3 new fields
   upsert fide_players (LTU rows only, 3 new columns)
```

**Why counting buckets instead of holding all European players in memory:** a rank only needs
"how many players in this age bracket, for this rating type, have a strictly higher rating" —
a `Map<AgeBracket, Map<ratingValue, count>>` answers that in memory bounded by the number of
*distinct rating values* per bracket (ratings are integers roughly 0–3000, so at most a few
thousand entries per bracket), independent of how many hundreds of thousands of European players
actually exist. This directly avoids the memory failure mode this importer has already hit twice
(see `download.ts`'s and `parse.ts`'s streaming-rewrite comments) — materializing a
Lithuania-sized array is fine; materializing a Europe-sized one previously would not have been.

## Ranking detail

`createEuropeRankAccumulator(currentYear)` — per rating kind (`'standard' | 'rapid' | 'blitz'`),
per `AgeBracket` (same brackets as `ageBracket()`), maintains `Map<rating, count>`.

- **`add(p: FidePlayer)`:** compute `ageBracket(p.birthYear, currentYear)`; if null, skip. For
  each rating kind with a non-null value, increment that bracket's `Map<rating, count>` at the
  player's rating.
- **`finalize()`:** for each (kind, bracket) bucket, sort its distinct ratings descending and
  build a cumulative "count of players strictly above this rating" array — turns each future
  rank lookup into a binary search instead of a per-player linear scan.
- **`rankOf(p: FidePlayer, kind): number | null`:** returns `null` if the player has no bracket
  or no rating for that kind; otherwise `1 + (cumulative count of strictly-higher ratings in that
  player's own bracket)`.

**Tie handling differs from national rank on purpose.** National/age-group rank breaks ties by
list-input order (arbitrary but stable, documented in the original FIDE ranks spec as "simplicity
over competition-style tie handling"). The Europe rank instead uses standard competition ranking:
tied ratings share the same rank (e.g. two players can both be `#42`), because the bucket-counting
approach has no notion of input order to break ties with. This is an acceptable, explicit
divergence — not a defect.

`attachEuropeRanks(players: RankedPlayer[], acc: EuropeRankAccumulator): RankedPlayer[]` maps
`rankOf(p, 'standard'|'rapid'|'blitz')` onto three new fields.

## Storage — migration `0050_fide_europe_age_group_rank.sql`

```sql
alter table public.fide_players
  add column if not exists europe_age_group_rank_standard integer,
  add column if not exists europe_age_group_rank_rapid    integer,
  add column if not exists europe_age_group_rank_blitz    integer;
```

No RLS changes — same public-read, service-role-write policy as the rest of the table.

## Code changes

| File | Change |
|---|---|
| `src/lib/fide/federations.ts` | **New.** `EUROPEAN_FEDERATIONS`, `isEuropeanFederation()`. |
| `src/lib/fide/rank.ts` | Add `createEuropeRankAccumulator(currentYear)`, `attachEuropeRanks()`. Extend `RankedPlayer`, `FideRatingRow`, `FideRatingProfile`, `mapFideRow()` with the 3 new fields. |
| `src/lib/fide/import-job.ts` | Construct the accumulator; call `europeAcc.add(p)` as a side effect inside the existing `keep` callback (no parser change needed — `keep` already runs for every parsed player); call `finalize()` after `streamPlayersList` resolves; wrap `computeRanks(...)` result through `attachEuropeRanks`; add 3 columns to the upsert payload. |
| `supabase/migrations/0050_fide_europe_age_group_rank.sql` | **New.** Column additions above. |
| `src/routes/(player)/+page.server.ts` | Both `fide_players` `select()` calls (dashboard ratings + public `?fide=` lookup) add the 3 new columns; dashboard's `fideRatings` object gains `europeAgeGroupRank` per tile. |
| `src/lib/components/PlayerHeader.svelte` | `FideTypeRatings` gains `europeAgeGroupRank: number | null`. Tile grows from 2 to 3 cells: existing `LTU` / `AGE`, plus new `EUR`. |
| `src/lib/components/FideLookupCard.svelte` | New table row "Europe age-group rank" (label mirrors the existing age-bracket-aware `ageLabel` pattern), shown under the same `{#if p.ageBracket}` guard as the existing age-group row. Uses the new `europeAgeGroupRank{Standard,Rapid,Blitz}` fields. |

## Testing

- `federations.test.ts` — spot-check membership (`LTU`, `GER`, `ENG` in; `RUS`, `USA`, `CHN` out).
- `rank.test.ts` — accumulator: counting across multiple `add()` calls, tie sharing a rank,
  per-bracket isolation (a strong U16 player doesn't affect U18 counts), unrated/no-bracket
  players skipped and return `null` from `rankOf`; `attachEuropeRanks` wiring onto `RankedPlayer`.
- `PlayerHeader.test.ts` — 3rd tile cell renders `europeAgeGroupRank`, or `N/A` when null.
- `FideLookupCard.test.ts` — new row renders under the age-bracket guard, `––` when null.
- `import-job.ts` end-to-end wiring: integration-only, per existing convention (not unit-tested
  directly).

## Error handling

No new failure modes beyond what `2026-07-02-fide-lithuania-ranks-design.md` already covers
(download/parse/upsert errors are unchanged). A player counted by the accumulator but never
looked up (i.e. not LTU) simply never has `rankOf()` called on it — no error path needed there.
