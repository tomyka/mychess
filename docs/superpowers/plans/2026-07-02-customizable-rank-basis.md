# Customizable Country-Rank Basis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick in Settings whether their Country-rank and Age-group-rank tiles are computed from their FIDE standard, rapid, or blitz rating.

**Architecture:** Precompute per-rating ranks (standard/rapid/blitz) during the monthly FIDE import and store them in six `fide_players` columns. Add a `rank_basis` preference to `profiles`, editable in Settings. The dashboard load reads the columns matching the user's basis and feeds the existing `StatsRow` tiles.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), TypeScript, Supabase (Postgres), Vitest.

**Working directory:** Paths are relative to the repo root. The SvelteKit app + its `package.json` live in `mychess/`; run all `npm`/`npx` commands from inside `mychess/`.

**Spec:** `docs/superpowers/specs/2026-07-02-customizable-rank-basis-design.md`

---

## Task 1: Per-rating ranking in rank.ts

**Files:**
- Modify: `mychess/src/lib/fide/rank.ts`
- Modify: `mychess/src/lib/fide/rank.test.ts`

Currently `computeRanks` ranks by standard only and `RankedPlayer` has `countryRank` / `ageGroupRank`. This task makes ranking rating-generic and produces per-rating fields.

- [ ] **Step 1: Rewrite the computeRanks tests**

Replace the entire `describe('computeRanks', ...)` block in `mychess/src/lib/fide/rank.test.ts` with this (the `ageBracket` describe block above it and the `player()`/imports stay as they are):

```ts
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
    // Standard: only b is rated.
    expect(byId.a.countryRankStandard).toBeNull();
    expect(byId.b.countryRankStandard).toBe(1);
    // Rapid: a (1663) ranks above b (1500).
    expect(byId.a.countryRankRapid).toBe(1);
    expect(byId.b.countryRankRapid).toBe(2);
    // Blitz: a (1530) ranks above b (1400).
    expect(byId.a.countryRankBlitz).toBe(1);
    expect(byId.b.countryRankBlitz).toBe(2);
  });

  it('ranks within age brackets independently, per rating', () => {
    const ranked = computeRanks([
      player({ fideId: 'kid1', birthYear: 2016, stdRating: 1200, rapidRating: 1000 }),
      player({ fideId: 'kid2', birthYear: 2016, stdRating: 1400, rapidRating: 900 }),
      player({ fideId: 'adult', birthYear: 1990, stdRating: 2000, rapidRating: 2000 }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r]));
    // Standard within U10: kid2 (1400) > kid1 (1200).
    expect(byId.kid2.ageGroupRankStandard).toBe(1);
    expect(byId.kid1.ageGroupRankStandard).toBe(2);
    expect(byId.adult.ageGroupRankStandard).toBe(1);
    // Rapid within U10: kid1 (1000) > kid2 (900).
    expect(byId.kid1.ageGroupRankRapid).toBe(1);
    expect(byId.kid2.ageGroupRankRapid).toBe(2);
  });

  it('gives unrated or bracketless players null ranks for that rating', () => {
    const ranked = computeRanks([
      player({ fideId: 'a', birthYear: null, stdRating: 2000 }),
      player({ fideId: 'b', birthYear: 2016, stdRating: null }),
    ], YEAR);
    const byId = Object.fromEntries(ranked.map(r => [r.fideId, r]));
    expect(byId.a.ageGroupRankStandard).toBeNull(); // no bracket
    expect(byId.b.ageGroupRankStandard).toBeNull(); // unrated in standard
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `mychess/`): `npx vitest run src/lib/fide/rank.test.ts`
Expected: FAIL — `countryRankStandard` etc. are `undefined` (property doesn't exist yet).

- [ ] **Step 3: Rewrite computeRanks and RankedPlayer**

In `mychess/src/lib/fide/rank.ts`, replace the `RankedPlayer` interface and the `computeRanks` function (everything from `export interface RankedPlayer` to the end of the file) with:

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `mychess/`): `npx vitest run src/lib/fide/rank.test.ts`
Expected: PASS (all `ageBracket` and `computeRanks` tests).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/fide/rank.ts mychess/src/lib/fide/rank.test.ts
git commit -m "feat: compute FIDE country/age-group ranks per rating (std/rapid/blitz)"
```

---

## Task 2: Import job writes per-rating rank columns

**Files:**
- Modify: `mychess/src/lib/fide/import-job.ts`

The upsert currently writes `country_rank` / `age_group_rank`. Update it to write the six new columns. `RankedPlayer` no longer has `countryRank` / `ageGroupRank`, so leaving them would be a type error.

- [ ] **Step 1: Update the upsert row mapping**

In `mychess/src/lib/fide/import-job.ts`, find the row object inside the chunk loop and replace these three lines:

```ts
        country_rank: p.countryRank,
        age_bracket: p.ageBracket,
        age_group_rank: p.ageGroupRank,
```

with:

```ts
        age_bracket: p.ageBracket,
        country_rank_standard: p.countryRankStandard,
        country_rank_rapid: p.countryRankRapid,
        country_rank_blitz: p.countryRankBlitz,
        age_group_rank_standard: p.ageGroupRankStandard,
        age_group_rank_rapid: p.ageGroupRankRapid,
        age_group_rank_blitz: p.ageGroupRankBlitz,
```

(The surrounding fields — `fide_id`, `name`, `federation`, `sex`, `birth_year`, `std_rating`, `rapid_rating`, `blitz_rating`, `list_date`, `updated_at` — stay unchanged.)

- [ ] **Step 2: Verify it type-checks**

Run (from `mychess/`): `npm run check`
Expected: no new errors in `src/lib/fide/import-job.ts`. (Known pre-existing errors elsewhere — `auth/**`, `hooks.server.ts`, `lib/supabase/client.ts`, the two `api/*` endpoints' `string|undefined` env pattern — are unrelated.)

- [ ] **Step 3: Run the full suite**

Run (from `mychess/`): `npm test`
Expected: all pass (rank tests updated in Task 1; nothing else affected).

- [ ] **Step 4: Commit**

```bash
git add mychess/src/lib/fide/import-job.ts
git commit -m "feat: upsert per-rating rank columns in FIDE import"
```

---

## Task 3: Database migration

**Files:**
- Create: `mychess/supabase/migrations/0016_rank_basis.sql`

- [ ] **Step 1: Write the migration**

Create `mychess/supabase/migrations/0016_rank_basis.sql`:

```sql
-- Customizable country-rank basis: per-user rating preference + per-rating rank
-- columns on the FIDE player cache.

-- 1. User preference: which rating drives the rank tiles.
alter table public.profiles
  add column if not exists rank_basis text not null default 'standard'
  check (rank_basis in ('standard', 'rapid', 'blitz'));

-- 2. Per-rating rank columns. age_bracket is rating-independent and stays.
alter table public.fide_players
  add column if not exists country_rank_standard   integer,
  add column if not exists country_rank_rapid      integer,
  add column if not exists country_rank_blitz      integer,
  add column if not exists age_group_rank_standard integer,
  add column if not exists age_group_rank_rapid    integer,
  add column if not exists age_group_rank_blitz    integer;

-- 3. Drop the old standard-only rank columns (replaced by *_standard above).
alter table public.fide_players drop column if exists country_rank;
alter table public.fide_players drop column if exists age_group_rank;
```

NOTE: Do not attempt to apply this to a live database (no DB access here). The user applies it, then re-runs the FIDE import to repopulate the new columns.

- [ ] **Step 2: Commit**

```bash
git add mychess/supabase/migrations/0016_rank_basis.sql
git commit -m "feat: add rank_basis preference and per-rating rank columns"
```

---

## Task 4: Settings — load, save, and UI

**Files:**
- Modify: `mychess/src/routes/(kid)/settings/+page.server.ts`
- Modify: `mychess/src/routes/(kid)/settings/+page.svelte`

- [ ] **Step 1: Return the current basis from the load**

In `mychess/src/routes/(kid)/settings/+page.server.ts`, in the `load` function's returned object, add a `rankBasis` field. Change:

```ts
    fideId: p?.fide_id ?? '',
    oauthSuccess: url.searchParams.get('oauth_success') ?? null,
```

to:

```ts
    fideId: p?.fide_id ?? '',
    rankBasis: p?.rank_basis ?? 'standard',
    oauthSuccess: url.searchParams.get('oauth_success') ?? null,
```

- [ ] **Step 2: Read and validate rank_basis in the save action**

In the same file's `save` action, after the line `const fideId = (fd.get('fide_id') as string ?? '').trim();`, add:

```ts
    const rawBasis = (fd.get('rank_basis') as string ?? '').trim();
    const rankBasis = ['standard', 'rapid', 'blitz'].includes(rawBasis) ? rawBasis : 'standard';
```

- [ ] **Step 3: Persist rank_basis in the profiles update**

In the same `save` action, in the `.update({ ... })` object, add `rank_basis` alongside the other fields. Change:

```ts
        fide_id: fideId || null,
        chesscom_username: chesscomUsername || null,
        ...(displayName ? { display_name: displayName } : {})
```

to:

```ts
        fide_id: fideId || null,
        chesscom_username: chesscomUsername || null,
        rank_basis: rankBasis,
        ...(displayName ? { display_name: displayName } : {})
```

- [ ] **Step 4: Add the dropdown to the Settings form**

In `mychess/src/routes/(kid)/settings/+page.svelte`, inside the `<form method="POST" action="?/save" ...>`, after the FIDE ID field's closing `</div>` (the block containing `id="fide_id"` and its helper `<p>`), and before the Chess.com username field, insert:

```svelte
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="rank_basis">Rank based on</label>
          <select
            id="rank_basis"
            name="rank_basis"
            value={d.rankBasis}
            class="w-full bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="standard">Standard</option>
            <option value="rapid">Rapid</option>
            <option value="blitz">Blitz</option>
          </select>
          <p class="text-xs text-gray-400 mt-1">
            Which FIDE rating your country and age-group rank are based on.
          </p>
        </div>
```

- [ ] **Step 5: Verify type-check and manual sanity**

Run (from `mychess/`): `npm run check`
Expected: no new errors in the two settings files.

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(kid)/settings/+page.server.ts" "mychess/src/routes/(kid)/settings/+page.svelte"
git commit -m "feat: add rank basis selector to settings"
```

---

## Task 5: Dashboard reads the basis-specific columns

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.server.ts`

The dashboard currently selects `country_rank, age_group_rank, age_bracket`. Those columns no longer exist (renamed per-rating). Select the columns matching the user's basis.

- [ ] **Step 1: Compute the basis and its column names before the Promise.all**

In `mychess/src/routes/(kid)/+page.server.ts`, find the line `const lichessUsername = p?.lichess_username ?? null;` and add immediately after it:

```ts
  // Which FIDE rating drives the rank tiles (validated; constrains column names below).
  const rawBasis = p?.rank_basis ?? 'standard';
  const rankBasis = ['standard', 'rapid', 'blitz'].includes(rawBasis) ? rawBasis : 'standard';
  const countryRankCol = `country_rank_${rankBasis}`;
  const ageGroupRankCol = `age_group_rank_${rankBasis}`;
```

- [ ] **Step 2: Select the basis-specific columns**

In the same file, in the `fideRes` element of the `Promise.all`, change:

```ts
    p?.fide_id
      ? supabase
          .from('fide_players')
          .select('country_rank, age_group_rank, age_bracket')
          .eq('fide_id', p.fide_id)
          .single()
      : Promise.resolve({ data: null, error: null })
```

to:

```ts
    p?.fide_id
      ? supabase
          .from('fide_players')
          .select(`${countryRankCol}, ${ageGroupRankCol}, age_bracket`)
          .eq('fide_id', p.fide_id)
          .single()
      : Promise.resolve({ data: null, error: null })
```

- [ ] **Step 3: Map the returned columns to the tile props**

In the same file, find:

```ts
  const fide = fideRes.data as any;
  const countryRank: number | null = fide?.country_rank ?? null;
```

and the two lines after it (`ageGroupRank` and `ageBracket`). Replace the three assignment lines:

```ts
  const countryRank: number | null = fide?.country_rank ?? null;
  const ageGroupRank: number | null = fide?.age_group_rank ?? null;
  const ageBracket: string | null = fide?.age_bracket ?? null;
```

with (read by the dynamic column names):

```ts
  const countryRank: number | null = fide?.[countryRankCol] ?? null;
  const ageGroupRank: number | null = fide?.[ageGroupRankCol] ?? null;
  const ageBracket: string | null = fide?.age_bracket ?? null;
```

(The `if (fideRes.error && fideRes.error.code !== 'PGRST116')` block and the `return { ... countryRank, ageGroupRank, ageBracket ... }` fields stay unchanged.)

- [ ] **Step 4: Verify type-check and full test suite**

Run (from `mychess/`): `npm run check`
Expected: no new errors in `src/routes/(kid)/+page.server.ts`.

Run (from `mychess/`): `npm test`
Expected: all pass (140+ including the updated rank tests).

- [ ] **Step 5: Commit**

```bash
git add "mychess/src/routes/(kid)/+page.server.ts"
git commit -m "feat: dashboard shows rank for the user's chosen rating basis"
```

---

## Post-implementation (manual, by the user)

1. Apply migration `0016_rank_basis.sql` (Supabase SQL editor or `db push`).
2. Re-run the FIDE import (GitHub Action *FIDE monthly import*, or `npm run fide:import`) to
   populate the six per-rating rank columns. Until then the tiles show `––`.
3. In Settings, pick a rating basis and confirm the dashboard tiles update.

---

## Self-Review Notes

- **Spec coverage:** preference storage + fide_players columns (Task 3), per-rating ranking
  (Task 1), import mapping (Task 2), settings load/save/UI (Task 4), dashboard basis-driven read
  (Task 5). All spec sections mapped.
- **Type consistency:** `RankedPlayer` per-rating fields defined in Task 1
  (`countryRankStandard/Rapid/Blitz`, `ageGroupRankStandard/Rapid/Blitz`, `ageBracket`) are the
  exact names consumed in Task 2's upsert. DB columns in Task 3 (`country_rank_<basis>`,
  `age_group_rank_<basis>`) match the interpolated names in Tasks 2 and 5. `rank_basis` values
  `standard|rapid|blitz` are consistent across migration check, settings validation, and
  dashboard validation.
- **Security:** the dashboard interpolates only `country_rank_${rankBasis}` /
  `age_group_rank_${rankBasis}` where `rankBasis` is validated against a fixed allowlist, so no
  untrusted string reaches the query.
