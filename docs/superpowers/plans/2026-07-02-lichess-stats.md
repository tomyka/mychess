# Lichess Rating Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the connected user's Lichess ratings (Bullet/Blitz/Rapid/Classical) on the Settings page and as a compact badge on the dashboard.

**Architecture:** A server-only helper (`fetchLichessRatings`) calls the public Lichess API and is invoked from two independent page `load` functions (Settings, Dashboard). A single `LichessStatsCard.svelte` component renders the result in both a full (Settings) and compact (Dashboard) mode.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), vitest, `@testing-library/svelte` (new), Tailwind CSS.

Spec: `docs/superpowers/specs/2026-07-02-lichess-stats-design.md`

---

### Task 1: `fetchLichessRatings` server helper

**Files:**
- Create: `mychess/src/lib/server/lichess.ts`
- Test: `mychess/src/lib/server/lichess.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/server/lichess.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLichessRatings } from './lichess';

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status })
  );
}

describe('fetchLichessRatings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('includes a variant when it has games played', async () => {
    mockFetch({
      perfs: {
        blitz: { games: 500, rating: 2650 },
        bullet: { games: 0, rating: 1500 }
      }
    });
    const result = await fetchLichessRatings('magnus');
    expect(result).toEqual({ blitz: 2650 });
  });

  it('excludes a variant with zero games', async () => {
    mockFetch({
      perfs: {
        rapid: { games: 0, rating: 1500 },
        classical: { games: 12, rating: 2100 }
      }
    });
    const result = await fetchLichessRatings('magnus');
    expect(result).toEqual({ classical: 2100 });
  });

  it('returns an empty object when no variant has games', async () => {
    mockFetch({
      perfs: {
        bullet: { games: 0, rating: 1500 },
        blitz: { games: 0, rating: 1500 }
      }
    });
    const result = await fetchLichessRatings('newplayer');
    expect(result).toEqual({});
  });

  it('returns null on a non-200 response', async () => {
    mockFetch({ error: 'Not found' }, 404);
    const result = await fetchLichessRatings('doesnotexist');
    expect(result).toBeNull();
  });

  it('returns null when the response body is malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('not json', { status: 200 })
    );
    const result = await fetchLichessRatings('magnus');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await fetchLichessRatings('magnus');
    expect(result).toBeNull();
  });

  it('fetches the correct Lichess URL', async () => {
    const spy = mockFetch({ perfs: {} });
    await fetchLichessRatings('DrNykterstein');
    expect(spy).toHaveBeenCalledWith(
      'https://lichess.org/api/user/DrNykterstein',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/lichess.test.ts`
Expected: FAIL with `Cannot find module './lichess'` (or similar — the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// mychess/src/lib/server/lichess.ts
export type LichessRatings = {
  bullet?: number;
  blitz?: number;
  rapid?: number;
  classical?: number;
};

const VARIANTS = ['bullet', 'blitz', 'rapid', 'classical'] as const;

export async function fetchLichessRatings(username: string): Promise<LichessRatings | null> {
  let res: Response;
  try {
    res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MyChess/1.0' },
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.error(`Failed to reach Lichess for user ${username}:`, e);
    return null;
  }

  if (!res.ok) {
    console.error(`Lichess API returned ${res.status} for user ${username}`);
    return null;
  }

  try {
    const data = await res.json();
    const perfs = data?.perfs ?? {};
    const ratings: LichessRatings = {};
    for (const variant of VARIANTS) {
      const perf = perfs[variant];
      if (perf && typeof perf.rating === 'number' && perf.games > 0) {
        ratings[variant] = perf.rating;
      }
    }
    return ratings;
  } catch (e) {
    console.error(`Failed to parse Lichess response for user ${username}:`, e);
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/lichess.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/server/lichess.ts mychess/src/lib/server/lichess.test.ts
git commit -m "feat: add fetchLichessRatings server helper"
```

---

### Task 2: Component test infrastructure (jsdom + testing-library)

This project has no existing component-render test setup (only unauthenticated Playwright e2e and plain-`node` vitest unit tests). This task adds the pieces Task 3 needs.

**Files:**
- Modify: `mychess/package.json` (via `npm install`)
- Modify: `mychess/vite.config.ts`

- [ ] **Step 1: Install the new devDependencies**

Run: `npm install -D @testing-library/svelte jsdom` (run from `mychess/`)
Expected: `package.json` and `package-lock.json` gain `@testing-library/svelte` and `jsdom` under `devDependencies`.

- [ ] **Step 2: Add a jsdom environment override for component tests**

In `mychess/vite.config.ts`, change the `test` block from:

```ts
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		alias: {
			$lib: '/src/lib'
		}
	}
```

to:

```ts
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		environmentMatchGlobs: [['src/lib/components/**/*.test.ts', 'jsdom']],
		alias: {
			$lib: '/src/lib'
		}
	}
```

- [ ] **Step 3: Verify the existing test suite still passes under the new config**

Run: `npx vitest run`
Expected: PASS — all existing tests (`fide.test.ts`, `oauth.test.ts`, `lichess.test.ts`) still run under `node`, none are under `src/lib/components/` yet so `jsdom` isn't exercised until Task 3.

- [ ] **Step 4: Commit**

```bash
git add mychess/package.json mychess/package-lock.json mychess/vite.config.ts
git commit -m "test: add jsdom environment for component tests"
```

---

### Task 3: `LichessStatsCard` component

**Files:**
- Create: `mychess/src/lib/components/LichessStatsCard.svelte`
- Test: `mychess/src/lib/components/LichessStatsCard.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/components/LichessStatsCard.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import LichessStatsCard from './LichessStatsCard.svelte';

afterEach(() => cleanup());

describe('LichessStatsCard', () => {
  it('shows a connect prompt when not connected', () => {
    render(LichessStatsCard, { props: { username: null, ratings: null } });
    expect(screen.getByText(/Connect Lichess/i)).toBeTruthy();
  });

  it('shows an error message when the fetch failed', () => {
    render(LichessStatsCard, { props: { username: 'magnus', ratings: null } });
    expect(screen.getByText(/Couldn't load Lichess stats/i)).toBeTruthy();
  });

  it('shows a no-rated-games message when ratings is empty', () => {
    render(LichessStatsCard, { props: { username: 'magnus', ratings: {} } });
    expect(screen.getByText(/No rated games yet/i)).toBeTruthy();
  });

  it('shows a badge per available variant, in a fixed order', () => {
    render(LichessStatsCard, {
      props: { username: 'magnus', ratings: { classical: 2830, blitz: 2800 } }
    });
    expect(screen.getByText('2800')).toBeTruthy();
    expect(screen.getByText('Blitz')).toBeTruthy();
    expect(screen.getByText('2830')).toBeTruthy();
    expect(screen.getByText('Classical')).toBeTruthy();
  });

  it('compact mode shows only the highest-priority rating (blitz > rapid > classical > bullet)', () => {
    render(LichessStatsCard, {
      props: { username: 'magnus', ratings: { rapid: 2750, classical: 2830 }, compact: true }
    });
    expect(screen.getByText('2750')).toBeTruthy();
    expect(screen.queryByText('2830')).toBeNull();
  });

  it('compact mode falls back through the priority chain when higher variants are missing', () => {
    render(LichessStatsCard, {
      props: { username: 'magnus', ratings: { bullet: 2900 }, compact: true }
    });
    expect(screen.getByText('2900')).toBeTruthy();
    expect(screen.getByText('Bullet')).toBeTruthy();
  });

  it('compact mode shows the no-rated-games message when ratings is empty', () => {
    render(LichessStatsCard, {
      props: { username: 'magnus', ratings: {}, compact: true }
    });
    expect(screen.getByText(/No rated games yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/LichessStatsCard.test.ts`
Expected: FAIL — `LichessStatsCard.svelte` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```svelte
<!-- MyChess/src/lib/components/LichessStatsCard.svelte -->
<script lang="ts">
  type LichessRatings = {
    bullet?: number;
    blitz?: number;
    rapid?: number;
    classical?: number;
  };

  let { ratings, username, compact = false } = $props<{
    ratings: LichessRatings | null;
    username: string | null;
    compact?: boolean;
  }>();

  const LABELS = {
    bullet: 'Bullet',
    blitz: 'Blitz',
    rapid: 'Rapid',
    classical: 'Classical'
  } as const;

  const DISPLAY_ORDER = ['bullet', 'blitz', 'rapid', 'classical'] as const;
  const COMPACT_PRIORITY = ['blitz', 'rapid', 'classical', 'bullet'] as const;

  const entries = $derived(
    ratings
      ? DISPLAY_ORDER
          .filter((variant) => typeof ratings[variant] === 'number')
          .map((variant) => ({ variant, label: LABELS[variant], rating: ratings[variant] as number }))
      : []
  );

  const compactEntry = $derived.by(() => {
    if (!ratings) return null;
    for (const variant of COMPACT_PRIORITY) {
      const rating = ratings[variant];
      if (typeof rating === 'number') return { variant, label: LABELS[variant], rating };
    }
    return null;
  });
</script>

{#if !username}
  <p class="text-sm text-gray-400">
    <a href="/settings" class="text-indigo-600 hover:underline">Connect Lichess</a> to see your ratings.
  </p>
{:else if ratings === null}
  <p class="text-sm text-gray-400">Couldn't load Lichess stats right now.</p>
{:else if compact}
  {#if compactEntry}
    <div class="text-right shrink-0">
      <p class="text-3xl font-bold text-gray-900">{compactEntry.rating}</p>
      <p class="text-xs text-gray-400 uppercase tracking-wide">{compactEntry.label}</p>
    </div>
  {:else}
    <p class="text-sm text-gray-400">No rated games yet.</p>
  {/if}
{:else if entries.length === 0}
  <p class="text-sm text-gray-400">No rated games yet.</p>
{:else}
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    {#each entries as entry (entry.variant)}
      <div class="bg-gray-50 rounded-lg border border-gray-200 p-3 text-center">
        <p class="text-xl font-bold text-gray-900">{entry.rating}</p>
        <p class="text-xs text-gray-400 mt-0.5">{entry.label}</p>
      </div>
    {/each}
  </div>
{/if}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/LichessStatsCard.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/components/LichessStatsCard.svelte mychess/src/lib/components/LichessStatsCard.test.ts
git commit -m "feat: add LichessStatsCard component"
```

---

### Task 4: Wire stats into the Settings page

**Files:**
- Modify: `mychess/src/routes/(kid)/settings/+page.server.ts`
- Modify: `mychess/src/routes/(kid)/settings/+page.svelte`

- [ ] **Step 1: Fetch ratings in the Settings `load` function**

In `mychess/src/routes/(kid)/settings/+page.server.ts`, add the import:

```ts
import { fetchLichessRatings } from '$lib/server/lichess';
```

Replace the `load` function's body from:

```ts
  const p = profile as any;

  return {
    session,
    profile,
    displayName: p?.display_name ?? '',
    firstName: p?.first_name ?? '',
    lastName: p?.last_name ?? '',
    chesscomUsername: p?.chesscom_username ?? '',
    lichessUsername: p?.lichess_username ?? '',
    fideId: p?.fide_id ?? '',
    oauthSuccess: url.searchParams.get('oauth_success') ?? null,
    oauthError: url.searchParams.get('oauth_error') ?? null
  };
```

to:

```ts
  const p = profile as any;
  const lichessUsername = p?.lichess_username ?? '';
  const lichessRatings = lichessUsername ? await fetchLichessRatings(lichessUsername) : null;

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

- [ ] **Step 2: Render the card in Settings**

In `mychess/src/routes/(kid)/settings/+page.svelte`, add the import at the top of the `<script>` block:

```svelte
  import LichessStatsCard from '$lib/components/LichessStatsCard.svelte';
```

Then, in the "Connected accounts" section, change:

```svelte
          {:else}
            <a
              href="/auth/connect/lichess"
              class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
              Connect
            </a>
          {/if}
        </div>

      </div>
    </section>
```

to:

```svelte
          {:else}
            <a
              href="/auth/connect/lichess"
              class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
              Connect
            </a>
          {/if}
        </div>

        <LichessStatsCard username={d.lichessUsername || null} ratings={d.lichessRatings ?? null} />

      </div>
    </section>
```

- [ ] **Step 3: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to `settings/+page.server.ts` or `settings/+page.svelte`.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(kid)/settings/+page.server.ts" "mychess/src/routes/(kid)/settings/+page.svelte"
git commit -m "feat: show Lichess ratings on the Settings page"
```

---

### Task 5: Wire a compact stats badge into the Dashboard

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.server.ts`
- Modify: `mychess/src/routes/(kid)/+page.svelte`

- [ ] **Step 1: Fetch ratings in the Dashboard `load` function**

In `mychess/src/routes/(kid)/+page.server.ts`, add the import:

```ts
import { fetchLichessRatings } from '$lib/server/lichess';
```

Change:

```ts
  const p = profile as any;
  const totalXp = Number(p?.xp ?? 0);
  const streakDays = Number(p?.streak_days ?? 0);
  const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);
  const today = new Date().toISOString().slice(0, 10);

  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes] = await Promise.all([
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
      .single()
  ]);
```

to:

```ts
  const p = profile as any;
  const totalXp = Number(p?.xp ?? 0);
  const streakDays = Number(p?.streak_days ?? 0);
  const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);
  const today = new Date().toISOString().slice(0, 10);
  const lichessUsername = p?.lichess_username ?? null;

  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes, lichessRatings] = await Promise.all([
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
    lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null)
  ]);
```

Then, in the `return` statement, change:

```ts
  return {
    isGuest,
    session,
    profile,
    stats: {
```

to:

```ts
  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    stats: {
```

(everything else in the return object stays the same)

- [ ] **Step 2: Render the compact badge next to `PlayerHeader`**

In `mychess/src/routes/(kid)/+page.svelte`, add the import:

```svelte
  import LichessStatsCard from '$lib/components/LichessStatsCard.svelte';
```

Change:

```svelte
      <!-- Player identity + FIDE rating -->
      <PlayerHeader {profile} />
```

to:

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
```

- [ ] **Step 3: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to `(kid)/+page.server.ts` or `(kid)/+page.svelte`.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(kid)/+page.server.ts" "mychess/src/routes/(kid)/+page.svelte"
git commit -m "feat: show a compact Lichess rating badge on the dashboard"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run` (from `mychess/`)
Expected: PASS — all tests including `lichess.test.ts` and `LichessStatsCard.test.ts`.

- [ ] **Step 2: Run the full type-check**

Run: `npm run check` (from `mychess/`)
Expected: no errors.

- [ ] **Step 3: Manually verify in the dev server**

Run: `npm run dev` (from `mychess/`), then in a browser:
- Visit `/settings` while logged in as a user with `lichess_username` set — confirm the ratings card renders under the Lichess row.
- Visit `/` (dashboard) as the same user — confirm the compact badge renders next to the player header.
- Temporarily clear `lichess_username` (or view as a user without one) — confirm both pages show the "Connect Lichess" prompt instead.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as part of the task where the bug was introduced and re-run this task's steps.
