# FIDE Ratings in Player Card — Design Spec

**Date:** 2026-07-02
**Status:** Approved for planning
**Builds on:** `2026-07-02-fide-lithuania-ranks-design.md`, `2026-07-02-customizable-rank-basis-design.md`

## Problem

`PlayerHeader.svelte` shows a single "FIDE Classical" rating badge sourced from `profiles.fide_rating` — a column nothing in the app ever writes, so it's always empty in practice. Meanwhile `fide_players` (the Lithuania FIDE import cache) already holds live Standard, Rapid, and Blitz ratings plus per-type country/age-group ranks for any player with a FIDE ID in that list, but that data currently only surfaces as one rank pair (`StatsRow`) driven by a user-chosen `rank_basis` setting.

## Goal

Show all three FIDE ratings (Standard, Rapid, Blitz) — each with its Lithuania country rank and age-group rank — directly in the player card (`PlayerHeader.svelte`), for any user with a FIDE ID.

## Non-goals

- Ranking against a federation other than Lithuania (same existing limitation as today's ranks).
- Populating `profiles.fide_rating` (stays dead/unused; this feature reads from `fide_players` instead).
- Any change to `fide_players` schema, the import job, or the ranking algorithm — the data already exists.

## Visual design

Card layout (single row: avatar, name, FIDE ID, then up to 3 tiles):

```
┌────────────────────────────────────────────────────────────────────┐
│  ⬤   Tomas Konovalovas          [🕐 STANDARD] [⏱ RAPID] [⚡ BLITZ] │
│ TK   FIDE ID: 1503014              1842          1790       1705   │
│                                   ───────       ───────   ───────  │
│                                   #12 │ #3     #18 │ #5   #24 │ #7 │
│                                   LTU │ AGE     LTU │ AGE   LTU│AGE │
└────────────────────────────────────────────────────────────────────┘
```

Each tile, top to bottom:
1. A small gray SVG icon (clock/stopwatch/bolt) + uppercase type label ("Standard"/"Rapid"/"Blitz")
2. The rating number, large and bold — or **"–"** if the player has no rating for that variant
3. A divider line, then a two-column strip: LTU rank | Age rank, each showing the number or **"N/A"** if missing

All 3 tiles always render whenever `profile.fide_id` is set — individual tiles show placeholders for whatever's missing rather than disappearing. No FIDE ID → unchanged "Link FIDE account →" prompt.

Full name and last name are shown in full (not abbreviated) — this already matches current behavior, since `display_name` is stored as "First Last" and rendered as-is. The avatar circle, however, currently derives initials via `display_name.slice(0, 2)`, which does **not** reliably produce "TK" for "Tomas Konovalovas" (it produces "To"). Since the approved mockup showed proper first+last initials, this is a real fix: derive initials from `first_name`/`last_name` (first letter of each) when both are set, falling back to the existing `display_name.slice(0, 2)` behavior otherwise (e.g. Google-only users without FIDE verification).

## Data source

`fide_players`, keyed by `fide_id`, already has:
- `std_rating`, `rapid_rating`, `blitz_rating`
- `country_rank_standard`, `country_rank_rapid`, `country_rank_blitz`
- `age_group_rank_standard`, `age_group_rank_rapid`, `age_group_rank_blitz`

**Caveat:** this table only contains Lithuanian-federation players (fed by the monthly Lithuania import). A player with a non-Lithuanian FIDE ID, or one not yet in this month's import, has no row — every field in this design falls back to "–"/"N/A" in that case, same as today's single rank pair does.

## Removed as part of this change

- **`StatsRow.svelte`**: drop the "Country rank" and "Age group rank" tiles — fully superseded by the per-type ranks now in the player card. `StatsRow` keeps only the streak tile, rendered as a single centered card rather than 1-of-3 in a grid (the grid no longer makes sense with one tile).
- **`rank_basis` setting**: remove the "Rank based on" field and its logic from `(kid)/settings/+page.svelte` and `+page.server.ts` (`save` action, `load` return), and stop reading `rank_basis` in `(kid)/+page.server.ts`. The `rank_basis` column stays in the `profiles` table, unused — no migration, this is an application-code-only removal.

## Data flow

`(kid)/+page.server.ts`: replace the current `rank_basis`-driven single-column `fide_players` query with one query (still conditional on `p?.fide_id`, still one of the parallel `Promise.all` fetches) selecting:

```
std_rating, rapid_rating, blitz_rating,
country_rank_standard, country_rank_rapid, country_rank_blitz,
age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz
```

Mapped into a `fideRatings` object of shape:

```ts
type FideRatings = {
  standard: { rating: number | null; countryRank: number | null; ageGroupRank: number | null };
  rapid: { rating: number | null; countryRank: number | null; ageGroupRank: number | null };
  blitz: { rating: number | null; countryRank: number | null; ageGroupRank: number | null };
} | null; // null when profile has no fide_id, or no matching fide_players row
```

`fideRatings` is passed to `PlayerHeader` alongside the existing `profile` prop. `age_bracket` is no longer selected (it was only used for `StatsRow`'s "U18 rank" label, which is being removed).

Missing-row handling: a missing `fide_players` row returns Postgres error code `PGRST116` (same pattern already used for the existing FIDE rank fetch) — treated as `fideRatings = null` (all three tiles render, all placeholders), not a logged error. A genuine query failure (any other error code) is logged via `console.error`, same as the existing pattern.

## Component: `PlayerHeader.svelte`

Props become `{ profile: any; fideRatings: FideRatings }`. The component declares its own local `FideRatings`-shaped type (matching the pattern already established by `LichessStatsCard`, which keeps its own local `LichessRatings` type rather than importing a server type) — this keeps the component decoupled from server/load-function code and independently testable.

Rendering logic per tile: rating shows `entry?.rating ?? '–'`; each rank shows `entry?.countryRank ?? 'N/A'` / `entry?.ageGroupRank ?? 'N/A'`. The three tiles are driven by a fixed `[{ key: 'standard', label: 'Standard', icon: ... }, ...]` array so the template isn't repeated three times.

## Testing

- New `PlayerHeader.test.ts` (same `@testing-library/svelte` + jsdom setup already configured for `LichessStatsCard.test.ts`), covering:
  - No FIDE ID → shows the "Link FIDE account" prompt, no tiles.
  - FIDE ID with all three ratings and ranks present → all three tiles show real numbers.
  - FIDE ID with one variant missing (e.g. no blitz rating) → that tile shows "–" and "N/A"/"N/A", others show real numbers.
  - FIDE ID but `fideRatings` is `null` (no `fide_players` row) → all three tiles show "–" / "N/A" / "N/A".
- `StatsRow.test.ts` (already exists): update to drop rank-prop assertions, add coverage for the streak-only single-tile layout.
- No test coverage for the Settings `rank_basis` removal beyond manual verification (matches the existing untested pattern for Settings load/save, per the customizable-rank-basis spec).

## Error handling

- Missing/invalid data at every level (no FIDE ID, no `fide_players` row, individual null rating/rank fields) renders a placeholder — never a thrown error or blank tile.
- A genuine `fide_players` query error is logged via `console.error`, matching the existing dashboard pattern; the page still renders (tiles fall back to placeholders).
