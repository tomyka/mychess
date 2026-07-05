# Onboarding & Switchable Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `/welcome` not populating first/last name, skip name entry for Google sign-ups (use Google's own profile claims), and turn role (Player/Coach) into a switchable Settings control instead of a one-time onboarding choice.

**Architecture:** A new shared `createPlayerProfile` helper replaces the duplicated profile-bootstrap logic in `/welcome` and the Google callback. `/welcome` collects First/Last Name only (role always defaults to `'player'`). The Google callback creates the profile directly from the ID token's claims for brand-new sign-ups, skipping `/welcome` entirely. `/settings` moves out of the `(player)` route group (which redirects any `role = 'coach'` profile away from every page in it) to a top-level route, and gains a Player/Coach toggle.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), `@supabase/ssr`.

Spec: `docs/superpowers/specs/2026-07-06-onboarding-and-role-settings-design.md`

---

### Task 1: Shared `createPlayerProfile` helper

**Files:**
- Create: `mychess/src/lib/server/onboarding.ts`

- [ ] **Step 1: Write the helper**

```ts
// mychess/src/lib/server/onboarding.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type NewProfileInfo = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
};

/**
 * Creates a brand-new player profile plus its dependent rows (player_stats,
 * equipped_cosmetics). Callers must only invoke this when no profile exists
 * yet for this id — it does not check for an existing row itself.
 */
export async function createPlayerProfile(
  supabase: SupabaseClient,
  info: NewProfileInfo
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('profiles').insert({
    id: info.id,
    role: 'player',
    first_name: info.firstName,
    last_name: info.lastName,
    display_name: info.displayName,
    avatar_id: 'knight'
  } as any);
  if (error) return { error: error.message };

  await supabase.from('player_stats').upsert({ player_id: info.id });
  await supabase.from('equipped_cosmetics').upsert({ player_id: info.id });
  return { error: null };
}
```

- [ ] **Step 2: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/server/onboarding.ts
git commit -m "feat: add createPlayerProfile helper for new-account bootstrap"
```

No test file for this task — the closest existing analog, `ensureGuestProfile` in `mychess/src/lib/server/guest.ts`, also has no test file. This matches that established precedent; verified manually via Tasks 3/4's manual sign-up checks.

---

### Task 2: Move `/settings` out of `(player)`, add the role switch

**Files:**
- Move: `mychess/src/routes/(player)/settings/+page.server.ts` → `mychess/src/routes/settings/+page.server.ts`
- Move: `mychess/src/routes/(player)/settings/+page.svelte` → `mychess/src/routes/settings/+page.svelte`

- [ ] **Step 1: Move the files with git, preserving history**

```bash
git mv "mychess/src/routes/(player)/settings/+page.server.ts" mychess/src/routes/settings/+page.server.ts
git mv "mychess/src/routes/(player)/settings/+page.svelte" mychess/src/routes/settings/+page.svelte
```

(SvelteKit route groups — the parenthesized `(player)` folder — are purely organizational and never appear in the URL, so this move does not change the `/settings` URL. Every existing `href="/settings"` link elsewhere in the app keeps working unchanged. This move is necessary because `mychess/src/routes/(player)/+layout.server.ts` redirects any profile with `role = 'coach'` away from every page in that group — including Settings — which would make it impossible for a coach to switch back to Player.)

- [ ] **Step 2: Add the role field to the server load/save**

In `mychess/src/routes/settings/+page.server.ts`, change:

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

to:

```ts
  return {
    session,
    profile,
    role: p?.role ?? 'player',
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
```

to:

```ts
    const fd = await request.formData();
    const firstName = (fd.get('first_name') as string ?? '').trim();
    const lastName = (fd.get('last_name') as string ?? '').trim();
    const fideId = (fd.get('fide_id') as string ?? '').trim();
    const rawRole = (fd.get('role') as string ?? '').trim();
    const role = rawRole === 'coach' ? 'coach' : 'player';
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
        role,
        ...(displayName ? { display_name: displayName } : {})
      } as any)
      .eq('id', user.id);
```

- [ ] **Step 3: Add the role toggle to the Settings UI**

In `mychess/src/routes/settings/+page.svelte`, change:

```svelte
  const d = $derived(data as any);
  let importing = $state<'chesscom' | 'lichess' | null>(null);
  let importResult = $state<string | null>(null);
```

to:

```svelte
  const d = $derived(data as any);
  let role = $state<'player' | 'coach'>((data as any)?.role ?? 'player');
  let importing = $state<'chesscom' | 'lichess' | null>(null);
  let importResult = $state<string | null>(null);
```

Then, change:

```svelte
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="fide_id">FIDE ID</label>
```

to:

```svelte
        <div>
          <span class="block text-sm font-medium text-gray-700 mb-1">I am a</span>
          <div class="flex gap-3">
            {#each [{ id: 'player', label: 'Player' }, { id: 'coach', label: 'Coach' }] as r}
              <button
                type="button"
                onclick={() => (role = r.id)}
                class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm
                       {role === r.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
              >
                {r.label}
              </button>
            {/each}
          </div>
          <input type="hidden" name="role" value={role} />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1" for="fide_id">FIDE ID</label>
```

- [ ] **Step 4: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no errors referencing `settings/+page.server.ts` or `settings/+page.svelte`. Confirm the old `(player)/settings/` directory no longer exists (it should be empty/gone after the `git mv`).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/routes/settings
git commit -m "feat: move Settings out of (player) group, add Player/Coach switch"
```

(`git mv` in Step 1 already staged the old path's removal — only the new path needs `git add` here, for the edits made in Steps 2-3.)

---

### Task 3: `/welcome` collects name only, no role

**Files:**
- Modify: `mychess/src/routes/welcome/+page.svelte`
- Modify: `mychess/src/routes/welcome/+page.server.ts`

- [ ] **Step 1: Replace the welcome page**

Replace the full contents of `mychess/src/routes/welcome/+page.svelte` with:

```svelte
<script lang="ts">
  let { form } = $props<{ form: any }>();
</script>

<main class="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-8 p-6">
  <div class="text-center">
    <div class="flex items-center justify-center gap-2 font-bold text-gray-900 mb-3">
      <span class="text-3xl">♟</span>
      <span class="text-2xl">MyChess</span>
    </div>
    <h1 class="text-2xl font-bold text-gray-900">Welcome! What's your name?</h1>
    <p class="mt-1 text-gray-500">So we can set up your dashboard</p>
  </div>

  {#if form?.error}
    <p class="text-red-600 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm">{form.error}</p>
  {/if}

  <form method="POST" class="flex flex-col gap-4 w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
    <div class="grid grid-cols-2 gap-4">
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-gray-700">First Name</span>
        <input
          name="first_name"
          required
          placeholder="e.g. Magnus"
          class="rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>
      <label class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-gray-700">Last Name</span>
        <input
          name="last_name"
          required
          placeholder="e.g. Carlsen"
          class="rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>
    </div>

    <button
      type="submit"
      class="bg-indigo-600 text-white py-3 rounded-xl font-bold text-base hover:bg-indigo-700 transition-colors">
      Get started →
    </button>
  </form>
</main>
```

- [ ] **Step 2: Replace the welcome server logic**

Replace the full contents of `mychess/src/routes/welcome/+page.server.ts` with:

```ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { fullNameOrNull } from '$lib/profile';
import { createPlayerProfile } from '$lib/server/onboarding';

export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { session, profile } = await safeGetSession();
	if (!session) throw redirect(303, '/login');
	if (profile) throw redirect(303, (profile as any).role === 'coach' ? '/coach' : '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Not logged in' });

		const data = await request.formData();
		const firstName = (data.get('first_name') as string ?? '').trim();
		const lastName = (data.get('last_name') as string ?? '').trim();
		if (!firstName || !lastName) return fail(400, { error: 'First and last name are required' });

		const displayName = fullNameOrNull(firstName, lastName) ?? 'Player';
		const { error } = await createPlayerProfile(supabase, {
			id: user.id,
			firstName,
			lastName,
			displayName
		});
		if (error) return fail(500, { error });

		throw redirect(303, '/');
	}
};
```

- [ ] **Step 3: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no errors referencing `welcome/+page.svelte` or `welcome/+page.server.ts`.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/routes/welcome/+page.svelte mychess/src/routes/welcome/+page.server.ts
git commit -m "refactor: /welcome collects name only, role defaults to player"
```

---

### Task 4: Google sign-ups skip `/welcome`

**Files:**
- Modify: `mychess/src/routes/auth/callback/google/+server.ts`

- [ ] **Step 1: Create the profile from Google's claims for brand-new sign-ups**

In `mychess/src/routes/auth/callback/google/+server.ts`, change the import line:

```ts
import { verifyState } from '$lib/server/oauth';
```

to:

```ts
import { verifyState, decodeJwtPayload } from '$lib/server/oauth';
import { fullNameOrNull } from '$lib/profile';
import { createPlayerProfile } from '$lib/server/onboarding';
```

Then change:

```ts
  const { error: signInError } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce
  });

  if (signInError) {
    throw redirect(303, `/login?error=${encodeURIComponent(signInError.message)}`);
  }

  throw redirect(303, '/');
};
```

to:

```ts
  const { data: signInData, error: signInError } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce
  });

  if (signInError) {
    throw redirect(303, `/login?error=${encodeURIComponent(signInError.message)}`);
  }

  // Brand-new Google sign-ups skip /welcome — we already have their name from
  // Google, so create the profile here instead of asking again. Existing
  // users signing back in already have a profile, so this branch is skipped.
  const newUserId = signInData.user?.id;
  if (newUserId) {
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', newUserId)
      .single();

    if (!existingProfile) {
      const claims = decodeJwtPayload(idToken);
      const firstName = (claims.given_name as string | undefined)?.trim() || null;
      const lastName = (claims.family_name as string | undefined)?.trim() || null;
      const displayName =
        fullNameOrNull(firstName ?? '', lastName ?? '') ??
        (claims.name as string | undefined) ??
        'Player';

      await createPlayerProfile(supabase, {
        id: newUserId,
        firstName,
        lastName,
        displayName
      });
    }
  }

  throw redirect(303, '/');
};
```

- [ ] **Step 2: Type-check the project**

Run: `npm run check` (from `mychess/`)
Expected: no new errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/auth/callback/google/+server.ts
git commit -m "feat: create profile from Google claims for new sign-ups, skip /welcome"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run` (from `mychess/`; this machine's default Node is too old for jsdom-based component tests, hence the PATH override)
Expected: PASS — no regressions in any existing test.

- [ ] **Step 2: Run the full type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors (same pre-existing unrelated error count as before this feature).

- [ ] **Step 3: Grep for stragglers**

Run: `grep -rn "display_name.*required\|name=\"display_name\"" mychess/src`
Expected: no matches — confirms the old single "Your name" field is fully gone from `/welcome`.

Run: `find "mychess/src/routes/(player)/settings" -type f 2>&1`
Expected: "No such file or directory" (or empty) — confirms the old Settings location is gone.

- [ ] **Step 4: Manually verify in the dev server**

Run: `npm run dev` (from `mychess/`), then in a browser:
- Sign up fresh via email magic link → should land on `/welcome` asking for First Name + Last Name only (no role picker) → after submitting, land on `/` as a Player.
- Visit `/settings` as that new player → confirm First Name/Last Name are populated (not empty — this is the original bug, now fixed) and a Player/Coach toggle is present, defaulted to Player.
- Switch to Coach in Settings, save, then visit `/` → confirm you're redirected to `/coach`.
- From the coach dashboard, visit `/settings` again → confirm it's reachable (this was impossible before Task 2's move) and switch back to Player.
- Sign up fresh via Google (a Google account that has never signed into this app before) → confirm you land directly on `/` with your Google name already set as the display name, `/welcome` is never shown.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as part of the task where the bug was introduced and re-run this task's steps.
