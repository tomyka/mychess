# Player Repertoire Creation/Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player create their own opening repertoire from pasted or uploaded PGN text, and fix the coach's equivalent tool (`/coach/pgn`), which is currently completely broken — it inserts into columns that don't exist in the live database and never sets the required `color` field.

**Architecture:** A pure function (`planImport`) turns PGN text + a chosen color into the exact rows to write, and is unit-tested directly with no mocking. A thin Supabase-touching wrapper (`importPgn`) does the actual database writes and is shared by both the (fixed) coach form and the new player-facing form — one correct implementation, two callers.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), `@supabase/ssr`, `chess.js` (via the existing `parsePgn` helper).

Spec: `docs/superpowers/specs/2026-07-06-repertoire-upload-design.md`

**Schema, verified directly against the live production database (not assumed from migration files, which turned out to have drifted from what the broken tool assumed):**

```
repertoires: id, player_id, name, color (not null), is_draft (default true), created_at (default now())
moves:       id, repertoire_id, from_position (nullable), to_position (not null), san, move_number, is_player_turn, annotation (nullable), created_at (default now())
positions:   id, fen (unique)
```

Note: `moves.from_position`/`to_position` reference `positions.id` directly — not `_id`-suffixed column names, and not the FEN strings themselves.

---

### Task 1: Pure import-planning logic

**Files:**
- Create: `mychess/src/lib/pgn-import.ts`
- Test: `mychess/src/lib/pgn-import.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/pgn-import.test.ts
import { describe, it, expect } from 'vitest';
import { planImport } from './pgn-import';

describe('planImport', () => {
  it('returns an error for a PGN with no valid games', () => {
    const result = planImport('not a real pgn', 'white');
    expect(result).toEqual({ error: 'No valid games found in PGN' });
  });

  it('marks white moves as is_player_turn for a white repertoire', () => {
    const result = planImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.gameCount).toBe(1);
    expect(result.moves).toHaveLength(2);
    expect(result.moves[0]).toMatchObject({ san: 'e4', move_number: 1, is_player_turn: true });
    expect(result.moves[1]).toMatchObject({ san: 'e5', move_number: 2, is_player_turn: false });
  });

  it('marks black moves as is_player_turn for a black repertoire', () => {
    const result = planImport('1. e4 e5 *', 'black');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.moves[0]).toMatchObject({ san: 'e4', is_player_turn: false });
    expect(result.moves[1]).toMatchObject({ san: 'e5', is_player_turn: true });
  });

  it('carries the from/to FEN pair for each move', () => {
    const result = planImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.moves[0].fromFen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(result.moves[0].toFen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(result.moves[1].fromFen).toBe(result.moves[0].toFen);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `mychess/`): `npx vitest run src/lib/pgn-import.test.ts`
Expected: FAIL with "Failed to resolve import './pgn-import'" — the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// mychess/src/lib/pgn-import.ts
import { parsePgn } from './pgn/parser';

export type MoveRow = {
  fromFen: string;
  toFen: string;
  san: string;
  move_number: number;
  is_player_turn: boolean;
  annotation: string | null;
};

export type ImportPlan = { gameCount: number; moves: MoveRow[] } | { error: string };

/**
 * Turns PGN text + a chosen studied color into the exact move rows to write.
 * Pure — no I/O — so it's directly testable without touching Supabase. The
 * IO layer in $lib/server/pgn-import.ts calls this before writing anything.
 */
export function planImport(pgnText: string, color: 'white' | 'black'): ImportPlan {
  const games = parsePgn(pgnText);

  const moves: MoveRow[] = [];
  for (const game of games) {
    for (const move of game.moves) {
      moves.push({
        fromFen: move.parentFen,
        toFen: move.fen,
        san: move.san,
        move_number: move.ply,
        is_player_turn: move.color === color,
        annotation: move.annotation ?? null
      });
    }
  }

  if (moves.length === 0) {
    return { error: 'No valid games found in PGN' };
  }
  return { gameCount: games.length, moves };
}
```

**Fix applied during code-quality review:** the original `games.length === 0` check missed the case of a PGN with valid headers but zero actual moves (e.g. `'[Event "test"]\n\n*'`), which would otherwise silently create an untrainable, empty repertoire. The check now runs after building `moves` and checks `moves.length === 0` instead, catching both cases with one guard. Two more tests were added to `pgn-import.test.ts` (a zero-moves PGN, and a two-game blob confirming shared opening moves produce matching FEN pairs for later deduplication) — not reproduced here in full; see the actual committed test file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pgn-import.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add mychess/src/lib/pgn-import.ts mychess/src/lib/pgn-import.test.ts
git commit -m "feat: add planImport pure PGN-import planning logic"
```

---

### Task 2: Supabase IO layer

**Files:**
- Create: `mychess/src/lib/server/pgn-import.ts`

**Context:** This wraps the actual database writes. Following this codebase's established convention (used consistently for every Supabase-touching helper this session — `$lib/server/coach-players.ts`, `$lib/server/onboarding.ts`, `$lib/server/guest.ts`), it has no dedicated test file; `planImport` (Task 1) carries the logic worth testing directly.

- [ ] **Step 1: Write the implementation**

```ts
// mychess/src/lib/server/pgn-import.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { planImport } from '$lib/pgn-import';

export type ImportResult =
  | { repertoireId: string; gameCount: number; error: null }
  | { repertoireId: null; gameCount: null; error: string };

/** Creates a repertoire from PGN text and imports every move into its tree. */
export async function importPgn(
  supabase: SupabaseClient,
  params: { playerId: string; name: string; color: 'white' | 'black'; pgnText: string }
): Promise<ImportResult> {
  const plan = planImport(params.pgnText, params.color);
  if ('error' in plan) return { repertoireId: null, gameCount: null, error: plan.error };

  const { data: rep, error: repErr } = await supabase
    .from('repertoires')
    .insert({ player_id: params.playerId, name: params.name, color: params.color })
    .select()
    .single();
  if (repErr) return { repertoireId: null, gameCount: null, error: repErr.message };

  for (const move of plan.moves) {
    await supabase.from('positions').upsert({ fen: move.fromFen }, { onConflict: 'fen', ignoreDuplicates: true });
    await supabase.from('positions').upsert({ fen: move.toFen }, { onConflict: 'fen', ignoreDuplicates: true });

    const [{ data: fromPos }, { data: toPos }] = await Promise.all([
      supabase.from('positions').select('id').eq('fen', move.fromFen).single(),
      supabase.from('positions').select('id').eq('fen', move.toFen).single()
    ]);

    if (fromPos && toPos) {
      // Multiple games can share an opening sequence (the same position and
      // move played twice) — upsert with ignoreDuplicates so they merge into
      // one shared edge in the tree instead of erroring on the second insert.
      await supabase.from('moves').upsert(
        {
          repertoire_id: rep.id,
          from_position: fromPos.id,
          to_position: toPos.id,
          san: move.san,
          move_number: move.move_number,
          is_player_turn: move.is_player_turn,
          annotation: move.annotation
        },
        { onConflict: 'repertoire_id,from_position,san', ignoreDuplicates: true }
      );
    }
  }

  return { repertoireId: rep.id, gameCount: plan.gameCount, error: null };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to this file. (This project has some pre-existing, unrelated type errors elsewhere in OAuth callback routes — not your concern.)

- [ ] **Step 3: Commit**

```bash
git add mychess/src/lib/server/pgn-import.ts
git commit -m "feat: add importPgn IO layer"
```

---

### Task 3: Fix the broken coach PGN upload tool

**Files:**
- Modify: `mychess/src/routes/(coach)/coach/pgn/+page.server.ts`
- Modify: `mychess/src/routes/(coach)/coach/pgn/+page.svelte`

**Context:** This tool's `load` function was already fixed in the previous (coach-player relationship) plan to read players via `listRelationshipsForCoach` — leave that part exactly as-is. Its `upload` action is the broken part: it inserts `coach_id`/`pgn_source` into `repertoires` (columns that don't exist) and `from_position_id`/`to_position_id`/`ply` into `moves` (also wrong — and never sets the required `color` at all, because the form doesn't even ask for it).

- [ ] **Step 1: Replace the broken action**

In `mychess/src/routes/(coach)/coach/pgn/+page.server.ts`, change:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parsePgn } from '$lib/pgn/parser';
import { listRelationshipsForCoach } from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active } = await listRelationshipsForCoach(supabase, user!.id);
	return { players: active.map((r) => r.other) };
};

export const actions: Actions = {
	upload: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401);

		const data = await request.formData();
		const name = data.get('name') as string;
		const playerId = data.get('player_id') as string;
		const pgnText = data.get('pgn_text') as string;

		if (!name || !pgnText) return fail(400, { error: 'Name and PGN required' });

		const games = parsePgn(pgnText);
		if (games.length === 0) return fail(400, { error: 'No valid games in PGN' });

		const targetPlayer = playerId || user.id;
		const { data: rep, error: repErr } = await supabase
			.from('repertoires')
			.insert({ player_id: targetPlayer, coach_id: user.id, name, pgn_source: pgnText })
			.select()
			.single();

		if (repErr) return fail(500, { error: repErr.message });

		for (const game of games) {
			for (const move of game.moves) {
				await supabase.from('positions').upsert({ fen: move.parentFen }, { onConflict: 'fen', ignoreDuplicates: true });
				await supabase.from('positions').upsert({ fen: move.fen }, { onConflict: 'fen', ignoreDuplicates: true });

				const [{ data: fromPos }, { data: toPos }] = await Promise.all([
					supabase.from('positions').select('id').eq('fen', move.parentFen).single(),
					supabase.from('positions').select('id').eq('fen', move.fen).single()
				]);

				if (fromPos && toPos) {
					await supabase.from('moves').insert({
						repertoire_id: rep.id,
						from_position_id: fromPos.id,
						to_position_id: toPos.id,
						san: move.san,
						ply: move.ply
					});
				}
			}
		}

		return { success: true, gameCount: games.length, repId: rep.id };
	}
};
```

to:

```ts
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { importPgn } from '$lib/server/pgn-import';
import { listRelationshipsForCoach } from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active } = await listRelationshipsForCoach(supabase, user!.id);
	return { players: active.map((r) => r.other) };
};

export const actions: Actions = {
	upload: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401);

		const data = await request.formData();
		const name = data.get('name') as string;
		const playerId = data.get('player_id') as string;
		const pgnText = data.get('pgn_text') as string;
		const color = data.get('color') as string;

		if (!name || !pgnText) return fail(400, { error: 'Name and PGN required' });
		if (color !== 'white' && color !== 'black') return fail(400, { error: 'Please select a color' });

		const targetPlayer = playerId || user.id;
		const { repertoireId, gameCount, error } = await importPgn(supabase, {
			playerId: targetPlayer,
			name,
			color,
			pgnText
		});
		if (error) return fail(400, { error });

		return { success: true, gameCount, repId: repertoireId };
	}
};
```

- [ ] **Step 2: Add the missing color selector to the form**

In `mychess/src/routes/(coach)/coach/pgn/+page.svelte`, change:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: { players: any[] }; form: any }>();
</script>
```

to:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props<{ data: { players: any[] }; form: any }>();
  let color = $state<'white' | 'black'>('white');
</script>
```

Then, change:

```svelte
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="name">Repertoire Name</label>
        <input id="name" name="name" required placeholder="e.g. Sicilian Defense"
               class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      {#if data.players.length > 0}
```

to:

```svelte
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="name">Repertoire Name</label>
        <input id="name" name="name" required placeholder="e.g. Sicilian Defense"
               class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div>
        <span class="block text-sm font-medium text-gray-700 mb-1">Color</span>
        <div class="flex gap-3">
          {#each [{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }] as const as c}
            <button
              type="button"
              onclick={() => (color = c.id)}
              class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm
                     {color === c.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
            >
              {c.label}
            </button>
          {/each}
        </div>
        <input type="hidden" name="color" value={color} />
      </div>

      {#if data.players.length > 0}
```

- [ ] **Step 3: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to these two files.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(coach)/coach/pgn/+page.server.ts" "mychess/src/routes/(coach)/coach/pgn/+page.svelte"
git commit -m "fix: coach PGN upload tool uses correct schema and asks for color"
```

---

### Task 4: Player-facing "Create Repertoire" page

**Files:**
- Create: `mychess/src/routes/(player)/repertoires/new/+page.server.ts`
- Create: `mychess/src/routes/(player)/repertoires/new/+page.svelte`
- Test: `mychess/src/routes/(player)/repertoires/new/new.test.ts`

- [ ] **Step 1: Write the server load and action**

```ts
// mychess/src/routes/(player)/repertoires/new/+page.server.ts
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { importPgn } from '$lib/server/pgn-import';

export const load: PageServerLoad = async ({ locals }) => {
	await requireAccount(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const name = ((fd.get('name') as string) ?? '').trim();
		const color = fd.get('color') as string;
		const pgnText = ((fd.get('pgn_text') as string) ?? '').trim();

		if (!name || !pgnText) return fail(400, { error: 'Name and PGN are required' });
		if (color !== 'white' && color !== 'black') return fail(400, { error: 'Please select a color' });

		const { error } = await importPgn(supabase, { playerId: user!.id, name, color, pgnText });
		if (error) return fail(400, { error });

		throw redirect(303, '/repertoires');
	}
};
```

- [ ] **Step 2: Write the page template**

```svelte
<!-- mychess/src/routes/(player)/repertoires/new/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props<{ form: any }>();
  let color = $state<'white' | 'black'>('white');
  let pgnText = $state('');
  let fileError = $state('');

  function onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pgnText = reader.result as string;
      fileError = '';
    };
    reader.onerror = () => {
      fileError = 'Could not read that file — try pasting the PGN text instead.';
    };
    reader.readAsText(file);
  }
</script>

<svelte:head>
  <title>Create Repertoire — MyChess</title>
</svelte:head>

<main class="min-h-screen bg-gray-50">
  <div class="max-w-lg mx-auto px-4 py-6">
    <a href="/repertoires" class="text-gray-400 text-sm hover:text-gray-600 mb-6 block">← Back to Repertoires</a>
    <h1 class="text-2xl font-bold text-gray-900 mb-6">Create Repertoire</h1>

    {#if form?.error}
      <p class="text-red-600 mb-4 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-sm">{form.error}</p>
    {/if}

    <form method="POST" action="?/create" use:enhance
          class="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="name">Repertoire Name</label>
        <input id="name" name="name" required placeholder="e.g. Sicilian Defense"
               class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>

      <div>
        <span class="block text-sm font-medium text-gray-700 mb-1">Color</span>
        <div class="flex gap-3">
          {#each [{ id: 'white', label: 'White' }, { id: 'black', label: 'Black' }] as const as c}
            <button
              type="button"
              onclick={() => (color = c.id)}
              class="flex-1 py-2.5 px-2 rounded-xl font-semibold transition-all border-2 text-sm
                     {color === c.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
            >
              {c.label}
            </button>
          {/each}
        </div>
        <input type="hidden" name="color" value={color} />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="pgn_text">Paste PGN text</label>
        <textarea id="pgn_text" name="pgn_text" rows="8" bind:value={pgnText}
                   placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 *"
                   class="w-full rounded-lg px-4 py-2.5 border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm resize-none"
        ></textarea>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="pgn_file">…or upload a .pgn file</label>
        <input id="pgn_file" type="file" accept=".pgn" onchange={onFileChange}
               class="w-full text-sm text-gray-600" />
        {#if fileError}
          <p class="text-red-600 text-sm mt-1">{fileError}</p>
        {/if}
      </div>

      <button type="submit"
              class="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-base hover:bg-indigo-700 transition-colors">
        Create Repertoire
      </button>
    </form>
  </div>
</main>
```

- [ ] **Step 3: Write a component test**

```ts
// mychess/src/routes/(player)/repertoires/new/new.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import NewRepertoire from './+page.svelte';

afterEach(() => cleanup());

describe('new repertoire page', () => {
  it('renders the form fields', () => {
    render(NewRepertoire, { props: { form: null } });
    expect(screen.getByLabelText('Repertoire Name')).toBeTruthy();
    expect(screen.getByText('White')).toBeTruthy();
    expect(screen.getByText('Black')).toBeTruthy();
    expect(screen.getByLabelText('Paste PGN text')).toBeTruthy();
    expect(screen.getByLabelText('…or upload a .pgn file')).toBeTruthy();
  });

  it('shows a form error message when present', () => {
    render(NewRepertoire, { props: { form: { error: 'No valid games found in PGN' } } });
    expect(screen.getByText('No valid games found in PGN')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the tests**

Run (needs the Node 22 PATH override for jsdom — this project's established workaround): `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run "src/routes/(player)/repertoires/new/new.test.ts"`
Expected: PASS (2/2).

- [ ] **Step 5: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to these files.

- [ ] **Step 6: Commit**

```bash
git add "mychess/src/routes/(player)/repertoires/new"
git commit -m "feat: add player-facing Create Repertoire page"
```

---

### Task 5: Link "Create Repertoire" from the repertoires list

**Files:**
- Modify: `mychess/src/routes/(player)/repertoires/+page.svelte`

- [ ] **Step 1: Add the link**

Change:

```svelte
    <section>
      <h1 class="text-2xl font-bold text-gray-900 mb-4">My Repertoires</h1>
      {#if data.repertoires.length === 0}
```

to:

```svelte
    <section>
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold text-gray-900">My Repertoires</h1>
        <a href="/repertoires/new"
           class="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          + Create Repertoire
        </a>
      </div>
      {#if data.repertoires.length === 0}
```

Nothing else in this file changes — the empty-state text ("Ask your coach to assign one, or create your own.") already makes sense now that "create your own" actually leads somewhere.

- [ ] **Step 2: Run the existing test for this page to confirm nothing broke**

Run: `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run "src/routes/(player)/repertoires/repertoires.test.ts"`
Expected: PASS (2/2) — this change only adds a link; it doesn't touch anything the existing tests assert on.

- [ ] **Step 3: Type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors attributable to this file.

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(player)/repertoires/+page.svelte"
git commit -m "feat: link Create Repertoire from the repertoires list"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `PATH="/c/Users/tomyk/.config/herd/bin/nvm/v22.22.3:$PATH" npx vitest run` (from `mychess/`)
Expected: PASS — no regressions, plus the new tests from Tasks 1, 4, and the re-run in Task 5.

- [ ] **Step 2: Run the full type-check**

Run: `npm run check` (from `mychess/`)
Expected: no new errors beyond this project's pre-existing baseline (the OAuth-callback env-var typing pattern, unrelated to this work).

- [ ] **Step 3: Grep for stragglers**

Run: `grep -rn "pgn_source\|coach_id.*repertoires\|from_position_id\|to_position_id" mychess/src`
Expected: no matches — confirms the old broken column references are fully gone from `/coach/pgn`.

- [ ] **Step 4: Manual verification on production**

Since local dev testing has been deprioritized in favor of testing directly on the deployed site — after this is merged and deployed:
- As a player, go to `/repertoires`, click "Create Repertoire," paste a short PGN (e.g. `1. e4 e5 2. Nf3 *`), pick a color, submit. Confirm you land back on `/repertoires` and the new repertoire appears in "My Repertoires."
- Click into training (`/learn`) and confirm the new repertoire's moves are actually trainable (they show up as due cards).
- Try the file-upload path: save a small `.pgn` file locally and upload it instead of pasting — confirm the textarea fills with its contents and submission works the same way.
- As a coach connected to at least one player (from the earlier relationship work), go to `/coach/pgn`, pick a color, optionally assign to a player, and submit. Confirm success (this exercises the fix — it should now actually work, where before it always failed).
- If assigned to a player, confirm it shows up under "Assigned by your coach" on that player's `/repertoires` page.

No commit for this task — it's verification only. If any step surfaces a bug, fix it as part of the task where the bug was introduced and re-run this task's steps.
