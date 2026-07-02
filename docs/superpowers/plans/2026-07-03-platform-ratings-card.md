# Platform Ratings Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Lichess and Chess.com ratings (Rapid/Blitz/Bullet/Puzzles) side-by-side on the dashboard, via one shared `PlatformRatingsCard` component.

**Architecture:** A new `fetchChesscomRatings` server helper mirrors the existing `fetchLichessRatings`. `fetchLichessRatings` is adjusted to drop Classical and add Puzzles, converging both platforms on the same rating shape. `LichessStatsCard.svelte` is replaced by a generic `PlatformRatingsCard.svelte` used twice on the dashboard (once per platform) and once on Settings (Lichess only, unchanged scope).

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), vitest + `@testing-library/svelte`, Tailwind CSS.

Spec: `docs/superpowers/specs/2026-07-03-platform-ratings-card-design.md`

**Note on sequencing:** Task 3 deletes `LichessStatsCard.svelte`/`.test.ts` and replaces them with `PlatformRatingsCard.svelte`/`.test.ts`, but the dashboard and Settings pages still reference the old component until Tasks 4 and 5 run — this causes a transient type error between tasks, resolved by the very next tasks. This mirrors how the FIDE ratings card plan handled the equivalent `StatsRow` prop-mismatch gap.

---

### Task 1: `fetchChesscomRatings` server helper

**Files:**
- Create: `mychess/src/lib/server/chesscom.ts`
- Test: `mychess/src/lib/server/chesscom.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/server/chesscom.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchChesscomRatings } from './chesscom';

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status })
  );
}

describe('fetchChesscomRatings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('includes a variant when its key is present', async () => {
    mockFetch({
      chess_rapid: { last: { rating: 1900 } },
      chess_blitz: { last: { rating: 1800 } }
    });
    const result = await fetchChesscomRatings('magnus');
    expect(result).toEqual({ rapid: 1900, blitz: 1800 });
  });

  it('excludes a variant whose key is missing', async () => {
    mockFetch({
      chess_rapid: { last: { rating: 1900 } }
    });
    const result = await fetchChesscomRatings('magnus');
    expect(result).toEqual({ rapid: 1900 });
  });

  it('maps tactics.highest.rating to puzzle', async () => {
    mockFetch({
      tactics: { highest: { rating: 2100 }, lowest: { rating: 1000 } }
    });
    const result = await fetchChesscomRatings('magnus');
    expect(result).toEqual({ puzzle: 2100 });
  });

  it('returns an empty object when no variant is present', async () => {
    mockFetch({});
    const result = await fetchChesscomRatings('newplayer');
    expect(result).toEqual({});
  });

  it('returns null on a non-200 response', async () => {
    mockFetch({ error: 'Not found' }, 404);
    const result = await fetchChesscomRatings('doesnotexist');
    expect(result).toBeNull();
  });

  it('returns null when the response body is malformed JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('not json', { status: 200 })
    );
    const result = await fetchChesscomRatings('magnus');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await fetchChesscomRatings('magnus');
    expect(result).toBeNull();
  });

  it('fetches the correct Chess.com URL', async () => {
    const spy = mockFetch({});
    await fetchChesscomRatings('MagnusCarlsen');
    expect(spy).toHaveBeenCalledWith(
      'https://api.chess.com/pub/player/MagnusCarlsen/stats',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/server/chesscom.test.ts`
Expected: FAIL with `Cannot find module './chesscom'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// mychess/src/lib/server/chesscom.ts
export type ChesscomRatings = {
  rapid?: number;
  blitz?: number;
  bullet?: number;
  puzzle?: number;
};

export async function fetchChesscomRatings(username: string): Promise<ChesscomRatings | null> {
  let res: Response;
  try {
    res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MyChess/1.0' },
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    console.error(`Failed to reach Chess.com for user ${username}:`, e);
    return null;
  }

  if (!res.ok) {
    console.error(`Chess.com API returned ${res.status} for user ${username}`);
    return null;
  }

  try {
    const data = await res.json();
    const ratings: ChesscomRatings = {};
    if (typeof data?.chess_rapid?.last?.rating === 'number') ratings.rapid = data.chess_rapid.last.rating;
    if (typeof data?.chess_blitz?.last?.rating === 'number') ratings.blitz = data.chess_blitz.last.rating;
    if (typeof data?.chess_bullet?.last?.rating === 'number') ratings.bullet = data.chess_bullet.last.rating;
    if (typeof data?.tactics?.highest?.rating === 'number') ratings.puzzle = data.tactics.highest.rating;
    return ratings;
  } catch (e) {
    console.error(`Failed to parse Chess.com response for user ${username}:`, e);
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/chesscom.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/server/chesscom.ts mychess/src/lib/server/chesscom.test.ts
git commit -m "feat: add fetchChesscomRatings server helper"
```

---

### Task 2: `fetchLichessRatings` drops Classical, adds Puzzles

**Files:**
- Modify: `mychess/src/lib/server/lichess.ts`
- Modify: `mychess/src/lib/server/lichess.test.ts`

- [ ] **Step 1: Update the tests to expect `puzzle` instead of `classical`**

Replace the full contents of `mychess/src/lib/server/lichess.test.ts` with:

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
        puzzle: { games: 12, rating: 2100 }
      }
    });
    const result = await fetchLichessRatings('magnus');
    expect(result).toEqual({ puzzle: 2100 });
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

- [ ] **Step 2: Run tests to verify the "excludes a variant" test fails**

Run: `npx vitest run src/lib/server/lichess.test.ts`
Expected: FAIL on "excludes a variant with zero games" — the current implementation's `VARIANTS` list doesn't include `'puzzle'`, so `fetchLichessRatings` returns `{}` instead of `{ puzzle: 2100 }`. All other tests still pass (they don't touch `classical`/`puzzle`).

- [ ] **Step 3: Update the implementation**

In `mychess/src/lib/server/lichess.ts`, change:

```ts
export type LichessRatings = {
  bullet?: number;
  blitz?: number;
  rapid?: number;
  classical?: number;
};

const VARIANTS = ['bullet', 'blitz', 'rapid', 'classical'] as const;
```

to:

```ts
export type LichessRatings = {
  bullet?: number;
  blitz?: number;
  rapid?: number;
  puzzle?: number;
};

const VARIANTS = ['bullet', 'blitz', 'rapid', 'puzzle'] as const;
```

(nothing else in the file changes — the fetch/mapping/error-handling logic already works generically off `VARIANTS`)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/lichess.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/server/lichess.ts mychess/src/lib/server/lichess.test.ts
git commit -m "refactor: drop Classical, add Puzzles to fetchLichessRatings"
```

---

### Task 3: `PlatformRatingsCard` component replaces `LichessStatsCard`

**Files:**
- Create: `mychess/src/lib/components/PlatformRatingsCard.svelte`
- Test: `mychess/src/lib/components/PlatformRatingsCard.test.ts`
- Delete: `mychess/src/lib/components/LichessStatsCard.svelte`
- Delete: `mychess/src/lib/components/LichessStatsCard.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/components/PlatformRatingsCard.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import PlatformRatingsCard from './PlatformRatingsCard.svelte';

afterEach(() => cleanup());

describe('PlatformRatingsCard', () => {
  it('shows a connect prompt when not connected', () => {
    render(PlatformRatingsCard, { props: { platform: 'Lichess', username: null, ratings: null } });
    expect(screen.getByText(/Connect Lichess/i)).toBeTruthy();
  });

  it('shows an error message when the fetch failed', () => {
    render(PlatformRatingsCard, { props: { platform: 'Chess.com', username: 'magnus', ratings: null } });
    expect(screen.getByText(/Couldn't load Chess\.com stats/i)).toBeTruthy();
  });

  it('shows a no-rated-games message when ratings is empty', () => {
    render(PlatformRatingsCard, { props: { platform: 'Lichess', username: 'magnus', ratings: {} } });
    expect(screen.getByText(/No rated games yet/i)).toBeTruthy();
  });

  it('shows the platform and username header line when connected', () => {
    render(PlatformRatingsCard, {
      props: { platform: 'Lichess', username: 'DrNykterstein', ratings: { rapid: 2700 } }
    });
    expect(screen.getByText(/Lichess/)).toBeTruthy();
    expect(screen.getByText('DrNykterstein')).toBeTruthy();
  });

  it('shows a tile per available variant', () => {
    render(PlatformRatingsCard, {
      props: { platform: 'Chess.com', username: 'magnus', ratings: { puzzle: 2830, blitz: 2800 } }
    });
    expect(screen.getByText('2800')).toBeTruthy();
    expect(screen.getByText('Blitz')).toBeTruthy();
    expect(screen.getByText('2830')).toBeTruthy();
    expect(screen.getByText('Puzzles')).toBeTruthy();
  });

  it('shows all four variants in rapid/blitz/bullet/puzzle order regardless of input order', () => {
    render(PlatformRatingsCard, {
      props: {
        platform: 'Lichess',
        username: 'magnus',
        ratings: { puzzle: 2400, bullet: 2500, blitz: 2600, rapid: 2700 }
      }
    });
    const labels = screen.getAllByText(/^(Rapid|Blitz|Bullet|Puzzles)$/).map((el) => el.textContent);
    expect(labels).toEqual(['Rapid', 'Blitz', 'Bullet', 'Puzzles']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/components/PlatformRatingsCard.test.ts`
Expected: FAIL — `PlatformRatingsCard.svelte` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```svelte
<!-- MyChess/src/lib/components/PlatformRatingsCard.svelte -->
<script lang="ts">
  type PlatformRatings = { rapid?: number; blitz?: number; bullet?: number; puzzle?: number };

  let { platform, username, ratings } = $props<{
    platform: string;
    username: string | null;
    ratings: PlatformRatings | null;
  }>();

  const LABELS = {
    rapid: 'Rapid',
    blitz: 'Blitz',
    bullet: 'Bullet',
    puzzle: 'Puzzles'
  } as const;

  const DISPLAY_ORDER = ['rapid', 'blitz', 'bullet', 'puzzle'] as const;

  const entries = $derived(
    ratings
      ? DISPLAY_ORDER
          .filter((variant) => typeof ratings[variant] === 'number')
          .map((variant) => ({ variant, label: LABELS[variant], rating: ratings[variant] as number }))
      : []
  );
</script>

{#if !username}
  <p class="text-sm text-gray-400">
    <a href="/settings" class="text-indigo-600 hover:underline">Connect {platform}</a> to see your ratings.
  </p>
{:else}
  <p class="text-sm font-medium text-gray-700 mb-2">{platform}: <span class="font-mono">{username}</span></p>
  {#if ratings === null}
    <p class="text-sm text-gray-400">Couldn't load {platform} stats right now.</p>
  {:else if entries.length === 0}
    <p class="text-sm text-gray-400">No rated games yet.</p>
  {:else}
    <div class="grid grid-cols-2 gap-3">
      {#each entries as entry (entry.variant)}
        <div class="bg-gray-50 rounded-lg border border-gray-200 p-3 text-center">
          <p class="text-xl font-bold text-gray-900">{entry.rating}</p>
          <p class="text-xs text-gray-400 mt-0.5">{entry.label}</p>
        </div>
      {/each}
    </div>
  {/if}
{/if}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/components/PlatformRatingsCard.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Delete the old Lichess-specific component and test**

```bash
git rm mychess/src/lib/components/LichessStatsCard.svelte mychess/src/lib/components/LichessStatsCard.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/components/PlatformRatingsCard.svelte mychess/src/lib/components/PlatformRatingsCard.test.ts
git commit -m "feat: replace LichessStatsCard with generic PlatformRatingsCard"
```

Note: after this commit, `mychess/src/routes/(kid)/+page.svelte` and `mychess/src/routes/(kid)/settings/+page.svelte` still import the now-deleted `LichessStatsCard.svelte` — this is a known, temporary break fixed by Tasks 4 and 5, which run immediately next. Don't stop to fix it here.

---

### Task 4: Wire both platforms into the dashboard

**Files:**
- Modify: `mychess/src/routes/(kid)/+page.server.ts`
- Modify: `mychess/src/routes/(kid)/+page.svelte`

- [ ] **Step 1: Fetch Chess.com ratings alongside Lichess in the dashboard `load` function**

In `mychess/src/routes/(kid)/+page.server.ts`, add the import:

```ts
import { fetchChesscomRatings } from '$lib/server/chesscom';
```

(add it right after the existing `import { fetchLichessRatings } from '$lib/server/lichess';` line)

Then change:

```ts
  const lichessUsername = p?.lichess_username ?? null;

  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes, lichessRatings, fideRes] = await Promise.all([
```

to:

```ts
  const lichessUsername = p?.lichess_username ?? null;
  const chesscomUsername = p?.chesscom_username ?? null;

  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes, lichessRatings, chesscomRatings, fideRes] = await Promise.all([
```

Then, inside the same `Promise.all` array, change:

```ts
    lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null),
    // FIDE Lithuania ratings + per-type ranks (from the monthly imported list), keyed by FIDE ID.
```

to:

```ts
    lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null),
    chesscomUsername ? fetchChesscomRatings(chesscomUsername) : Promise.resolve(null),
    // FIDE Lithuania ratings + per-type ranks (from the monthly imported list), keyed by FIDE ID.
```

Finally, in the `return` statement, change:

```ts
  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    fideRatings,
```

to:

```ts
  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    chesscomUsername,
    chesscomRatings,
    fideRatings,
```

- [ ] **Step 2: Use `PlatformRatingsCard` for both platforms, side by side**

In `mychess/src/routes/(kid)/+page.svelte`, change the import:

```svelte
  import LichessStatsCard from '$lib/components/LichessStatsCard.svelte';
```

to:

```svelte
  import PlatformRatingsCard from '$lib/components/PlatformRatingsCard.svelte';
```

Then change:

```svelte
      <!-- Lichess ratings -->
      <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 class="font-semibold text-gray-900 mb-4">Lichess ratings</h2>
        <LichessStatsCard username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} />
      </section>
```

to:

```svelte
      <!-- Platform ratings -->
      <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <PlatformRatingsCard platform="Lichess" username={d.lichessUsername ?? null} ratings={d.lichessRatings ?? null} />
          <PlatformRatingsCard platform="Chess.com" username={d.chesscomUsername ?? null} ratings={d.chesscomRatings ?? null} />
        </div>
      </section>
```

- [ ] **Step 3: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no errors related to `(kid)/+page.server.ts` or `(kid)/+page.svelte` (this also resolves the transient `LichessStatsCard`-not-found error left open by Task 3).

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(kid)/+page.server.ts" "mychess/src/routes/(kid)/+page.svelte"
git commit -m "feat: show Lichess and Chess.com ratings side by side on the dashboard"
```

---

### Task 5: Update Settings to use `PlatformRatingsCard`

**Files:**
- Modify: `mychess/src/routes/(kid)/settings/+page.svelte`

- [ ] **Step 1: Swap the component**

In `mychess/src/routes/(kid)/settings/+page.svelte`, change the import:

```svelte
  import LichessStatsCard from '$lib/components/LichessStatsCard.svelte';
```

to:

```svelte
  import PlatformRatingsCard from '$lib/components/PlatformRatingsCard.svelte';
```

Then change:

```svelte
        <LichessStatsCard username={d.lichessUsername || null} ratings={d.lichessRatings ?? null} />
```

to:

```svelte
        <PlatformRatingsCard platform="Lichess" username={d.lichessUsername || null} ratings={d.lichessRatings ?? null} />
```

No other changes — `settings/+page.server.ts` already fetches `lichessRatings` via `fetchLichessRatings`, which Task 2 already updated; nothing here needs to change to pick up the new shape.

- [ ] **Step 2: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no errors related to `settings/+page.svelte`. This should be the last file referencing the deleted `LichessStatsCard` — the project should now type-check cleanly with respect to this feature (modulo the same pre-existing unrelated errors noted in prior plans).

- [ ] **Step 3: Commit**

```bash
git add "mychess/src/routes/(kid)/settings/+page.svelte"
git commit -m "refactor: use PlatformRatingsCard for Lichess ratings on Settings"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run` (from `mychess/`; if component tests fail with `ERR_REQUIRE_ESM` on this machine, prefix PATH with a Node ≥20.19 install, as needed for prior features' component tests)
Expected: PASS — all tests including the new `chesscom.test.ts` and `PlatformRatingsCard.test.ts`, the updated `lichess.test.ts`, with `LichessStatsCard.test.ts` gone.

- [ ] **Step 2: Run the full type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors (same pre-existing unrelated error count as before this feature).

- [ ] **Step 3: Grep for any remaining stale references**

Run: `grep -rn "LichessStatsCard\|classical" mychess/src`
Expected: no matches. (If `classical` appears anywhere outside this feature's files, investigate before considering this task done — it would mean something else still depends on the removed field.)

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev` (from `mychess/`), then in a browser as a logged-in (non-anonymous) user:
- Visit `/` — confirm two side-by-side areas appear below the player card: "Lichess: `<username>`" and "Chess.com: `<username>`" (or connect prompts if not linked), each showing up to 4 tiles in Rapid/Blitz/Bullet/Puzzles order.
- Visit `/settings` — confirm the Lichess ratings card still appears under "Connected accounts", now showing Puzzles instead of Classical.
- Test a user connected to only one platform — confirm the other side shows its own "Connect X" prompt independently.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as part of the task where the bug was introduced and re-run this task's steps.
