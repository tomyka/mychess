# Remove Anonymous Guest Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete anonymous authentication from MyChess so no code path can mint a throwaway `auth.users` row, and gate `/drill` and `/time-trial` behind a real account.

**Architecture:** Remove the capability rather than relocate it — delete `ensureGuestSession`/`ensureGuestProfile` outright, switch the two ungated routes to the existing `requireAccount` guard used by their five siblings, and rename the now-misleading `isGuest` flag to `isSignedOut`. `/` stays public and keeps its existing landing page.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Supabase (`@supabase/ssr`), Vitest, TypeScript (`svelte-check`).

**Spec:** `docs/superpowers/specs/2026-08-19-remove-anonymous-guest-auth-design.md`
**Issue:** tomyka/mychess#88

---

## Working context

All `npm` commands run from `mychess/` (the SvelteKit app), not the repo root. Paths below are relative to `mychess/` unless stated otherwise.

**Two conventions from CLAUDE.md that govern this work:**

1. `requireAccount`'s return type cannot be narrowed by TypeScript, so call sites use `user!.id` afterward. This is intentional and matches sibling files — do not "fix" it with a null check.
2. Modules under `src/lib/server/` that touch Supabase are, by established precedent, not unit-tested directly. So the two route `load` changes get **no new unit tests**; they are one-line delegations to `requireAccount`, which already has full test coverage (real user / no user / anonymous user). They are verified by `svelte-check` plus the manual pass in Task 6. This is deliberate, not an omission.

**Do not remove the `is_anonymous` check in `requireAccount` (`src/lib/server/auth.ts:9`).** Anonymous rows still exist in production and their refresh tokens stay valid until the provider is disabled and issue #90 purges them. That clause is what stops a stale guest cookie from walking into a gated page. Its test at `auth.test.ts:42-45` stays too, and becomes load-bearing.

## File Structure

| File | Change | Responsibility after |
| --- | --- | --- |
| `src/lib/server/guest.ts` | **Delete** | — (gone) |
| `src/lib/server/auth.ts` | Modify: drop lines 2, 22-49 | `requireAccount` + `requireApiUser` only |
| `src/lib/server/auth.test.ts` | Modify: drop lines 2 (partial), 4, 10-29, 48-65 | Tests `requireAccount` only |
| `src/hooks.server.ts` | Modify: lines 6, 45-48, 61, 77, 37 | Session resolution without anonymous handling |
| `src/routes/(player)/drill/+page.server.ts` | Modify: lines 2, 5-8, 14, 50 | Account-gated drill load |
| `src/routes/(player)/drill/+page.svelte` | Modify: lines 74-80, final line | Drill UI, no signed-out branch |
| `src/routes/(player)/time-trial/+page.server.ts` | Modify: lines 2, 5-8, 14 | Account-gated time-trial load |
| `src/routes/(player)/time-trial/+page.svelte` | Modify: lines 83-89, final line | Time-trial UI, no signed-out branch |
| `src/app.d.ts` | Modify: lines 11, 17 | `isSignedOut: boolean`, required |
| `src/routes/(player)/+page.server.ts` | Modify: lines 11, 44, 47, 137 | Public landing, `isSignedOut` |
| `src/routes/(player)/+page.svelte` | Modify: line 37 | Consumes `data.isSignedOut` |
| `src/lib/components/NavBar.svelte` | Modify: lines 10, 41, 54, 132, 148 | Local `isSignedOut` derive |

Untouched on purpose: `src/lib/profile.ts` (`GUEST_DISPLAY_NAME`/`isPlaceholderName` still serve empty-name accounts), `static/robots.txt`, migration 0056.

---

### Task 1: Gate `/drill` behind a real account

**Files:**
- Modify: `src/routes/(player)/drill/+page.server.ts:2`, `:5-8`, `:14`, `:50`
- Modify: `src/routes/(player)/drill/+page.svelte:74-80`, final line

- [ ] **Step 1: Switch the load to `requireAccount`**

In `src/routes/(player)/drill/+page.server.ts`, replace lines 1-9 (imports through the `supabase` binding):

```ts
import type { PageServerLoad } from './$types';
import { ensureGuestSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const guest = await ensureGuestSession(locals);
  if (!guest) return { needsAccount: true };
  const { user, session, profile } = guest;
  if (!user) return { needsAccount: true };
  const supabase = locals.supabase;
```

with:

```ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const { user, session, profile } = await requireAccount(locals);
  const supabase = locals.supabase;
```

- [ ] **Step 2: Add the non-null assertions**

`requireAccount`'s return type isn't narrowable, so both `user.id` references need `!`. On line 14 (was `.eq('player_id', user.id);` in the repertoires query) and on line 50 (was `.eq('player_id', user.id);` in the reviews query), change:

```ts
    .eq('player_id', user.id);
```

to:

```ts
    .eq('player_id', user!.id);
```

There are exactly two such lines in this file. This matches the convention in the five already-gated sibling routes.

- [ ] **Step 3: Delete the unreachable signed-out branch**

`src/routes/(player)/drill/+page.svelte` wraps its entire body in `{#if data.needsAccount} … {:else} … {/if}`. All three parts must go, or the build fails on an unmatched block.

Delete lines 74-79:

```svelte
{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-(--color-text)">Sign in to train</h1>
    <p class="text-(--color-muted)">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-(--color-accent) text-white px-5 py-2.5 rounded-lg font-medium hover:bg-(--color-accent-hover)">Get started</a>
  </div>
```

Delete the `{:else}` on line 80.

Delete the closing `{/if}` on the file's final line (line 146 before edits).

Leave the page body between them alone — do not reflow its indentation, it makes the diff unreadable for no gain. The inner `{#if allMoves.length === 0}` empty state stays: a signed-in player with no repertoires still needs it.

- [ ] **Step 4: Type check**

```bash
npm run check
```

Expected: `0 ERRORS`. A dangling `{:else}` or `{/if}` shows up here as a Svelte parse error naming the file — if that happens, Step 3 was applied incompletely.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(player)/drill/+page.server.ts" "src/routes/(player)/drill/+page.svelte"
git commit -m "feat: require an account for /drill

Was the only gate that minted an anonymous session instead of redirecting.
Now uses requireAccount like its five sibling routes. The needsAccount
branch is unreachable once the guard redirects, so it is deleted along with
its inert /login?signup=1 link."
```

---

### Task 2: Gate `/time-trial` behind a real account

**Files:**
- Modify: `src/routes/(player)/time-trial/+page.server.ts:2`, `:5-8`, `:14`
- Modify: `src/routes/(player)/time-trial/+page.svelte:83-89`, final line

- [ ] **Step 1: Switch the load to `requireAccount`**

In `src/routes/(player)/time-trial/+page.server.ts`, replace lines 1-9:

```ts
import type { PageServerLoad } from './$types';
import { ensureGuestSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const guest = await ensureGuestSession(locals);
  if (!guest) return { needsAccount: true };
  const { user, session, profile } = guest;
  if (!user) return { needsAccount: true };
  const supabase = locals.supabase;
```

with:

```ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const { user, session, profile } = await requireAccount(locals);
  const supabase = locals.supabase;
```

- [ ] **Step 2: Add the non-null assertion**

This file has exactly **one** `user.id` reference, on line 14. Change:

```ts
    .eq('player_id', user.id);
```

to:

```ts
    .eq('player_id', user!.id);
```

- [ ] **Step 3: Delete the unreachable signed-out branch**

Same `{#if}/{:else}/{/if}` wrapper structure as drill. Delete lines 83-88:

```svelte
{#if data.needsAccount}
  <div class="max-w-md mx-auto text-center py-16 space-y-4">
    <h1 class="text-2xl font-bold text-(--color-text)">Sign in to train</h1>
    <p class="text-(--color-muted)">Guest training is unavailable right now. Create a free account to start.</p>
    <a href="/login?signup=1" class="inline-block bg-(--color-accent) text-white px-5 py-2.5 rounded-lg font-medium hover:bg-(--color-accent-hover)">Get started</a>
  </div>
```

Delete the `{:else}` on line 89.

Delete the closing `{/if}` on the file's final line (line 156 before edits).

Keep the inner `{#if allMoves.length === 0}` empty state.

- [ ] **Step 4: Type check**

```bash
npm run check
```

Expected: `0 ERRORS`.

- [ ] **Step 5: Commit**

```bash
git add "src/routes/(player)/time-trial/+page.server.ts" "src/routes/(player)/time-trial/+page.svelte"
git commit -m "feat: require an account for /time-trial

Second and last route that minted an anonymous session from its load
function. Same treatment as /drill: requireAccount, and delete the now
unreachable needsAccount branch."
```

---

### Task 3: Delete the minting capability

**Run this AFTER Tasks 1 and 2.** Deleting `ensureGuestSession` while `/drill` or `/time-trial` still import it puts `svelte-check` into a 2-error state (`Module '"$lib/server/auth"' has no exported member 'ensureGuestSession'`). Gating those two routes first removes the only callers, so this task's deletions land on a codebase that already has none — every commit boundary stays green and no throwaway stopgap is needed.

**Files:**
- Delete: `src/lib/server/guest.ts`
- Modify: `src/lib/server/auth.ts:2`, `src/lib/server/auth.ts:22-49`
- Modify: `src/lib/server/auth.test.ts:2`, `:4`, `:10-29`, `:48-65`
- Modify: `src/hooks.server.ts:6`, `:45-48`

- [ ] **Step 1: Delete the guest-session tests**

These test code that is about to stop existing, so they go first — leaving them would break the suite mid-task.

In `src/lib/server/auth.test.ts`, change line 2 from:

```ts
import { requireAccount, ensureGuestSession } from './auth';
```

to:

```ts
import { requireAccount } from './auth';
```

Then delete line 4 entirely:

```ts
vi.mock('./guest', () => ({ ensureGuestProfile: vi.fn(async () => {}) }));
```

Then delete the whole `fakeGuestLocals` helper (lines 10-29) and the whole `describe('ensureGuestSession', ...)` block (lines 48-65).

`vi` is still imported on line 1 but no longer used once the mock is gone — remove `vi` from that import so lint stays clean:

```ts
import { describe, it, expect } from 'vitest';
```

The `describe('requireAccount', ...)` block and the `fakeLocals` helper stay exactly as they are — all three of its cases remain valid.

- [ ] **Step 2: Run the tests to confirm they still pass**

```bash
npx vitest run src/lib/server/auth.test.ts
```

Expected: PASS, 3 tests (the three `requireAccount` cases).

- [ ] **Step 3: Delete `ensureGuestSession` and the guest module**

In `src/lib/server/auth.ts`, delete line 2:

```ts
import { ensureGuestProfile } from './guest';
```

and delete everything from line 22 to line 49 — the entire docstring plus the `ensureGuestSession` function. The file should end after `requireApiUser`'s closing brace, leaving exactly:

```ts
import { error, redirect } from '@sveltejs/kit';

type Locals = App.Locals;

/** Requires a real (non-anonymous) signed-in account. Redirects to /login otherwise. */
export async function requireAccount(locals: Locals) {
	const data = await locals.safeGetSession();
	if (!data.user || (data.user as any).is_anonymous) {
		throw redirect(303, '/login');
	}
	return data;
}

/** Requires a signed-in user for a JSON API route. Throws a 401 (not a redirect) otherwise. */
export async function requireApiUser(locals: Locals) {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Unauthorized');
	return user;
}
```

Then delete the module:

```bash
rm src/lib/server/guest.ts
```

- [ ] **Step 4: Remove the anonymous-profile branch from hooks**

In `src/hooks.server.ts`, delete line 6:

```ts
import { ensureGuestProfile } from '$lib/server/guest';
```

Then delete lines 45-48 — the branch and its comment:

```ts
		// A lazily-created anonymous session may not have its guest profile yet.
		if (!profile && session.user.is_anonymous) {
			await ensureGuestProfile(event.locals.supabase, session.user.id);
		}
```

Removing this changes behaviour for one case only: a signed-in user whose `profiles` row is missing. Previously an anonymous user got one created here; now the `resolvedProfile` re-fetch below simply resolves to `null`, and `(player)/+layout.server.ts:8` already redirects a real account with no profile to `/welcome`. That is the correct path for a profile-less account.

- [ ] **Step 5: Verify nothing references the deleted code**

```bash
grep -rn "signInAnonymously\|ensureGuestSession\|ensureGuestProfile\|server/guest" src/
```

Expected: no output.

- [ ] **Step 6: Run the full suite and type check**

```bash
npm test && npm run check
```

Expected: all tests pass; `check` reports `0 ERRORS`. Warnings are pre-existing (17 of them) and fine.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/auth.ts src/lib/server/auth.test.ts src/hooks.server.ts
git rm src/lib/server/guest.ts
git commit -m "refactor: delete anonymous guest session minting

ensureGuestSession() was called from two page loads, so every GET minted an
anonymous auth user plus three dependent rows. Removes the capability
outright rather than relocating it, so no future route can reintroduce the
leak. requireAccount keeps its is_anonymous check as a guard against stale
guest cookies until existing rows are purged (#90)."
```

---

### Task 4: Rename `isGuest` to `isSignedOut`

`isGuest` currently means "no session **or** anonymous session". With anonymous sessions gone it means only "no session", so the name misleads. This is a rename, not a removal — `/` stays public and genuinely has signed-out visitors.

**Files:**
- Modify: `src/app.d.ts:11`, `:17`
- Modify: `src/hooks.server.ts:37`, `:77`
- Modify: `src/routes/(player)/+page.server.ts:11`, `:44`, `:47`, `:137`
- Modify: `src/routes/(player)/+page.svelte:37`
- Modify: `src/lib/components/NavBar.svelte:10`, `:41`, `:54`, `:132`, `:148`

- [ ] **Step 1: Make the field required in both type declarations**

In `src/app.d.ts`, line 11 (inside `Locals.safeGetSession`'s return type) and line 17 (inside `PageData`) both currently read:

```ts
				isGuest?: boolean;
```

Change both to:

```ts
				isSignedOut: boolean;
```

Dropping the `?` is the point of this step: it forces every return site to state the value instead of relying on `undefined` being falsy, which is what hides the second hooks site found in Step 2.

- [ ] **Step 2: Set it on both hooks return paths**

In `src/hooks.server.ts`, line 37 currently omits the field entirely — legal only while it was optional:

```ts
		if (!session) return { session: null, user: null, profile: null };
```

Change to:

```ts
		if (!session) return { session: null, user: null, profile: null, isSignedOut: true };
```

Then line 77:

```ts
		return { session, user: session.user, profile: resolvedProfile, isGuest: !!session.user.is_anonymous };
```

Change to:

```ts
		return { session, user: session.user, profile: resolvedProfile, isSignedOut: false };
```

A resolved session means a signed-in user, so this is unconditionally `false`.

- [ ] **Step 3: Update the landing page load**

In `src/routes/(player)/+page.server.ts`, line 11:

```ts
  const isGuest = !user || !!(user as any).is_anonymous;
```

Change to:

```ts
  // Anonymous sessions count as signed-out: rows from the removed guest-auth
  // flow still exist in production with valid refresh tokens until they are
  // purged (#90), and they must not reach the authenticated pipeline — it
  // seeds quest rows. Mirrors requireAccount's own is_anonymous check.
  const isSignedOut = !user || !!(user as any).is_anonymous;
```

**Keep the `is_anonymous` disjunct — only the name changes.** This step originally said to narrow the test to plain `!user`, and that was wrong: a code-quality reviewer caught it during implementation. Anonymous rows still exist in production with valid refresh tokens until #90 purges them, so narrowing the test flips them from "guest" to "signed in" — and `/` would then run the authenticated pipeline for them, reaching `ensureDailyQuests` (`src/lib/server/quests.ts:69`), which **inserts quest rows**. That is precisely the DB pollution this change exists to eliminate. Apply the same reasoning at the other two consumers: `NavBar.svelte`'s local derive keeps `|| user.is_anonymous`, and `hooks.server.ts`'s resolved-session return uses `isSignedOut: !!session.user.is_anonymous` rather than a hardcoded `false`.

Update the comment and branch at lines 43-44:

```ts
  // Guests (no session AND anonymous) get the public landing — don't run the
  // authenticated pipeline (quest seeding, leaderboard) for throwaway accounts.
  if (isGuest) {
```

Change to:

```ts
  // Signed-out visitors get the public landing — don't run the authenticated
  // pipeline (quest seeding, leaderboard) for them.
  if (isSignedOut) {
```

Line 47's return:

```ts
    return { isGuest: true, session: null, profile: null, upcomingTournaments: upcomingTournaments ?? [], fideLookup, fideQuery };
```

Change to:

```ts
    return { isSignedOut: true, session: null, profile: null, upcomingTournaments: upcomingTournaments ?? [], fideLookup, fideQuery };
```

And line 137, inside the final return object:

```ts
    isGuest,
```

Change to:

```ts
    isSignedOut,
```

- [ ] **Step 4: Update the landing page component**

In `src/routes/(player)/+page.svelte`, line 37:

```svelte
    {#if data.isGuest}
```

Change to:

```svelte
    {#if data.isSignedOut}
```

The public landing markup inside it ("Your chess, all in one place") is unchanged — this page keeps working for visitors with no account.

- [ ] **Step 5: Update NavBar's local derive**

`NavBar.svelte` does not read the prop; it derives its own value. Line 10:

```svelte
  const isGuest = $derived(!user || user.is_anonymous);
```

Change to:

```svelte
  const isSignedOut = $derived(!user);
```

Then rename the four usages, at lines 41, 54, 132, and 148 — `{:else if !isGuest}` becomes `{:else if !isSignedOut}`, `{#if isGuest}` becomes `{#if isSignedOut}`, and `{#if !isGuest}` becomes `{#if !isSignedOut}`. Verify none remain:

```bash
grep -rn "isGuest" src/
```

Expected: no output.

- [ ] **Step 6: Run the full suite and type check**

```bash
npm test && npm run check
```

Expected: all tests pass; `0 ERRORS`. If `check` reports a missing `isSignedOut` property somewhere, that is Step 1's required-field change doing its job — add the field at the site it names.

- [ ] **Step 7: Commit**

```bash
git add src/app.d.ts src/hooks.server.ts "src/routes/(player)/+page.server.ts" "src/routes/(player)/+page.svelte" src/lib/components/NavBar.svelte
git commit -m "refactor: rename isGuest to isSignedOut

The flag meant 'no session OR anonymous session'. With anonymous sessions
removed it only means 'no session', so the old name misleads. Also made the
field required rather than optional in app.d.ts, which surfaced the
no-session return path in hooks that had been omitting it entirely."
```

---

### Task 5: Correct the display_name backfill's comment — keep its logic

**Files:**
- Modify: `mychess/src/hooks.server.ts` — the comment above the backfill guard only

- [ ] **Step 1: Do NOT change the guard. Read this first.**

This task originally said to delete the `!session.user.is_anonymous` line from the guard, on the grounds that it was "always true now." **That was wrong and the instruction is withdrawn.** It repeated the same false premise that caused the Task 4 regression: anonymous rows still exist in production, with valid refresh tokens, until #90 purges them.

Leave the guard exactly as it is:

```ts
		if (
			resolvedProfile &&
			!session.user.is_anonymous &&
			isPlaceholderName((resolvedProfile as any).display_name)
		) {
```

Rationale for keeping it, so nobody removes it later thinking it is dead: dropping it is *probably* inert, because guest profiles were created with only `role`, `display_name`, and `avatar_id`, so `fullNameOrNull(null, null)` returns `null` and no write happens. But that safety depends entirely on no anonymous row ever carrying a `first_name` — and a guest who filled in name fields before converting would defeat it and get written to. Keeping the clause costs nothing and matches how `requireAccount` and all three `isSignedOut` consumers now treat anonymous sessions. It comes out later, together with `requireAccount`'s, once #90 has purged the rows.

Also keep `GUEST_DISPLAY_NAME` and `isPlaceholderName` in `src/lib/profile.ts` — `isPlaceholderName` returns true for `''` as well as `'Guest'`, so the backfill genuinely serves real accounts with an empty display name. Deleting it would be a live regression, not cleanup.

- [ ] **Step 2: Fix only the comment**

The comment above the guard misdescribes what the block does — it frames it as guest-conversion-specific when `isPlaceholderName` also matches empty names. It currently reads:

```ts
		// Backfill display_name for accounts that converted from a guest: they
		// keep the "Guest" placeholder even after a real name is set. Once a
		// name exists on a non-anonymous account, adopt it as the display name.
```

Change to:

```ts
		// Backfill display_name for any account still carrying a placeholder —
		// an empty string, or the literal "Guest" left behind by a profile the
		// removed guest-auth flow created. Once a real name exists, adopt it.
		// The is_anonymous clause stays deliberately: anonymous rows still exist
		// with valid refresh tokens until they are purged (#90), and they are
		// treated as non-accounts everywhere else too (see requireAccount).
```

- [ ] **Step 3: Run the full suite and type check**

```bash
npm test && npm run check
```

Expected: **641** tests passing; `0 ERRORS` and 17 WARNINGS. A comment-only change must not move either number — if it does, something else was touched.

- [ ] **Step 4: Commit**

```bash
git add mychess/src/hooks.server.ts
git commit -m "docs: correct the display_name backfill comment

The comment framed the block as guest-conversion-specific, but
isPlaceholderName also matches an empty display name, so it serves real
accounts too. Records why the is_anonymous clause is deliberately retained:
anonymous rows still exist with valid refresh tokens until #90 purges them, so
the clause is not vacuous, and dropping it would risk writing to an anonymous
profile that happened to carry a first_name. No logic change."
```

---

### Task 6: Update CLAUDE.md, verify end to end, hand off the manual step

**Files:**
- Modify: `mychess/CLAUDE.md` — the "Auth model" section

- [ ] **Step 0: Update CLAUDE.md's Auth model section**

Added after a code-quality reviewer caught it during Task 3. `mychess/CLAUDE.md`'s "Auth model" section still documents the deleted architecture as current — it names `src/lib/server/guest.ts`, `ensureGuestSession`, and `ensureGuestProfile`, and describes guest-profile auto-creation and guest→real conversion as live behaviour. None of that exists any more.

This matters more than a normal stale comment: CLAUDE.md is the file that orients every future session in this repo, so leaving it describing a removed subsystem actively misleads later work.

Rewrite the bullets in that section so they describe what is actually true after this change:
- `locals.safeGetSession()` remains the single source of truth, returning `{ session, user, profile, isSignedOut }` — note the renamed field (Task 4), and that it still does not eagerly create a session, so public pages render with `user: null`.
- Anonymous/guest sessions no longer exist. Delete the bullet describing `ensureGuestSession`/`ensureGuestProfile` and the `"Guest"` placeholder profile. State plainly that anonymous auth was removed, and why: it minted a throwaway account on every GET of `/drill` and `/time-trial`.
- `requireAccount(locals)` keeps its `is_anonymous` check deliberately, to reject stale guest cookies whose refresh tokens are still valid until the Supabase provider is disabled and the existing rows are purged (#90). Say so explicitly, so nobody later "cleans up" what looks like a vestigial branch. Keep the existing note that call sites use `user!.id` because the return type cannot be narrowed.
- Replace the guest→real conversion bullet: `display_name` backfill still exists in `hooks.server.ts`, but its purpose is now any placeholder name — `isPlaceholderName` matches an empty string as well as the literal `'Guest'`, and converted-guest rows may still carry `'Guest'` until #90 runs.

Also check the "Route groups gate by role" section: it says of `src/routes/(player)/` that "Guests (no session) and anonymous sessions pass through". Update it — `/` still renders for a signed-out visitor, but all seven sub-pages now require a real account via `requireAccount`.

- [ ] **Step 1: Confirm every acceptance criterion mechanically**

```bash
grep -rn "signInAnonymously\|ensureGuestSession\|ensureGuestProfile" src/ ; echo "--- expect no output above ---"
test -f src/lib/server/guest.ts && echo "FAIL: guest.ts still exists" || echo "OK: guest.ts deleted"
grep -rn "isGuest" src/ ; echo "--- expect no output above ---"
grep -rn "needsAccount" src/ ; echo "--- expect no output above ---"
grep -c "is_anonymous" src/lib/server/auth.ts ; echo "--- expect 1 (the requireAccount guard, intentionally kept) ---"
```

- [ ] **Step 2: Run the full gate**

```bash
npm test && npm run check
```

Expected: 641 tests pass (643 at baseline, minus the 2 guest tests deleted in Task 3), and `check` reports `0 ERRORS` with 17 WARNINGS. Per CLAUDE.md, zero errors is required before pushing to `main` — there is no tolerated baseline. The 17 warnings are pre-existing and must be left alone.

- [ ] **Step 3: Manual verification against a running app**

```bash
npm run dev
```

Signed out (use a fresh incognito window):
- `/` renders the public landing with the signed-out NavBar showing the single "Sign in" button
- `/drill` redirects to `/login`
- `/time-trial` redirects to `/login`

Signed in with an account that owns no repertoires:
- `/drill` renders its "no moves" empty state, not a redirect and not a blank page
- `/time-trial` renders its empty state

- [ ] **Step 4: Confirm no new anonymous users were created during testing**

This is the whole point of the change, so verify it rather than assume it. Requires the service-role key — the permission classifier blocks Claude from reading `.env`, so the user runs this. Count anonymous users before and after the manual pass; the number must not move.

- [ ] **Step 5: Push**

```bash
git push origin main
```

Per CLAUDE.md, `main` auto-deploys via Vercel and pushing directly is expected for this project.

- [ ] **Step 6: Hand off the dashboard step**

Ask the user to disable **Anonymous sign-ins** in Supabase Dashboard → Authentication → Providers.

State plainly why this is not optional: the code changes stop *the app* from minting, but while the provider is enabled a direct POST to the project's `/auth/v1/signup` endpoint still creates anonymous users. Both halves are required for the leak to be closed. Suggest enabling CAPTCHA on auth endpoints at the same time as defence in depth.

- [ ] **Step 7: Close the issue once the dashboard step is confirmed**

Do **not** close #88 on the strength of the push alone. Its final acceptance criterion depends on a manual step outside Claude's control, and CLAUDE.md is explicit that pushing code is insufficient in that case. Wait for the user to confirm, then:

```bash
gh issue close 88 --comment "Shipped. ensureGuestSession and lib/server/guest.ts deleted, so no code path calls signInAnonymously. /drill and /time-trial now use requireAccount like their five siblings, and their unreachable needsAccount branches are gone. isGuest renamed to isSignedOut (required, not optional, in app.d.ts), meaning 'not a usable real account' — the is_anonymous disjunct is retained at every consumer, because stale anonymous sessions stay valid until #90 purges them, and treating them as signed-in would have let / seed quest rows for them. / remains public with its existing landing page. The display_name backfill was kept — isPlaceholderName also matches empty names — with only its now-always-true is_anonymous clause dropped. requireAccount keeps its own is_anonymous check to reject stale guest cookies until #90 purges the existing rows. Anonymous sign-ins disabled in the dashboard, confirmed by the user. Full test suite and svelte-check clean."
```

Then note that #90 (purging the existing anonymous rows) is now unblocked, since the pile has stopped growing.

---

## Notes for the implementer

**Task order matters, and it is not the obvious order.** Gating (Tasks 1 and 2) must come *before* the deletion (Task 3), not after. Deleting `ensureGuestSession` first leaves `/drill` and `/time-trial` importing a symbol that no longer exists, which is 2 `svelte-check` errors at that commit boundary — and CLAUDE.md allows no tolerated error baseline. Gating first removes both callers, so the deletion lands cleanly.

Tasks 1 and 2 are independent of each other and can be done in either order. Task 3 depends on both. Within Task 3, delete the tests before the code they cover, or the suite breaks between its own steps.

*(This ordering was wrong in the first version of this plan. An implementer hit the 2 errors, correctly refused to invent a stopgap, and the plan was re-sequenced.)*

**The `{#if}/{:else}/{/if}` deletion in Tasks 2 and 3 is the single most likely place to break the build.** The wrapper spans the whole component, so the opening block, the `{:else}`, and the closing `{/if}` on the last line are far apart in the file. Delete all three. `npm run check` catches it if you don't.

**What this plan deliberately does not do:** add a reaper cron, change `robots.txt`, touch migration 0056's `is_anonymous` join in `player_directory`, or delete any production rows. The first three are unnecessary; the last is issue #90 and needs its own sign-off.
