# Delete Repertoire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player delete a repertoire they own from `/repertoires`, with the underlying schema fixed so the delete doesn't fail on FK constraints once the repertoire has practice history.

**Architecture:** A migration adds `ON DELETE CASCADE` to the two FKs (`sessions.repertoire_id`, `review_events.move_id`) that currently block cascading deletes. A new `delete` action on `src/routes/(player)/repertoires/+page.server.ts` mirrors the existing coach-page delete action exactly (ownership-scoped `.delete()`). The Svelte page gets a delete button + `confirm()` gate on the "My Repertoires" list only.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), Supabase Postgres/RLS, Vitest + `@testing-library/svelte` (jsdom) for component tests.

Design doc: `docs/superpowers/specs/2026-08-10-delete-repertoire-design.md`

---

### Task 1: Migration — cascade FKs for sessions and review_events

**Files:**
- Create: `mychess/supabase/migrations/0033_repertoire_delete_cascade.sql`

There's no local Postgres and no working service-role key in this environment (per `mychess/CLAUDE.md`) — this migration cannot be applied or tested by the agent. Write the file, then the user runs it manually in the Supabase dashboard SQL editor.

- [ ] **Step 1: Write the migration file**

```sql
-- mychess/supabase/migrations/0033_repertoire_delete_cascade.sql
-- Enables deleting a repertoire that's ever been practiced. `moves`,
-- `assigned_repertoires`, `variation_progress`, and `level_progress` already
-- cascade from `repertoires` correctly, but two more tables sit downstream
-- with no `on delete` rule (default RESTRICT): `sessions.repertoire_id` and
-- `review_events.move_id` (review_events blocks the moves cascade itself,
-- since moves cascades from repertoires). Any repertoire with practice
-- history already has rows in both, so a repertoire delete fails today with
-- a foreign-key violation. Fix: cascade both — deleting a repertoire also
-- deletes its sessions/review_events. player_stats is a separate aggregate
-- table with no FK here, so it's untouched by this.
alter table public.sessions
  drop constraint sessions_repertoire_id_fkey,
  add constraint sessions_repertoire_id_fkey
    foreign key (repertoire_id) references public.repertoires(id) on delete cascade;

alter table public.review_events
  drop constraint review_events_move_id_fkey,
  add constraint review_events_move_id_fkey
    foreign key (move_id) references public.moves(id) on delete cascade;
```

- [ ] **Step 2: Verify constraint names against the live schema**

The migration assumes Postgres's default auto-generated constraint names (`<table>_<column>_fkey`), matching every other unnamed FK in `0001_core_tables.sql`. Before the user runs this, ask them to confirm those two names exist by running this read-only query in the Supabase SQL editor, and report back the result:

```sql
select conname, conrelid::regclass as table_name
from pg_constraint
where conname in ('sessions_repertoire_id_fkey', 'review_events_move_id_fkey');
```

If the names differ, update the migration file's `drop constraint` lines to match before proceeding.

- [ ] **Step 3: Hand the migration to the user to run**

Paste the migration file's contents for the user and ask them to run it in the Supabase dashboard SQL editor (or trigger `migrate.yml` if they prefer). Do not proceed to manual end-to-end testing in Task 4 until they confirm it ran successfully.

- [ ] **Step 4: Commit**

```bash
git add mychess/supabase/migrations/0033_repertoire_delete_cascade.sql
git commit -m "fix: cascade sessions/review_events on repertoire delete"
```

---

### Task 2: Server action — `delete` on the player repertoires page

**Files:**
- Modify: `mychess/src/routes/(player)/repertoires/+page.server.ts`

This is a thin Supabase I/O wrapper. Following this codebase's established split (`mychess/CLAUDE.md`: DB-touching code under existing route `+page.server.ts` files is not unit-tested directly — exercised via manual/e2e), there's no unit test for this action, matching the untested precedent it's copied from (`src/routes/(coach)/coach/repertoires/+page.server.ts:41-52` has no test file either). Manual verification happens in Task 4.

- [ ] **Step 1: Add the `delete` action**

In `mychess/src/routes/(player)/repertoires/+page.server.ts`, add a `delete` action alongside the existing `updateOpening` action:

```ts
export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		const { error } = await supabase.from('repertoires').delete().eq('id', repId).eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	},

	updateOpening: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		const ecoCode = (fd.get('eco_code') as string) || null;
		const ecoName = (fd.get('eco_name') as string) || null;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		const { error } = await supabase
			.from('repertoires')
			.update({ eco_code: ecoCode, eco_name: ecoName })
			.eq('id', repId)
			.eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	}
};
```

The full resulting file (for reference — only the `actions` export changes; `load` stays as-is):

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const [{ data: repertoires }, { data: assigned }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, eco_code, eco_name, created_at, moves(count)')
			.eq('player_id', user!.id)
			.order('created_at', { ascending: false }),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id ( id, name, color, eco_code, eco_name, moves(count) )')
			.eq('player_id', user!.id)
	]);
	const assignedRepertoires = (assigned ?? [])
		.map((a: any) => a.repertoire)
		.filter(Boolean);
	return { repertoires: repertoires ?? [], assignedRepertoires };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		const { error } = await supabase.from('repertoires').delete().eq('id', repId).eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	},

	updateOpening: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		const ecoCode = (fd.get('eco_code') as string) || null;
		const ecoName = (fd.get('eco_name') as string) || null;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		const { error } = await supabase
			.from('repertoires')
			.update({ eco_code: ecoCode, eco_name: ecoName })
			.eq('id', repId)
			.eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	}
};
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/\(player\)/repertoires/+page.server.ts
git commit -m "feat: add delete action for player-owned repertoires"
```

---

### Task 3: UI — delete button on the "My Repertoires" list

**Files:**
- Modify: `mychess/src/routes/(player)/repertoires/+page.svelte`
- Modify (tests): `mychess/src/routes/(player)/repertoires/repertoires.test.ts`

- [ ] **Step 1: Write the failing component tests**

Add these two tests to the existing `describe('repertoires page', ...)` block in `mychess/src/routes/(player)/repertoires/repertoires.test.ts` (keep the existing tests and imports as-is):

```ts
  it('shows a delete form with the repertoire id for each owned repertoire', () => {
    const owned = [{ id: 'r1', name: 'French Defense', color: '#4f46e5', moves: [{ count: 12 }] }];
    render(Repertoires, { props: { data: { repertoires: owned, assignedRepertoires: [] } } });
    const form = document.querySelector('form[action="?/delete"]') as HTMLFormElement;
    expect(form).toBeTruthy();
    expect((form.querySelector('input[name="rep_id"]') as HTMLInputElement).value).toBe('r1');
    expect(screen.getByRole('button', { name: /delete/i })).toBeTruthy();
  });

  it('does not show a delete form in the assigned-by-coach section', () => {
    render(Repertoires, { props: { data: { repertoires: [], assignedRepertoires: assigned } } });
    expect(document.querySelector('form[action="?/delete"]')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/routes/\(player\)/repertoires/repertoires.test.ts`
Expected: FAIL — no `form[action="?/delete"]` exists yet, no "Delete" button role found.

- [ ] **Step 3: Add `use:enhance`, `confirmDelete`, and the delete form to the page**

In `mychess/src/routes/(player)/repertoires/+page.svelte`, update the `<script>` block:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';
  import OpeningPicker from '$lib/components/OpeningPicker.svelte';

  let { data, form } = $props<{ data: { repertoires: any[]; assignedRepertoires: any[] }; form: any }>();
  let openingModalRepId = $state<string | null>(null);

  function confirmDelete(e: SubmitEvent, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone and will also delete all practice history for it.`)) {
      e.preventDefault();
    }
  }
</script>
```

Add an error banner right after `<svelte:head>` (matching the coach page's pattern), inside the `<div class="max-w-2xl ...">` wrapper, before the assigned-repertoires section:

```svelte
    {#if form?.error}
      <p class="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{form.error}</p>
    {/if}
```

Update the "My Repertoires" `<li>` to add the delete form. Replace this block:

```svelte
          {#each data.repertoires as rep (rep.id)}
            <li class="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
              <a href="/repertoires/{rep.id}" class="flex items-center gap-3 flex-1 min-w-0">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
                <div class="flex-1 min-w-0">
                  <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                  <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
                </div>
                <span class="text-gray-400 text-sm">→</span>
              </a>
              <button type="button" onclick={() => (openingModalRepId = rep.id)}
                      class="text-xs text-indigo-500 hover:underline shrink-0">
                {rep.eco_code ?? 'Unclassified'}
              </button>
            </li>
          {/each}
```

with:

```svelte
          {#each data.repertoires as rep (rep.id)}
            <li class="flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow-md transition-shadow">
              <a href="/repertoires/{rep.id}" class="flex items-center gap-3 flex-1 min-w-0">
                <span class="w-3 h-3 rounded-full shrink-0" style="background:{rep.color ?? '#4f46e5'}"></span>
                <div class="flex-1 min-w-0">
                  <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                  <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
                </div>
                <span class="text-gray-400 text-sm">→</span>
              </a>
              <button type="button" onclick={() => (openingModalRepId = rep.id)}
                      class="text-xs text-indigo-500 hover:underline shrink-0">
                {rep.eco_code ?? 'Unclassified'}
              </button>
              <form method="POST" action="?/delete" use:enhance onsubmit={(e) => confirmDelete(e, rep.name)}>
                <input type="hidden" name="rep_id" value={rep.id} />
                <button class="text-sm text-red-600 hover:underline shrink-0">Delete</button>
              </form>
            </li>
          {/each}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/routes/\(player\)/repertoires/repertoires.test.ts`
Expected: PASS (all 6 tests: the 4 existing + 2 new).

- [ ] **Step 5: Type-check**

Run: `cd mychess && npm run check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add mychess/src/routes/\(player\)/repertoires/+page.svelte mychess/src/routes/\(player\)/repertoires/repertoires.test.ts
git commit -m "feat: add delete button to player's own repertoires list"
```

---

### Task 4: Full verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd mychess && npm test`
Expected: all tests pass, including the new ones from Task 3.

- [ ] **Step 2: Run the full type/svelte check**

Run: `cd mychess && npm run check`
Expected: 0 errors (per `mychess/CLAUDE.md`, this must be clean before pushing to `main`).

- [ ] **Step 3: Confirm the migration ran**

Confirm with the user that they've run `0033_repertoire_delete_cascade.sql` from Task 1 against the live Supabase database (per `mychess/CLAUDE.md`, never assume a migration took effect without explicit confirmation).

- [ ] **Step 4: Manual end-to-end check via dev server**

Run: `cd mychess && npm run dev`, then in the browser:
1. Log in as a player, go to `/repertoires`, create a repertoire (or use an existing one).
2. Go to `/practice/<repertoire_id>` and complete at least one drill card, so `sessions` and `review_events` rows exist for it — this is the case that used to be blocked by the FK constraints.
3. Return to `/repertoires`, click Delete on that repertoire, confirm the dialog.
4. Verify the repertoire disappears from the list and no error banner appears.
5. Verify a repertoire assigned by a coach (if available in test data) shows no Delete button.

- [ ] **Step 5: Push to origin**

```bash
git push
```
