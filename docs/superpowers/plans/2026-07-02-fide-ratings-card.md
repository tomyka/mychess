# FIDE Ratings in Player Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Standard/Rapid/Blitz FIDE ratings (each with its Lithuania country rank and age-group rank) in `PlayerHeader.svelte`, replacing the now-redundant `StatsRow` rank tiles and the `rank_basis` setting.

**Architecture:** The dashboard's existing `fide_players` query (currently selecting one rank pair based on a user's `rank_basis` preference) is widened to select all three ratings and all six rank columns, assembled into a `fideRatings` object and passed to `PlayerHeader`, which renders one tile per variant. `StatsRow` drops its two rank tiles (kept: streak only). The `rank_basis` setting is removed from Settings.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), vitest + `@testing-library/svelte` (already set up), Tailwind CSS.

Spec: `docs/superpowers/specs/2026-07-02-fide-ratings-card-design.md`

---

### Task 1: `PlayerHeader` shows all three FIDE ratings + ranks

**Files:**
- Modify: `mychess/src/lib/components/PlayerHeader.svelte`
- Test: `mychess/src/lib/components/PlayerHeader.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/components/PlayerHeader.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import PlayerHeader from './PlayerHeader.svelte';

afterEach(() => cleanup());

const FULL_RATINGS = {
  standard: { rating: 1842, countryRank: 12, ageGroupRank: 3 },
  rapid: { rating: 1790, countryRank: 18, ageGroupRank: 5 },
  blitz: { rating: 1705, countryRank: 24, ageGroupRank: 7 }
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
    expect(screen.getByText('1790')).toBeTruthy();
    expect(screen.getByText('#18')).toBeTruthy();
    expect(screen.getByText('#5')).toBeTruthy();
    expect(screen.getByText('1705')).toBeTruthy();
    expect(screen.getByText('#24')).toBeTruthy();
    expect(screen.getByText('#7')).toBeTruthy();
  });

  it('shows a dash and N/A for a variant with no rating', () => {
    const ratings = {
      ...FULL_RATINGS,
      blitz: { rating: null, countryRank: null, ageGroupRank: null }
    };
    render(PlayerHeader, {
      props: { profile: { display_name: 'Tomas', fide_id: '1503014' }, fideRatings: ratings }
    });
    expect(screen.getByText('1842')).toBeTruthy();
    expect(screen.getByText('1790')).toBeTruthy();
    expect(screen.getAllByText('–').length).toBe(1);
    expect(screen.getAllByText('N/A').length).toBe(2);
  });

  it('shows placeholders in all three tiles when fideRatings is null but a FIDE ID exists', () => {
    render(PlayerHeader, {
      props: { profile: { display_name: 'Tomas', fide_id: '1503014' }, fideRatings: null }
    });
    expect(screen.getAllByText('–').length).toBe(3);
    expect(screen.getAllByText('N/A').length).toBe(6);
    expect(screen.getByText('FIDE ID: 1503014')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/PlayerHeader.test.ts`
Expected: FAIL — the current component only renders a single "FIDE Classical" badge from `profile.fide_rating`, so none of the tile text (e.g. `'1842'`, `'#12'`) exists yet, and it doesn't accept a `fideRatings` prop. The "derives initials from first_name/last_name" test will also fail, since the current component always uses `display_name.slice(0, 2)` regardless of `first_name`/`last_name`.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `mychess/src/lib/components/PlayerHeader.svelte` with:

```svelte
<!-- MyChess/src/lib/components/PlayerHeader.svelte -->
<script lang="ts">
  type FideTypeRatings = { rating: number | null; countryRank: number | null; ageGroupRank: number | null };
  type FideRatings = { standard: FideTypeRatings; rapid: FideTypeRatings; blitz: FideTypeRatings } | null;

  let { profile, fideRatings = null } = $props<{ profile: any; fideRatings?: FideRatings }>();

  const p = $derived(profile as any);
  const initials = $derived(
    p?.first_name && p?.last_name
      ? `${p.first_name[0]}${p.last_name[0]}`.toUpperCase()
      : (p?.display_name ?? 'P').slice(0, 2).toUpperCase()
  );

  const EMPTY_TILE: FideTypeRatings = { rating: null, countryRank: null, ageGroupRank: null };

  const TILES = [
    { key: 'standard' as const, label: 'Standard' },
    { key: 'rapid' as const, label: 'Rapid' },
    { key: 'blitz' as const, label: 'Blitz' }
  ];

  function tileFor(key: 'standard' | 'rapid' | 'blitz'): FideTypeRatings {
    return fideRatings?.[key] ?? EMPTY_TILE;
  }
</script>

<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
  <!-- Avatar circle -->
  <div class="w-14 h-14 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xl flex items-center justify-center shrink-0">
    {initials}
  </div>

  <!-- Identity -->
  <div class="flex-1 min-w-0">
    <h1 class="text-xl font-bold text-gray-900 truncate">{p?.display_name ?? 'Player'}</h1>
    {#if p?.fide_id}
      <p class="text-sm text-gray-500">FIDE ID: {p.fide_id}</p>
    {:else}
      <a href="/settings" class="text-xs text-indigo-600 hover:underline">Link FIDE account →</a>
    {/if}
  </div>

  <!-- FIDE rating tiles: Standard / Rapid / Blitz -->
  {#if p?.fide_id}
    <div class="flex gap-2 shrink-0">
      {#each TILES as tile (tile.key)}
        {@const entry = tileFor(tile.key)}
        <div class="w-[92px] text-center bg-gray-50 border border-gray-100 rounded-lg px-1 py-2">
          <div class="flex items-center justify-center gap-1 text-gray-400">
            {#if tile.key === 'standard'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
              </svg>
            {:else if tile.key === 'rapid'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="13" r="8" /><path d="M12 13v-3" /><path d="M9.5 3h5" /><path d="M12 3v2" />
              </svg>
            {:else}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2L4.5 14h5.5l-1 8L19 10h-5.5l-.5-8z" />
              </svg>
            {/if}
            <span class="text-[9px] uppercase tracking-wide">{tile.label}</span>
          </div>
          <p class="text-lg font-bold text-gray-900 mt-0.5">{entry.rating ?? '–'}</p>
          <div class="flex mt-1 border-t border-gray-200 pt-1">
            <div class="flex-1 border-r border-gray-200">
              <p class="text-[11px] font-semibold text-gray-700">{entry.countryRank != null ? `#${entry.countryRank}` : 'N/A'}</p>
              <p class="text-[8px] text-gray-400">LTU</p>
            </div>
            <div class="flex-1">
              <p class="text-[11px] font-semibold text-gray-700">{entry.ageGroupRank != null ? `#${entry.ageGroupRank}` : 'N/A'}</p>
              <p class="text-[8px] text-gray-400">AGE</p>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/PlayerHeader.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/components/PlayerHeader.svelte mychess/src/lib/components/PlayerHeader.test.ts
git commit -m "feat: show Standard/Rapid/Blitz FIDE ratings and ranks in PlayerHeader

Also fixes avatar initials to derive from first_name/last_name (e.g.
TK for Tomas Konovalovas) instead of slicing display_name, which
didn't reliably produce first+last initials."
```

---

### Task 2: `StatsRow` drops the rank tiles, keeps streak only

**Files:**
- Modify: `mychess/src/lib/components/StatsRow.svelte`
- Modify: `mychess/src/lib/components/StatsRow.test.ts`

- [ ] **Step 1: Replace the test file with streak-only coverage**

Replace the full contents of `mychess/src/lib/components/StatsRow.test.ts` with:

```ts
// mychess/src/lib/components/StatsRow.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import StatsRow from './StatsRow.svelte';

afterEach(() => cleanup());

describe('StatsRow', () => {
  it('shows the streak count and fire emoji when streakDays > 0', () => {
    render(StatsRow, { props: { streakDays: 5 } });
    expect(screen.getByText('🔥 5')).toBeTruthy();
    expect(screen.getByText('Day streak')).toBeTruthy();
  });

  it('shows a dash when streakDays is 0', () => {
    render(StatsRow, { props: { streakDays: 0 } });
    expect(screen.getByText('–')).toBeTruthy();
  });

  it('defaults streakDays to 0 when not provided', () => {
    render(StatsRow, { props: {} });
    expect(screen.getByText('–')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/StatsRow.test.ts`
Expected: FAIL — the current component still renders the country-rank and age-group-rank tiles alongside streak inside a 3-column grid, so `screen.getByText('🔥 5')` etc. will actually still pass, but this step exists to confirm the *old* rank-related tests are gone before you touch the component. If this run unexpectedly passes fully already, that's fine — proceed to Step 3 regardless, since the real change is in the component markup.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `mychess/src/lib/components/StatsRow.svelte` with:

```svelte
<!-- MyChess/src/lib/components/StatsRow.svelte -->
<script lang="ts">
  let { streakDays = 0 } = $props<{ streakDays?: number }>();
</script>

<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
  <p class="text-xl font-bold {streakDays > 0 ? 'text-orange-500' : 'text-gray-300'}">
    {streakDays > 0 ? `🔥 ${streakDays}` : '–'}
  </p>
  <p class="text-xs text-gray-400 mt-0.5">Day streak</p>
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/StatsRow.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/components/StatsRow.svelte mychess/src/lib/components/StatsRow.test.ts
git commit -m "refactor: drop redundant rank tiles from StatsRow, keep streak only"
```

---

### Task 3: Wire `fideRatings` into the dashboard

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.server.ts`
- Modify: `mychess/src/routes/(kid)/+page.svelte`

- [ ] **Step 1: Replace the rank_basis-driven fetch with a full ratings+ranks fetch**

In `mychess/src/routes/(kid)/+page.server.ts`, change:

```ts
  const lichessUsername = p?.lichess_username ?? null;
  // Which FIDE rating drives the rank tiles (validated; constrains column names below).
  const rawBasis = p?.rank_basis ?? 'standard';
  const rankBasis = ['standard', 'rapid', 'blitz'].includes(rawBasis) ? rawBasis : 'standard';
  const countryRankCol = `country_rank_${rankBasis}`;
  const ageGroupRankCol = `age_group_rank_${rankBasis}`;

  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes, lichessRatings, fideRes] = await Promise.all([
    supabase
      .from('kid_stats')
      .select('total_reviews, total_correct, moves_learned, new_cards_today')
      .eq('kid_id', user.id)
      .single(),
    supabase
      .from('quests')
      .select('*')
      .eq('kid_id', user.id)
      .eq('date', today),
    supabase
      .from('weekly_leaderboard')
      .select('kid_id, weekly_xp, rank')
      .order('rank', { ascending: true })
      .limit(10),
    supabase
      .from('coach_notes')
      .select('id, message, created_at')
      .eq('kid_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null),
    // FIDE Lithuania rank (from the monthly imported list), keyed by the player's FIDE ID.
    p?.fide_id
      ? supabase
          .from('fide_players')
          .select(`${countryRankCol}, ${ageGroupRankCol}, age_bracket`)
          .eq('fide_id', p.fide_id)
          .single()
      : Promise.resolve({ data: null, error: null })
  ]);

  // A missing row returns a PGRST116 error, which we treat as "unranked" (null).
  // A genuine failure is worth surfacing.
  if (fideRes.error && fideRes.error.code !== 'PGRST116') {
    console.error('Failed to fetch FIDE rank:', fideRes.error);
  }
  const fide = fideRes.data as any;
  const countryRank: number | null = fide?.[countryRankCol] ?? null;
  const ageGroupRank: number | null = fide?.[ageGroupRankCol] ?? null;
  const ageBracket: string | null = fide?.age_bracket ?? null;
```

to:

```ts
  const lichessUsername = p?.lichess_username ?? null;

  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes, lichessRatings, fideRes] = await Promise.all([
    supabase
      .from('kid_stats')
      .select('total_reviews, total_correct, moves_learned, new_cards_today')
      .eq('kid_id', user.id)
      .single(),
    supabase
      .from('quests')
      .select('*')
      .eq('kid_id', user.id)
      .eq('date', today),
    supabase
      .from('weekly_leaderboard')
      .select('kid_id, weekly_xp, rank')
      .order('rank', { ascending: true })
      .limit(10),
    supabase
      .from('coach_notes')
      .select('id, message, created_at')
      .eq('kid_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null),
    // FIDE Lithuania ratings + per-type ranks (from the monthly imported list), keyed by FIDE ID.
    p?.fide_id
      ? supabase
          .from('fide_players')
          .select(
            'std_rating, rapid_rating, blitz_rating, ' +
            'country_rank_standard, country_rank_rapid, country_rank_blitz, ' +
            'age_group_rank_standard, age_group_rank_rapid, age_group_rank_blitz'
          )
          .eq('fide_id', p.fide_id)
          .single()
      : Promise.resolve({ data: null, error: null })
  ]);

  // A missing row returns a PGRST116 error, which we treat as "unranked" (null).
  // A genuine failure is worth surfacing.
  if (fideRes.error && fideRes.error.code !== 'PGRST116') {
    console.error('Failed to fetch FIDE ratings:', fideRes.error);
  }
  const fide = fideRes.data as any;
  const fideRatings = fide
    ? {
        standard: {
          rating: fide.std_rating ?? null,
          countryRank: fide.country_rank_standard ?? null,
          ageGroupRank: fide.age_group_rank_standard ?? null
        },
        rapid: {
          rating: fide.rapid_rating ?? null,
          countryRank: fide.country_rank_rapid ?? null,
          ageGroupRank: fide.age_group_rank_rapid ?? null
        },
        blitz: {
          rating: fide.blitz_rating ?? null,
          countryRank: fide.country_rank_blitz ?? null,
          ageGroupRank: fide.age_group_rank_blitz ?? null
        }
      }
    : null;
```

- [ ] **Step 2: Return `fideRatings` instead of `countryRank`/`ageGroupRank`/`ageBracket`**

In the same file, change:

```ts
  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    stats: {
      level,
      total_xp: totalXp,
      xp_in_level: xpInLevel,
      xp_to_next: xpToNextLevel,
      streak_days: streakDays,
      total_reviews: statsRes.data?.total_reviews ?? 0,
      new_cards_today: statsRes.data?.new_cards_today ?? 0
    },
    quests,
    leaderboard: lbEntries,
    unreadNote: noteRes.data ?? null,
    avatarId: p?.avatar_id ?? 'knight',
    countryRank,
    ageGroupRank,
    ageBracket,
    upcomingTournaments: upcomingTournaments ?? []
  };
```

to:

```ts
  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    fideRatings,
    stats: {
      level,
      total_xp: totalXp,
      xp_in_level: xpInLevel,
      xp_to_next: xpToNextLevel,
      streak_days: streakDays,
      total_reviews: statsRes.data?.total_reviews ?? 0,
      new_cards_today: statsRes.data?.new_cards_today ?? 0
    },
    quests,
    leaderboard: lbEntries,
    unreadNote: noteRes.data ?? null,
    avatarId: p?.avatar_id ?? 'knight',
    upcomingTournaments: upcomingTournaments ?? []
  };
```

- [ ] **Step 3: Pass `fideRatings` to `PlayerHeader` and simplify the `StatsRow` call**

In `mychess/src/routes/(kid)/+page.svelte`, change:

```svelte
      <!-- Player identity + FIDE rating, with a compact Lichess rating badge alongside -->
      <div class="flex items-stretch gap-3">
        <div class="flex-1">
          <PlayerHeader {profile} />
        </div>
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center justify-center shrink-0">
          <LichessStatsCard username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} compact />
        </div>
      </div>

      <!-- Country/age/streak stats -->
      <StatsRow
        streakDays={stats.streak_days ?? 0}
        countryRank={d.countryRank ?? null}
        ageGroupRank={d.ageGroupRank ?? null}
        ageBracket={d.ageBracket ?? null}
      />
```

to:

```svelte
      <!-- Player identity + FIDE ratings, with a compact Lichess rating badge alongside -->
      <div class="flex items-stretch gap-3">
        <div class="flex-1">
          <PlayerHeader {profile} fideRatings={d.fideRatings ?? null} />
        </div>
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center justify-center shrink-0">
          <LichessStatsCard username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} compact />
        </div>
      </div>

      <!-- Streak -->
      <StatsRow streakDays={stats.streak_days ?? 0} />
```

- [ ] **Step 4: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to `(kid)/+page.server.ts` or `(kid)/+page.svelte`.

- [ ] **Step 5: Commit**

```bash
git add "mychess/src/routes/(kid)/+page.server.ts" "mychess/src/routes/(kid)/+page.svelte"
git commit -m "feat: wire per-type FIDE ratings and ranks into the dashboard"
```

---

### Task 4: Remove the `rank_basis` setting

**Files:**
- Modify: `mychess/src/routes/(kid)/settings/+page.server.ts`
- Modify: `mychess/src/routes/(kid)/settings/+page.svelte`

- [ ] **Step 1: Remove `rank_basis` from the Settings load and save**

In `mychess/src/routes/(kid)/settings/+page.server.ts`, change the `load` return from:

```ts
  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    firstName: p?.first_name ?? '',
    lastName: p?.last_name ?? '',
    chesscomUsername: p?.chesscom_username ?? '',
    lichessUsername,
    lichessRatings,
    fideId: p?.fide_id ?? '',
    rankBasis: p?.rank_basis ?? 'standard',
    oauthSuccess: url.searchParams.get('oauth_success') ?? null,
    oauthError: url.searchParams.get('oauth_error') ?? null
  };
```

to:

```ts
  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    firstName: p?.first_name ?? '',
    lastName: p?.last_name ?? '',
    chesscomUsername: p?.chesscom_username ?? '',
    lichessUsername,
    lichessRatings,
    fideId: p?.fide_id ?? '',
    oauthSuccess: url.searchParams.get('oauth_success') ?? null,
    oauthError: url.searchParams.get('oauth_error') ?? null
  };
```

Then, in the `save` action, change:

```ts
    const fd = await request.formData();
    const firstName = (fd.get('first_name') as string ?? '').trim();
    const lastName = (fd.get('last_name') as string ?? '').trim();
    const fideId = (fd.get('fide_id') as string ?? '').trim();
    const rawBasis = (fd.get('rank_basis') as string ?? '').trim();
    const rankBasis = ['standard', 'rapid', 'blitz'].includes(rawBasis) ? rawBasis : 'standard';
```

to:

```ts
    const fd = await request.formData();
    const firstName = (fd.get('first_name') as string ?? '').trim();
    const lastName = (fd.get('last_name') as string ?? '').trim();
    const fideId = (fd.get('fide_id') as string ?? '').trim();
```

Then, later in the same action, change:

```ts
    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        fide_id: fideId || null,
        chesscom_username: chesscomUsername || null,
        rank_basis: rankBasis,
        ...(displayName ? { display_name: displayName } : {})
      } as any)
      .eq('id', user.id);
```

to:

```ts
    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        fide_id: fideId || null,
        chesscom_username: chesscomUsername || null,
        ...(displayName ? { display_name: displayName } : {})
      } as any)
      .eq('id', user.id);
```

- [ ] **Step 2: Remove the "Rank based on" field from the Settings UI**

In `mychess/src/routes/(kid)/settings/+page.svelte`, remove this entire block (it sits between the FIDE ID field and the Chess.com Username field):

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

(leave the FIDE ID field's block and the Chess.com Username field's block as they are — this just deletes the block between them, along with its trailing blank line)

- [ ] **Step 3: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to `(kid)/settings/+page.server.ts` or `(kid)/settings/+page.svelte`.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(kid)/settings/+page.server.ts" "mychess/src/routes/(kid)/settings/+page.svelte"
git commit -m "refactor: remove the unused rank_basis setting"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run` (from `mychess/`; if component tests fail with `ERR_REQUIRE_ESM` on this machine, prefix `PATH` with a Node ≥20.19 install as was needed for the Lichess feature's component tests)
Expected: PASS — all tests including the new `PlayerHeader.test.ts` and the updated `StatsRow.test.ts`.

- [ ] **Step 2: Run the full type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors.

- [ ] **Step 3: Grep for any remaining `rank_basis` or `ageBracket`/`countryRank`/`ageGroupRank` references**

Run: `grep -rn "rank_basis\|ageBracket\|countryRank\|ageGroupRank" mychess/src` (or use your editor's search)
Expected: no matches outside of `mychess/src/lib/fide/rank.ts` and `mychess/src/lib/fide/import-job.ts` (those compute and store the per-type rank columns for the *import job* — unrelated to this feature and out of scope to touch).

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev` (from `mychess/`), then in a browser:
- Visit `/` as a user with a FIDE ID that has a `fide_players` row with all three ratings — confirm all three tiles show real numbers and ranks.
- Visit `/` as a user with a FIDE ID but no `fide_players` row (or one missing a specific rating) — confirm the affected tile(s) show "–" and "N/A".
- Visit `/` as a user with no FIDE ID — confirm the "Link FIDE account" prompt still shows, no tiles.
- Visit `/settings` — confirm the "Rank based on" field is gone and the rest of the Profile form still saves correctly.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as part of the task where the bug was introduced and re-run this task's steps.
