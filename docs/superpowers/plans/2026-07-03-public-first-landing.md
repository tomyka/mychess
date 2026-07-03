# Public-First Landing & Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` a public content landing (no login wall), let guests try training via a lazy anonymous session, and gate only the personal routes.

**Architecture:** Remove the eager anonymous session and the `(player)` layout's login redirect; add server helpers `ensureGuestSession` (lazy anon) and `requireAccount` (gate); enrich the guest dashboard with a FIDE lookup + tournaments + try-a-drill; gate personal routes.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Supabase (SSR), Vitest, jsdom.

**Working directory:** run `npm`/`npx` from `mychess/`. Repo root is its parent.

**Spec:** `docs/superpowers/specs/2026-07-03-public-first-landing-design.md`

**Known pre-existing `npm run check` errors (ignore):** `hooks.server.ts`, `lib/supabase/client.ts`, `auth/**`, `api/fide/import`, `api/tournaments/scrape`.

---

## Task 1: Extract guest-profile creation helper

**Files:**
- Create: `mychess/src/lib/server/guest.ts`
- Modify: `mychess/src/hooks.server.ts`

- [ ] **Step 1: Create the helper**

Create `mychess/src/lib/server/guest.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

/** Ensures a guest (anonymous) user has the profile rows the app expects. Idempotent. */
export async function ensureGuestProfile(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data: profile } = await supabase.from('profiles').select('id').eq('id', userId).single();
  if (profile) return;
  await supabase.from('profiles').insert({
    id: userId,
    role: 'player',
    display_name: 'Guest',
    avatar_id: 'knight'
  });
  await supabase.from('player_stats').upsert({ player_id: userId });
  await supabase.from('equipped_cosmetics').upsert({ player_id: userId });
}
```

- [ ] **Step 2: Stop eager anon session in hooks; use the helper**

In `mychess/src/hooks.server.ts`, add the import near the top:
```ts
import { ensureGuestProfile } from '$lib/server/guest';
```
Then replace the eager anon-session block and the inline guest-profile insert. Change:
```ts
		// Auto-create anonymous session for new visitors (guest mode)
		if (!session) {
			const { data: anonData } = await event.locals.supabase.auth.signInAnonymously();
			session = anonData.session;
		}

		if (!session) return { session: null, user: null, profile: null };

		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('id', session.user.id)
			.single();

		// Auto-create a guest profile for anonymous users
		if (!profile && session.user.is_anonymous) {
			await event.locals.supabase.from('profiles').insert({
				id: session.user.id,
				role: 'player',
				display_name: 'Guest',
				avatar_id: 'knight'
			});
			await event.locals.supabase.from('player_stats').upsert({ player_id: session.user.id });
			await event.locals.supabase.from('equipped_cosmetics').upsert({ player_id: session.user.id });
		}
```
to:
```ts
		// No eager anonymous session — public pages are viewable without any session.
		if (!session) return { session: null, user: null, profile: null };

		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('id', session.user.id)
			.single();

		// A lazily-created anonymous session may not have its guest profile yet.
		if (!profile && session.user.is_anonymous) {
			await ensureGuestProfile(event.locals.supabase, session.user.id);
		}
```
(The `resolvedProfile` refetch + display-name backfill below this block stay unchanged.)

- [ ] **Step 3: Verify**

Run (from `mychess/`): `npx vitest run 2>&1 | tail -3` → all pass.
Run: `npm run check 2>&1 | grep -c ERROR` → same known count (no new errors from `guest.ts`/`hooks.server.ts`).

- [ ] **Step 4: Commit**
```bash
git add mychess/src/lib/server/guest.ts mychess/src/hooks.server.ts
git commit -m "feat: drop eager anon session; extract ensureGuestProfile helper"
```

---

## Task 2: Server auth helpers (`requireAccount`, `ensureGuestSession`)

**Files:**
- Create: `mychess/src/lib/server/auth.ts`
- Test: `mychess/src/lib/server/auth.test.ts`

- [ ] **Step 1: Write the failing test for `requireAccount`**

Create `mychess/src/lib/server/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { requireAccount } from './auth';

function fakeLocals(sessionResult: any) {
  return { safeGetSession: async () => sessionResult } as any;
}

describe('requireAccount', () => {
  it('returns the session data for a real (non-anonymous) user', async () => {
    const data = { session: { s: 1 }, user: { id: 'u1', is_anonymous: false }, profile: { id: 'u1' } };
    await expect(requireAccount(fakeLocals(data))).resolves.toEqual(data);
  });

  it('redirects to /login when there is no user', async () => {
    const data = { session: null, user: null, profile: null };
    await expect(requireAccount(fakeLocals(data))).rejects.toMatchObject({ status: 303, location: '/login' });
  });

  it('redirects to /login when the user is anonymous', async () => {
    const data = { session: { s: 1 }, user: { id: 'a1', is_anonymous: true }, profile: { id: 'a1' } };
    await expect(requireAccount(fakeLocals(data))).rejects.toMatchObject({ status: 303, location: '/login' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/server/auth.test.ts`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Implement `auth.ts`**

Create `mychess/src/lib/server/auth.ts`:
```ts
import { redirect } from '@sveltejs/kit';
import { ensureGuestProfile } from './guest';

type Locals = App.Locals;

/** Requires a real (non-anonymous) signed-in account. Redirects to /login otherwise. */
export async function requireAccount(locals: Locals) {
  const data = await locals.safeGetSession();
  if (!data.user || (data.user as any).is_anonymous) {
    throw redirect(303, '/login');
  }
  return data;
}

/**
 * Returns the current session, lazily creating an anonymous one if none exists so
 * guests can try DB-backed training. Returns null if anonymous sign-in is
 * unavailable (provider disabled / error) — callers show a "sign in to train" state.
 */
export async function ensureGuestSession(locals: Locals) {
  const existing = await locals.safeGetSession();
  if (existing.session) return existing;

  const { data, error } = await locals.supabase.auth.signInAnonymously();
  if (error || !data.session) return null;

  await ensureGuestProfile(locals.supabase, data.session.user.id);
  return locals.safeGetSession();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/lib/server/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add mychess/src/lib/server/auth.ts mychess/src/lib/server/auth.test.ts
git commit -m "feat: add requireAccount and ensureGuestSession helpers"
```

---

## Task 3: Remove the login wall in the (player) layout

**Files:**
- Modify: `mychess/src/routes/(player)/+layout.server.ts`

- [ ] **Step 1: Replace the guard**

Replace the whole body of `mychess/src/routes/(player)/+layout.server.ts` with:
```ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession } }) => {
	const data = await safeGetSession();
	// A real signup that hasn't completed onboarding yet.
	if (data.user && !(data.user as any).is_anonymous && !data.profile) {
		throw redirect(303, '/welcome');
	}
	// Coaches use the coach dashboard.
	if ((data.profile as any)?.role === 'coach') {
		throw redirect(303, '/coach');
	}
	// Guests (no session), anonymous users, and players all pass through.
	return data;
};
```

- [ ] **Step 2: Verify**

Run (from `mychess/`): `npm run check 2>&1 | grep "(player)/+layout" | grep -i error || echo "no new layout errors"` → no new errors.
Run: `npx vitest run 2>&1 | tail -3` → all pass.

- [ ] **Step 3: Commit**
```bash
git add "mychess/src/routes/(player)/+layout.server.ts"
git commit -m "feat: make / publicly viewable — drop login-wall redirect"
```

---

## Task 4: FideLookupCard component

**Files:**
- Create: `mychess/src/lib/components/FideLookupCard.svelte`
- Test: `mychess/src/lib/components/FideLookupCard.test.ts`

The card is a GET form (`?fide=<id>`) plus a result panel. Props: `query` (string, current `?fide` value) and `result` (`{ found: boolean; player?: {...} } | null`).

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/components/FideLookupCard.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import FideLookupCard from './FideLookupCard.svelte';

afterEach(() => cleanup());

const player = {
  name: 'Konovalovas, Tomas',
  stdRating: null, rapidRating: 1663, blitzRating: 1530,
  countryRankStandard: null, ageBracket: 'open', ageGroupRankStandard: null
};

describe('FideLookupCard', () => {
  it('renders the FIDE id input', () => {
    render(FideLookupCard, { props: { query: '', result: null } });
    expect(screen.getByLabelText(/FIDE ID/i)).toBeTruthy();
  });

  it('shows the player name and ratings when a result is found', () => {
    render(FideLookupCard, { props: { query: '12865168', result: { found: true, player } } });
    expect(screen.getByText('Konovalovas, Tomas')).toBeTruthy();
    expect(screen.getByText('1663')).toBeTruthy();
  });

  it('shows a not-found message when the id has no record', () => {
    render(FideLookupCard, { props: { query: '999', result: { found: false } } });
    expect(screen.getByText(/No FIDE record/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/components/FideLookupCard.test.ts`
Expected: FAIL — component missing.

- [ ] **Step 3: Implement the component**

Create `mychess/src/lib/components/FideLookupCard.svelte`:
```svelte
<script lang="ts">
  let { query = '', result = null } = $props<{
    query?: string;
    result?: { found: boolean; player?: {
      name: string;
      stdRating: number | null; rapidRating: number | null; blitzRating: number | null;
      countryRankStandard: number | null; ageBracket: string | null; ageGroupRankStandard: number | null;
    } } | null;
  }>();
</script>

<section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
  <h2 class="font-semibold text-gray-900 mb-3">Look up a FIDE rank</h2>
  <form method="GET" class="flex gap-2">
    <label class="sr-only" for="fide">FIDE ID</label>
    <input
      id="fide"
      name="fide"
      value={query}
      inputmode="numeric"
      placeholder="FIDE ID, e.g. 12865168"
      class="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
    <button type="submit" class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
      Look up
    </button>
  </form>

  {#if result}
    {#if result.found && result.player}
      <div class="mt-4 border-t border-gray-100 pt-4">
        <p class="font-semibold text-gray-900">{result.player.name}</p>
        <div class="mt-2 grid grid-cols-3 gap-3 text-center">
          <div><p class="text-lg font-bold text-gray-900">{result.player.stdRating ?? '––'}</p><p class="text-xs text-gray-400">Standard</p></div>
          <div><p class="text-lg font-bold text-gray-900">{result.player.rapidRating ?? '––'}</p><p class="text-xs text-gray-400">Rapid</p></div>
          <div><p class="text-lg font-bold text-gray-900">{result.player.blitzRating ?? '––'}</p><p class="text-xs text-gray-400">Blitz</p></div>
        </div>
        <p class="mt-3 text-sm text-gray-500">
          National rank (standard): <span class="font-medium text-gray-900">{result.player.countryRankStandard ?? '––'}</span>
        </p>
      </div>
    {:else}
      <p class="mt-4 text-sm text-gray-500">No FIDE record found for that ID.</p>
    {/if}
  {/if}
</section>
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/lib/components/FideLookupCard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add mychess/src/lib/components/FideLookupCard.svelte mychess/src/lib/components/FideLookupCard.test.ts
git commit -m "feat: add public FideLookupCard component"
```

---

## Task 5: FIDE lookup in the dashboard load

**Files:**
- Modify: `mychess/src/routes/(player)/+page.server.ts`

The guest branch currently returns early with `{ isGuest: true, ... }`. Add a FIDE lookup (from `?fide=`) available to guests, and pass the query through.

- [ ] **Step 1: Add the lookup and thread it into the guest return**

In `mychess/src/routes/(player)/+page.server.ts`, change the `load` signature to also take `url`:
```ts
export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
```
Immediately after the `upcomingTournaments` query block (after the `if (tErr) …` line), add:
```ts
  // Public FIDE rank lookup (?fide=<id>) — reads the public fide_players table.
  const fideQuery = (url.searchParams.get('fide') ?? '').trim();
  let fideLookup: { query: string; found: boolean; player?: any } | null = null;
  if (fideQuery) {
    const { data: row } = await supabase
      .from('fide_players')
      .select('name, std_rating, rapid_rating, blitz_rating, country_rank_standard, age_bracket, age_group_rank_standard')
      .eq('fide_id', fideQuery)
      .single();
    fideLookup = row
      ? {
          query: fideQuery,
          found: true,
          player: {
            name: (row as any).name,
            stdRating: (row as any).std_rating,
            rapidRating: (row as any).rapid_rating,
            blitzRating: (row as any).blitz_rating,
            countryRankStandard: (row as any).country_rank_standard,
            ageBracket: (row as any).age_bracket,
            ageGroupRankStandard: (row as any).age_group_rank_standard
          }
        }
      : { query: fideQuery, found: false };
  }
```
Then change the guest early-return to include the lookup:
```ts
  if (!user) return { isGuest: true, session: null, profile: null, upcomingTournaments: upcomingTournaments ?? [], fideLookup, fideQuery };
```
And add `fideLookup, fideQuery` to the final logged-in `return { ... }` object as well (so the type is consistent; the personal view ignores them).

- [ ] **Step 2: Verify**

Run (from `mychess/`): `npm run check 2>&1 | grep "(player)/+page.server" | grep -i error || echo "no new errors"` → no new errors.
Run: `npx vitest run 2>&1 | tail -3` → all pass.

- [ ] **Step 3: Commit**
```bash
git add "mychess/src/routes/(player)/+page.server.ts"
git commit -m "feat: public FIDE rank lookup on the dashboard load"
```

---

## Task 6: Enrich the guest landing

**Files:**
- Modify: `mychess/src/routes/(player)/+page.svelte`

- [ ] **Step 1: Import the card and render the enriched guest view**

In `mychess/src/routes/(player)/+page.svelte`, add to the component imports:
```svelte
  import FideLookupCard from '$lib/components/FideLookupCard.svelte';
```
Replace the contents of the `{#if data.isGuest}` guest-landing block with:
```svelte
      <!-- Public content landing (no account needed) -->
      <div class="py-8 space-y-6">
        <div class="text-center">
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Your chess, all in one place</h1>
          <p class="text-gray-500">FIDE ranks, local tournaments, and daily training — no account needed to explore.</p>
        </div>

        <FideLookupCard query={data.fideQuery ?? ''} result={data.fideLookup ?? null} />

        <a href="/drill" class="block bg-indigo-600 text-white rounded-xl p-5 hover:bg-indigo-700 transition-colors">
          <p class="font-semibold">Try a drill →</p>
          <p class="text-sm text-indigo-100">No account needed — sign in later to save your progress.</p>
        </a>

        {#if data.upcomingTournaments?.length > 0}
          <section class="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-semibold text-gray-900">Upcoming in Lithuania</h2>
              <a href="/tournaments" class="text-sm text-indigo-600 hover:underline">View all →</a>
            </div>
            <TournamentCarousel tournaments={data.upcomingTournaments} />
          </section>
        {/if}
      </div>
```
(Keep the existing `TournamentCarousel` import; the `{:else}` authenticated-dashboard branch is unchanged.)

- [ ] **Step 2: Verify**

Run (from `mychess/`): `npm run check 2>&1 | grep "(player)/+page.svelte" | grep -i error || echo "no new errors"` → no new errors.
Run: `npx vitest run 2>&1 | tail -3` → all pass.

- [ ] **Step 3: Commit**
```bash
git add "mychess/src/routes/(player)/+page.svelte"
git commit -m "feat: content-rich guest landing (FIDE lookup + tournaments + try a drill)"
```

---

## Task 7: Lazy guest session on training routes

**Files:**
- Modify: `mychess/src/routes/(player)/drill/+page.server.ts`, `.../practice/+page.server.ts`, `.../time-trial/+page.server.ts`, `.../learn/+page.server.ts`

Each of these loads currently starts by reading the session (e.g. `const { user } = await safeGetSession()` / `locals.safeGetSession()`). For each file:

- [ ] **Step 1: Read each training load and apply the guest bootstrap**

For each of the four files, add the import:
```ts
import { ensureGuestSession } from '$lib/server/auth';
```
At the very top of the `load` function body, before any existing session read, insert:
```ts
  const guest = await ensureGuestSession(locals);
  if (!guest) return { needsAccount: true };
```
Then ensure the load uses `guest.user` / `guest.session` / `guest.profile` where it previously read them from its own `safeGetSession()` call (remove the now-duplicate `safeGetSession()` call, or set `const { user, session, profile } = guest;`). The load's function signature must expose `locals` (change `({ locals: { supabase, safeGetSession } })` to also destructure or use `locals` — simplest: `async (event) => { const { locals } = event; const guest = await ensureGuestSession(locals); … }`, keeping existing `locals.supabase` usage).

Worked example — `drill/+page.server.ts` top:
```ts
import { ensureGuestSession } from '$lib/server/auth';
import type { PageServerLoad } from './$types';
// …existing imports…

export const load: PageServerLoad = async ({ locals }) => {
  const guest = await ensureGuestSession(locals);
  if (!guest) return { needsAccount: true };
  const { user } = guest;
  const supabase = locals.supabase;
  // …rest of the existing drill load, using `user` and `supabase`…
};
```

- [ ] **Step 2: Handle `needsAccount` in each training page**

For each training route's `+page.svelte`, at the top of the markup add a guard that shows a sign-in panel when `data.needsAccount` is set:
```svelte
{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-gray-900">Sign in to train</h1>
    <p class="text-gray-500">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-indigo-700">Get started</a>
  </div>
{:else}
  <!-- existing page content -->
{/if}
```
(Wrap the existing content in the `{:else}` branch.)

- [ ] **Step 3: Verify**

Run (from `mychess/`): `npm run check 2>&1 | grep -E "(drill|practice|time-trial|learn)/\+page" | grep -i error || echo "no new errors"` → no new errors.
Run: `npx vitest run 2>&1 | tail -3` → all pass.

- [ ] **Step 4: Commit**
```bash
git add "mychess/src/routes/(player)/drill" "mychess/src/routes/(player)/practice" "mychess/src/routes/(player)/time-trial" "mychess/src/routes/(player)/learn"
git commit -m "feat: lazy guest session for training routes with sign-in fallback"
```

---

## Task 8: Gate personal routes

**Files:**
- Modify: `mychess/src/routes/(player)/repertoires/+page.server.ts`, `.../settings/+page.server.ts`, `.../cosmetics/+page.server.ts`, `.../badges/+page.server.ts`

- [ ] **Step 1: Add the account gate to each load**

For each of the four files, add the import:
```ts
import { requireAccount } from '$lib/server/auth';
```
Replace the load's existing session read with the gate. Where the load currently does `const { user, session, profile } = await safeGetSession();` (or `await locals.safeGetSession()`), change it to:
```ts
  const { user, session, profile } = await requireAccount(locals);
```
Ensure the load signature destructures `locals` (e.g. `async ({ locals }) => { … locals.supabase … }`). `settings/+page.server.ts` also has a `save` (and `disconnect_lichess`) action — leave those actions' own `safeGetSession()` + `fail(401)` checks as they are (they already guard writes); only the `load` gets `requireAccount`.

- [ ] **Step 2: Verify**

Run (from `mychess/`): `npm run check 2>&1 | grep -E "(repertoires|settings|cosmetics|badges)/\+page" | grep -i error || echo "no new errors"` → no new errors.
Run: `npx vitest run 2>&1 | tail -3` → all pass.

- [ ] **Step 3: Commit**
```bash
git add "mychess/src/routes/(player)/repertoires" "mychess/src/routes/(player)/settings" "mychess/src/routes/(player)/cosmetics" "mychess/src/routes/(player)/badges"
git commit -m "feat: gate personal routes behind requireAccount"
```

---

## Task 9: Full verification

**Files:** none (verification).

- [ ] **Step 1: Suite + type-check**

Run (from `mychess/`):
```bash
npx vitest run 2>&1 | tail -4
npm run check 2>&1 | tail -3
```
Expected: all tests pass (prior count + the new `auth` and `FideLookupCard` tests); `npm run check` error count equals the known pre-existing set only.

- [ ] **Step 2: Manual smoke checklist (after deploy + with Anonymous sign-ins enabled in Supabase)**
  - Logged-out `/` shows the content landing (hero + FIDE lookup + tournaments + try-a-drill), no redirect to `/login`.
  - FIDE lookup: enter a standard-rated LTU FIDE ID → shows name, ratings, national rank.
  - "Try a drill" → drill runs as a guest; a "sign in to save" nudge is visible; if anonymous auth is off, the "Sign in to train" panel shows instead.
  - `/repertoires` while logged-out → redirects to `/login`.
  - Logged-in player: `/` shows the personal dashboard; training saves progress.
  - Coach: `/` redirects to `/coach`.

- [ ] **Step 3: Commit (if any residual fixes were needed)** — otherwise nothing to commit.

---

## Self-Review Notes

- **Spec coverage:** session-model change + `ensureGuestProfile` — Task 1; `ensureGuestSession`/`requireAccount` — Task 2; login-wall removal + welcome/coach redirects — Task 3; `FideLookupCard` — Task 4; public FIDE lookup load — Task 5; enriched guest landing — Task 6; lazy guest training + `needsAccount` — Task 7; gated personal routes — Task 8; testing — Tasks 2/4/9. All spec sections mapped.
- **Type consistency:** `ensureGuestSession(locals)`/`requireAccount(locals)` take `App.Locals` and are called with `locals` in Tasks 7/8; `fideLookup` shape `{ query, found, player? }` from Task 5 matches `FideLookupCard`'s `result` prop (`{ found, player? }`) and `player` fields (name/stdRating/rapidRating/blitzRating/countryRankStandard/ageBracket/ageGroupRankStandard) in Task 4; `needsAccount` flag consistent across Task 7 load + page.
- **Placeholder scan:** every code step shows exact code or an exact worked example + transformation rule for the near-identical per-route guard insertions (Tasks 7/8), which the implementer applies per file after reading it.
- **Risk:** removing the eager anon session — Task 3's layout returns nullable data and personal routes gate in Task 8; public/training tolerate null. Task 9 smoke verifies the session flows end-to-end.
