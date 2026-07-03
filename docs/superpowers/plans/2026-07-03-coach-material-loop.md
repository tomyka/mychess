# Coach → Player Material Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player see and train repertoires their coach assigned them, through the existing SRS flow.

**Architecture:** Two additive RLS policies grant players read access to assigned repertoires + their moves; the `learn` queue unions own + assigned repertoire ids; the repertoires page shows an "Assigned by your coach" section. Coach progress visibility is already wired.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Supabase (Postgres RLS), Vitest, jsdom.

**Working directory:** run `npm`/`npx` from `mychess/`. Repo root is its parent.

**Spec:** `docs/superpowers/specs/2026-07-03-coach-material-loop-design.md`

**Known pre-existing `npm run check` errors (ignore):** `hooks.server.ts`, `lib/supabase/client.ts`, `auth/**`, `api/fide/import`, `api/tournaments/scrape`.

---

## Task 1: `mergeRepertoireIds` helper (TDD)

**Files:**
- Create: `mychess/src/lib/repertoire.ts`
- Test: `mychess/src/lib/repertoire.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mychess/src/lib/repertoire.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mergeRepertoireIds } from './repertoire';

describe('mergeRepertoireIds', () => {
  it('unions own and assigned ids', () => {
    expect(mergeRepertoireIds(['a', 'b'], ['c'])).toEqual(['a', 'b', 'c']);
  });
  it('deduplicates ids present in both lists', () => {
    expect(mergeRepertoireIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('handles empty inputs', () => {
    expect(mergeRepertoireIds([], [])).toEqual([]);
    expect(mergeRepertoireIds(['a'], [])).toEqual(['a']);
    expect(mergeRepertoireIds([], ['a'])).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run src/lib/repertoire.test.ts`
Expected: FAIL — cannot resolve `./repertoire`.

- [ ] **Step 3: Implement**

Create `mychess/src/lib/repertoire.ts`:
```ts
/** Unions a player's own repertoire ids with those assigned by a coach, de-duplicated. */
export function mergeRepertoireIds(own: string[], assigned: string[]): string[] {
  return [...new Set([...own, ...assigned])];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run src/lib/repertoire.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add mychess/src/lib/repertoire.ts mychess/src/lib/repertoire.test.ts
git commit -m "feat: add mergeRepertoireIds helper"
```

---

## Task 2: Learn queue includes assigned repertoires

**Files:**
- Modify: `mychess/src/routes/(player)/learn/+page.server.ts`

- [ ] **Step 1: Import the helper**

At the top of `mychess/src/routes/(player)/learn/+page.server.ts`, add to the imports:
```ts
import { mergeRepertoireIds } from '$lib/repertoire';
```

- [ ] **Step 2: Union own + assigned repertoire ids**

Replace this block:
```ts
	// Get all repertoire IDs for this player
	const { data: reps } = await supabase
		.from('repertoires')
		.select('id')
		.eq('player_id', user.id);
	const repIds = reps?.map((r) => r.id) ?? [];
```
with:
```ts
	// Repertoire IDs: the player's own plus any assigned by a coach.
	const [{ data: reps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id').eq('player_id', user.id),
		supabase.from('assigned_repertoires').select('repertoire_id').eq('player_id', user.id)
	]);
	const repIds = mergeRepertoireIds(
		reps?.map((r) => r.id) ?? [],
		assigned?.map((a) => a.repertoire_id) ?? []
	);
```
(The rest of the load — moves fetch `.in('repertoire_id', repIds)`, reviews, queue — is unchanged.)

- [ ] **Step 3: Verify**

Run (from `mychess/`): `npm run check 2>&1 | grep "learn/+page.server" | grep -i error || echo "no new learn errors"` → no new errors.
Run: `npx vitest run 2>&1 | tail -3` → all pass.

- [ ] **Step 4: Commit**
```bash
git add "mychess/src/routes/(player)/learn/+page.server.ts"
git commit -m "feat: include coach-assigned repertoires in the learn queue"
```

---

## Task 3: Repertoires page shows assigned material

**Files:**
- Modify: `mychess/src/routes/(player)/repertoires/+page.server.ts`
- Modify: `mychess/src/routes/(player)/repertoires/+page.svelte`
- Test: `mychess/src/routes/(player)/repertoires/repertoires.test.ts`

- [ ] **Step 1: Load assigned repertoires**

Replace the body of `mychess/src/routes/(player)/repertoires/+page.server.ts` load with:
```ts
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const [{ data: repertoires }, { data: assigned }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, created_at, moves(count)')
			.eq('player_id', user!.id)
			.order('created_at', { ascending: false }),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id ( id, name, color, moves(count) )')
			.eq('player_id', user!.id)
	]);
	const assignedRepertoires = (assigned ?? [])
		.map((a: any) => a.repertoire)
		.filter(Boolean);
	return { repertoires: repertoires ?? [], assignedRepertoires };
```
(Keep the existing `import { requireAccount } from '$lib/server/auth';` and the `load` signature `async ({ locals }) => { … }`.)

- [ ] **Step 2: Write the failing component test**

Create `mychess/src/routes/(player)/repertoires/repertoires.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Repertoires from './+page.svelte';

afterEach(() => cleanup());

const assigned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }] }];

describe('repertoires page', () => {
  it('shows the assigned-by-coach section when there are assignments', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: assigned } } });
    expect(screen.getByText(/Assigned by your coach/i)).toBeTruthy();
    expect(screen.getByText('French Defense')).toBeTruthy();
  });

  it('hides the assigned section when there are none', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: [] } } });
    expect(screen.queryByText(/Assigned by your coach/i)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `mychess/`): `npx vitest run "src/routes/(player)/repertoires/repertoires.test.ts"`
Expected: FAIL — the page doesn't render an assigned section / doesn't accept `assignedRepertoires`.

- [ ] **Step 4: Replace the page**

Replace the entire contents of `mychess/src/routes/(player)/repertoires/+page.svelte` with:
```svelte
<script lang="ts">
  let { data } = $props<{ data: { repertoires: any[]; assignedRepertoires: any[] } }>();
</script>

<svelte:head>
  <title>Repertoires — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-2xl mx-auto px-4 py-6 space-y-8">

    {#if data.assignedRepertoires?.length > 0}
      <section>
        <h1 class="text-2xl font-bold text-gray-900 mb-4">Assigned by your coach</h1>
        <ul class="space-y-2">
          {#each data.assignedRepertoires as rep}
            <li class="flex items-center gap-3 bg-white rounded-xl border border-indigo-200 shadow-sm p-4">
              <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
              </div>
              <a href="/learn" class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">Train</a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <h1 class="text-2xl font-bold text-gray-900 mb-4">My Repertoires</h1>
      {#if data.repertoires.length === 0}
        <div class="text-center py-16 text-gray-400">
          <p class="text-4xl mb-4">📚</p>
          <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
          <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
        </div>
      {:else}
        <ul class="space-y-2">
          {#each data.repertoires as rep}
            <li>
              <a href="/repertoires/{rep.id}"
                 class="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
                <div class="flex-1 min-w-0">
                  <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                  <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
                </div>
                <span class="text-gray-400 text-sm">→</span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

  </div>
</main>
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `mychess/`): `npx vitest run "src/routes/(player)/repertoires/repertoires.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**
```bash
git add "mychess/src/routes/(player)/repertoires/+page.server.ts" "mychess/src/routes/(player)/repertoires/+page.svelte" "mychess/src/routes/(player)/repertoires/repertoires.test.ts"
git commit -m "feat: show coach-assigned repertoires on the repertoires page"
```

---

## Task 4: RLS migration

**Files:**
- Create: `mychess/supabase/migrations/0017_assigned_repertoire_access.sql`

- [ ] **Step 1: Write the migration**

Create `mychess/supabase/migrations/0017_assigned_repertoire_access.sql`:
```sql
-- Coach -> player material loop: let a player read repertoires (and their moves)
-- that a coach assigned to them. Additive; existing owner/coach policies untouched.
-- Not recursive: assigned_repertoires policies do not query repertoires/moves.

create policy "repertoires_player_assigned_read" on public.repertoires
  for select using (
    exists (
      select 1 from public.assigned_repertoires a
      where a.repertoire_id = repertoires.id and a.player_id = auth.uid()
    )
  );

create policy "moves_player_assigned_read" on public.moves
  for select using (
    exists (
      select 1 from public.assigned_repertoires a
      where a.repertoire_id = moves.repertoire_id and a.player_id = auth.uid()
    )
  );
```

NOTE: Do not apply to the DB here (no access). The user applies it (SQL editor / db push). The player-facing features degrade gracefully until it's applied (no assigned rows are readable, so the section is empty and `learn` excludes them — no error).

- [ ] **Step 2: Commit**
```bash
git add mychess/supabase/migrations/0017_assigned_repertoire_access.sql
git commit -m "feat: RLS — players can read coach-assigned repertoires and moves"
```

---

## Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Suite + type-check**

Run (from `mychess/`):
```bash
npx vitest run 2>&1 | tail -4
npm run check 2>&1 | tail -3
```
Expected: all tests pass (prior count + `repertoire` (3) + `repertoires` page (2)); `npm run check` error count equals the known pre-existing set only (no new files with errors).

- [ ] **Step 2: Manual smoke (after migration `0017` applied)**
  - As a coach at `/coach/players/<playerId>`, assign a repertoire to a player.
  - As that player, open `/repertoires` → the repertoire appears under "Assigned by your coach" with its move count.
  - Click **Train** → `/learn` includes the assigned moves in the due queue; rate a move.
  - Reload — progress persists (review saved).
  - As the coach, reopen the player view → the player's stats reflect the activity.

- [ ] **Step 3: Commit any residual fixes** (otherwise nothing).

---

## Self-Review Notes

- **Spec coverage:** RLS policies (migration) — Task 4; learn-queue union — Task 2 (+ helper Task 1); repertoires assigned section — Task 3; coach progress visibility — no code (existing, noted). Testing — Tasks 1/3/5. All spec sections mapped.
- **Type consistency:** `mergeRepertoireIds(own, assigned)` defined in Task 1, used in Task 2. `assignedRepertoires` (array of `{ id, name, color, moves }`) returned by Task 3's load matches the `+page.svelte` prop and the component test's `data` shape. Policy names `repertoires_player_assigned_read` / `moves_player_assigned_read` unique (no collision with existing `*_player_all` / `*_coach_read`).
- **Placeholder scan:** every step has full code + exact commands.
- **Risk:** the migration is external; features degrade to empty (no error) until applied — called out in Task 4 and the smoke step gates on it.
