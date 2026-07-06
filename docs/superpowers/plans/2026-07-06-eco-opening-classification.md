# ECO Opening Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every repertoire with an ECO opening code + name, auto-detected from its moves at upload time, editable afterward from the repertoire list.

**Architecture:** A bundled, generated static dataset (`src/lib/openings/eco-data.ts`, ~500–600 entries, one per ECO code, CC0-licensed) backs a pure detection/search module (`src/lib/openings/classify.ts`). `planImport` runs detection on the first parsed game and includes the result in its plan; `importPgn` writes it onto the new `repertoires` row (two new nullable columns: `eco_code`, `eco_name`). A shared `<OpeningPicker>` modal component lets a coach/player search and override the tag from `/coach/repertoires` or `/(player)/repertoires` — the same two pages the upload forms redirect to on success, so there's no need to duplicate the picker inline on the upload forms themselves.

**Tech Stack:** SvelteKit 2 / Svelte 5, `chess.js` (already used by the PGN parser), vitest, Supabase/Postgres.

**Deviation from the approved spec, noted for the record:** the spec listed 4 picker call sites (2 upload forms + 2 list pages). Both upload actions (`/coach/pgn`, `/repertoires/new`) `redirect(303, ...)` straight to their list page on success — there's no intermediate confirmation screen to put a picker on. Wiring the picker onto the list pages only (2 call sites) fully satisfies the spec's actual requirements (auto-detect at upload, editable afterward) without adding a new confirmation step to the upload flow. This plan implements the 2-call-site version.

---

### Task 1: Opening detection & search logic

**Files:**
- Create: `src/lib/openings/classify.ts`
- Test: `src/lib/openings/classify.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/openings/classify.test.ts
import { describe, it, expect } from 'vitest';
import { detectOpening, searchOpenings } from './classify';
import type { Opening } from './classify';

const FIXTURE: Opening[] = [
  {
    code: 'B90',
    name: 'Sicilian Defense: Najdorf Variation',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']
  },
  { code: 'B20', name: 'Sicilian Defense', moves: ['e4', 'c5'] },
  { code: 'C20', name: "King's Pawn Game", moves: ['e4', 'e5'] }
];

describe('detectOpening', () => {
  it('returns the longest matching prefix', () => {
    const moves = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'e5'];
    expect(detectOpening(moves, FIXTURE)).toEqual({
      code: 'B90',
      name: 'Sicilian Defense: Najdorf Variation'
    });
  });

  it('falls back to a shorter match when the longer one does not fit', () => {
    const moves = ['e4', 'c5', 'Nc3'];
    expect(detectOpening(moves, FIXTURE)).toEqual({ code: 'B20', name: 'Sicilian Defense' });
  });

  it('returns null when nothing matches', () => {
    expect(detectOpening(['d4', 'd5'], FIXTURE)).toBeNull();
  });

  it('returns null for an empty move list', () => {
    expect(detectOpening([], FIXTURE)).toBeNull();
  });

  it('ignores trailing check/mate annotations when comparing', () => {
    const withCheck: Opening[] = [{ code: 'X00', name: 'Test Check Line', moves: ['e4', 'e5', 'Qh5+'] }];
    expect(detectOpening(['e4', 'e5', 'Qh5+'], withCheck)).toEqual({ code: 'X00', name: 'Test Check Line' });
    expect(detectOpening(['e4', 'e5', 'Qh5'], withCheck)).toEqual({ code: 'X00', name: 'Test Check Line' });
  });
});

describe('searchOpenings', () => {
  it('matches by name substring, case-insensitive', () => {
    const results = searchOpenings('najdorf', FIXTURE);
    expect(results.map((o) => o.code)).toEqual(['B90']);
  });

  it('matches by code, case-insensitive', () => {
    const results = searchOpenings('b20', FIXTURE);
    expect(results.map((o) => o.code)).toEqual(['B20']);
  });

  it('returns an empty array for a blank query', () => {
    expect(searchOpenings('', FIXTURE)).toEqual([]);
    expect(searchOpenings('   ', FIXTURE)).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchOpenings('zzz-no-match', FIXTURE)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/openings/classify.test.ts`
Expected: FAIL — `./classify` has no exported member `detectOpening`/`searchOpenings` (module doesn't exist yet).

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/openings/classify.ts
export type Opening = { code: string; name: string; moves: string[] };

function normalize(san: string): string {
  return san.replace(/[+#]$/, '');
}

/**
 * Returns the entry whose move sequence is the longest exact prefix match
 * of `sanMoves`, or null if nothing matches. Comparison ignores trailing
 * check/mate annotations.
 */
export function detectOpening(sanMoves: string[], openings: Opening[]): { code: string; name: string } | null {
  const target = sanMoves.map(normalize);
  let best: Opening | null = null;

  for (const opening of openings) {
    if (opening.moves.length === 0 || opening.moves.length > target.length) continue;
    const isPrefix = opening.moves.every((move, i) => normalize(move) === target[i]);
    if (isPrefix && (!best || opening.moves.length > best.moves.length)) best = opening;
  }

  return best ? { code: best.code, name: best.name } : null;
}

/** Case-insensitive substring match against code and name. Blank query returns []. */
export function searchOpenings(query: string, openings: Opening[]): Opening[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return openings.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/openings/classify.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/openings/classify.ts src/lib/openings/classify.test.ts
git commit -m "feat: add ECO opening detection and search logic"
git push
```

---

### Task 2: Database migration for the new columns

**Files:**
- Create: `supabase/migrations/0022_repertoire_eco.sql`

- [ ] **Step 1: Write the migration**

```sql
-- mychess/supabase/migrations/0022_repertoire_eco.sql
-- Adds ECO opening classification to repertoires. Both columns are nullable —
-- a repertoire with no detected/chosen opening is simply "Unclassified".
alter table public.repertoires
  add column eco_code text,
  add column eco_name text;
```

No new RLS policy is needed: `repertoires_player_all` (`for all using (player_id = auth.uid())`, from `0002_rls.sql`) already covers `UPDATE` for the repertoire's owner, which is all the later tasks in this plan require.

- [ ] **Step 2: Commit**

```bash
cd mychess
git add supabase/migrations/0022_repertoire_eco.sql
git commit -m "feat: add repertoires.eco_code and eco_name columns"
git push
```

- [ ] **Step 3: Ask the user to apply it**

Paste the migration's SQL into the Supabase dashboard SQL editor and run it — this repo has no local Postgres or working service-role key, so migrations are always applied manually by the user (see `mychess/CLAUDE.md`). The rest of this plan's code doesn't depend on the columns existing yet (nothing here is tested against a live database), but the shipped feature won't work end-to-end in production until this migration is applied.

---

### Task 3: Generate the bundled openings dataset

**Files:**
- Create: `scripts/generate-eco-data.ts`
- Create (generated, by running the script): `src/lib/openings/eco-data.ts`
- Modify: `package.json` (add a script entry)

**Depends on Task 1** (imports the `Opening` type from `classify.ts`).

- [ ] **Step 1: Write the generation script**

```ts
// mychess/scripts/generate-eco-data.ts
import { writeFileSync } from 'fs';
import type { Opening } from '../src/lib/openings/classify';

const VOLUMES = ['a', 'b', 'c', 'd', 'e'];
const BASE_URL = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const OUT_PATH = 'src/lib/openings/eco-data.ts';

function pgnToSanMoves(pgn: string): string[] {
  return pgn
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^\d+\.+$/.test(token));
}

async function fetchVolume(letter: string): Promise<Opening[]> {
  const res = await fetch(`${BASE_URL}/${letter}.tsv`);
  if (!res.ok) throw new Error(`Failed to fetch ${letter}.tsv: HTTP ${res.status}`);
  const text = await res.text();
  const [, ...rows] = text.trim().split('\n'); // drop the header row
  return rows.map((line) => {
    const [code, name, pgn] = line.split('\t');
    return { code, name, moves: pgnToSanMoves(pgn) };
  });
}

async function main() {
  const all: Opening[] = [];
  for (const letter of VOLUMES) {
    all.push(...(await fetchVolume(letter)));
  }

  // One entry per ECO code: many names share a code (ECO groups related
  // lines together); keep the shortest move sequence as that code's
  // canonical/family name. NOTE: this means a first-move/line that shares a
  // code with a *different*, shorter-kept line for that same code won't be
  // recognized by detectOpening (e.g. code A00 covers many unrelated
  // irregular openings — only one of them is kept). Acceptable: detection is
  // a best-effort suggestion, always overridable via the picker, never
  // required.
  const byCode = new Map<string, Opening>();
  for (const opening of all) {
    const existing = byCode.get(opening.code);
    if (!existing || opening.moves.length < existing.moves.length) {
      byCode.set(opening.code, opening);
    }
  }

  const mainLines = Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));

  const content = `// Generated by scripts/generate-eco-data.ts — do not edit by hand.
// Source: https://github.com/lichess-org/chess-openings (CC0 1.0 Universal)
import type { Opening } from './classify';

export const ECO_OPENINGS: Opening[] = ${JSON.stringify(mainLines, null, 2)};
`;

  writeFileSync(OUT_PATH, content);
  console.log(`Wrote ${mainLines.length} openings to ${OUT_PATH}`);
}

main().catch((e) => {
  console.error('ECO data generation failed:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Add an npm script**

In `mychess/package.json`, add to the `"scripts"` object (alongside the existing `"fide:import"` entry):

```json
"eco:generate": "tsx scripts/generate-eco-data.ts"
```

- [ ] **Step 3: Run it**

Run: `cd mychess && npm run eco:generate`
Expected output: `Wrote <N> openings to src/lib/openings/eco-data.ts` where N is roughly 500–600.

- [ ] **Step 4: Spot-check the output**

Run: `grep -A 2 '"code": "B90"' src/lib/openings/eco-data.ts`
Expected: an entry with `"name": "Sicilian Defense: Najdorf Variation"` and a 10-element `moves` array starting `"e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"`.

Run: `grep -A 2 '"code": "C20"' src/lib/openings/eco-data.ts`
Expected: an entry with `"name": "King's Pawn Game"` and `moves` exactly `["e4", "e5"]`.

- [ ] **Step 5: Commit**

```bash
cd mychess
git add scripts/generate-eco-data.ts src/lib/openings/eco-data.ts package.json
git commit -m "feat: generate bundled ECO opening dataset from lichess-org/chess-openings"
git push
```

---

### Task 4: Wire detection into the PGN import planner

**Files:**
- Modify: `src/lib/pgn-import.ts`
- Modify: `src/lib/pgn-import.test.ts`

**Depends on Task 1 and Task 3.**

- [ ] **Step 1: Write the failing test**

Add to `mychess/src/lib/pgn-import.test.ts` (new `describe` block, after the existing tests):

```ts
describe('planImport opening detection', () => {
  it('detects a known opening from the first game', () => {
    const result = planImport('1. e4 e5 *', 'white');
    if ('error' in result) throw new Error('expected moves, got error: ' + result.error);
    expect(result.ecoCode).toBe('C20');
    expect(result.ecoName).toBe("King's Pawn Game");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/pgn-import.test.ts`
Expected: FAIL — `result.ecoCode` is `undefined`, not `'C20'` (the field doesn't exist yet).

- [ ] **Step 3: Implement**

In `mychess/src/lib/pgn-import.ts`, add imports and update the `ImportPlan` type and `planImport` function:

```ts
import { parsePgn } from './pgn/parser';
import { detectOpening } from './openings/classify';
import { ECO_OPENINGS } from './openings/eco-data';

export type MoveRow = {
  fromFen: string;
  toFen: string;
  san: string;
  move_number: number;
  is_player_turn: boolean;
  annotation: string | null;
};

export type ImportPlan =
  | { gameCount: number; moves: MoveRow[]; ecoCode: string | null; ecoName: string | null }
  | { error: string };

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

  const opening = detectOpening(games[0].moves.map((m) => m.san), ECO_OPENINGS);

  return {
    gameCount: games.length,
    moves,
    ecoCode: opening?.code ?? null,
    ecoName: opening?.name ?? null
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/pgn-import.test.ts`
Expected: PASS (all existing tests plus the new one — existing tests are unaffected since none of them asserts the full result shape via `toEqual` on the success branch, only `gameCount`/`moves`/`error`).

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/pgn-import.ts src/lib/pgn-import.test.ts
git commit -m "feat: detect ECO opening when planning a PGN import"
git push
```

---

### Task 5: Write the detected opening onto the new repertoire

**Files:**
- Modify: `src/lib/server/pgn-import.ts`

**Depends on Task 4.** No dedicated test — matches the established convention that Supabase-touching IO wrappers around already-tested pure logic aren't separately unit-tested (see `CLAUDE.md`).

- [ ] **Step 1: Implement**

In `mychess/src/lib/server/pgn-import.ts`, update the `repertoires` insert to include the new fields from the plan:

```ts
  const { data: rep, error: repErr } = await supabase
    .from('repertoires')
    .insert({
      player_id: params.playerId,
      name: params.name,
      color: params.color,
      eco_code: plan.ecoCode,
      eco_name: plan.ecoName
    })
    .select()
    .single();
  if (repErr) return { repertoireId: null, gameCount: null, error: repErr.message };
```

(This replaces the existing `.insert({ player_id: params.playerId, name: params.name, color: params.color })` call — everything else in the function is unchanged.)

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `cd mychess && npx vitest run`
Expected: all tests still pass (this file has no dedicated test, but confirms no regression elsewhere).

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/lib/server/pgn-import.ts
git commit -m "feat: store the detected ECO opening on new repertoires"
git push
```

---

### Task 6: OpeningPicker component

**Files:**
- Create: `src/lib/components/OpeningPicker.svelte`
- Test: `src/lib/components/OpeningPicker.test.ts`

**Depends on Task 1 and Task 3.**

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/components/OpeningPicker.test.ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import OpeningPicker from './OpeningPicker.svelte';

afterEach(() => cleanup());

describe('OpeningPicker', () => {
  it('shows no opening results until the user types a query', () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    expect(screen.queryByText(/Najdorf/i)).toBeNull();
  });

  it('always shows an Unclassified option', () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    expect(screen.getByText('Unclassified')).toBeTruthy();
  });

  it('filters results as the user types', async () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    const input = screen.getByPlaceholderText(/search openings/i);
    await fireEvent.input(input, { target: { value: 'najdorf' } });
    expect(screen.getByText(/Najdorf/i)).toBeTruthy();
  });

  it('shows "No matches." for a query that matches nothing', async () => {
    render(OpeningPicker, { props: { repId: 'r1', onclose: () => {} } });
    const input = screen.getByPlaceholderText(/search openings/i);
    await fireEvent.input(input, { target: { value: 'zzz-no-such-opening' } });
    expect(screen.getByText('No matches.')).toBeTruthy();
  });

  it('calls onclose when the close button is clicked', async () => {
    const onclose = vi.fn();
    render(OpeningPicker, { props: { repId: 'r1', onclose } });
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onclose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/components/OpeningPicker.test.ts`
Expected: FAIL — cannot find module `./OpeningPicker.svelte`.

- [ ] **Step 3: Implement**

```svelte
<!-- mychess/src/lib/components/OpeningPicker.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { searchOpenings } from '$lib/openings/classify';
  import { ECO_OPENINGS } from '$lib/openings/eco-data';

  let { repId, onclose } = $props<{ repId: string; onclose: () => void }>();

  let query = $state('');
  const results = $derived(searchOpenings(query, ECO_OPENINGS).slice(0, 30));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-white rounded-xl shadow-lg max-w-sm w-full max-h-[80vh] overflow-y-auto"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="flex items-center justify-between p-4 border-b border-gray-100">
      <h2 class="font-semibold text-gray-900">Change Opening</h2>
      <button
        type="button"
        onclick={onclose}
        aria-label="Close"
        class="text-gray-400 hover:text-gray-600 text-xl leading-none"
      >
        &times;
      </button>
    </div>

    <div class="p-4 space-y-3">
      <input
        type="text"
        bind:value={query}
        placeholder="Search openings (e.g. Sicilian, B90)…"
        aria-label="Search openings"
        class="w-full text-sm rounded-lg px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <form method="POST" action="?/updateOpening" use:enhance onsubmit={onclose}>
        <input type="hidden" name="rep_id" value={repId} />
        <input type="hidden" name="eco_code" value="" />
        <input type="hidden" name="eco_name" value="" />
        <button class="w-full text-left text-sm text-gray-500 hover:bg-gray-50 rounded-lg px-3 py-2">
          Unclassified
        </button>
      </form>

      {#if query.trim() && results.length === 0}
        <p class="text-sm text-gray-400 px-1">No matches.</p>
      {/if}

      <ul class="space-y-1">
        {#each results as opening}
          <li>
            <form method="POST" action="?/updateOpening" use:enhance onsubmit={onclose}>
              <input type="hidden" name="rep_id" value={repId} />
              <input type="hidden" name="eco_code" value={opening.code} />
              <input type="hidden" name="eco_name" value={opening.name} />
              <button class="w-full text-left text-sm rounded-lg px-3 py-2 hover:bg-indigo-50">
                <span class="font-medium text-indigo-600">{opening.code}</span>
                <span class="text-gray-700"> — {opening.name}</span>
              </button>
            </form>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/components/OpeningPicker.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/components/OpeningPicker.svelte src/lib/components/OpeningPicker.test.ts
git commit -m "feat: add OpeningPicker component for searching/choosing an ECO opening"
git push
```

---

### Task 7: Wire opening display + edit into `/coach/repertoires`

**Files:**
- Modify: `src/routes/(coach)/coach/repertoires/+page.server.ts`
- Modify: `src/routes/(coach)/coach/repertoires/+page.svelte`

**Depends on Task 2 (columns) and Task 6 (component).** No dedicated test file exists for this page's server logic (matches the established Supabase-IO convention); the `.svelte` changes are covered by manual verification in Task 9.

- [ ] **Step 1: Add the columns to the load query and a new `updateOpening` action**

In `mychess/src/routes/(coach)/coach/repertoires/+page.server.ts`, change the `repertoires` select to include the new columns:

```ts
		supabase
			.from('repertoires')
			.select('id, name, color, eco_code, eco_name, created_at, moves(count)')
			.eq('player_id', user!.id)
			.order('created_at', { ascending: false }),
```

Add a new action alongside `delete`/`assign`/`unassign` (inside the existing `actions: Actions = { ... }` object):

```ts
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
```

- [ ] **Step 2: Add the UI**

In `mychess/src/routes/(coach)/coach/repertoires/+page.svelte`, import the component and add modal state:

```ts
  import { enhance } from '$app/forms';
  import OpeningPicker from '$lib/components/OpeningPicker.svelte';

  let { data, form } = $props<{ data: { repertoires: any[]; players: any[] }; form: any }>();
  let filter = $state<'all' | 'white' | 'black'>('all');
  const filtered = $derived(
    filter === 'all' ? data.repertoires : data.repertoires.filter((r: any) => r.color === filter)
  );

  let assignModalRepId = $state<string | null>(null);
  const assignModalRep = $derived(
    assignModalRepId ? data.repertoires.find((r: any) => r.id === assignModalRepId) ?? null : null
  );

  let openingModalRepId = $state<string | null>(null);
```

Add the opening tag + "change" control right after the existing moves-count line (inside the `<div class="flex-1 min-w-0">` block):

```svelte
              <div class="flex-1 min-w-0">
                <h2 class="font-medium text-gray-900 truncate">{rep.name}</h2>
                <p class="text-sm text-gray-400">{rep.moves?.[0]?.count ?? 0} moves</p>
                <p class="text-xs mt-0.5">
                  {#if rep.eco_code}
                    <span class="text-indigo-600 font-medium">{rep.eco_code}</span>
                    <span class="text-gray-400"> — {rep.eco_name}</span>
                  {:else}
                    <span class="text-gray-400">Unclassified</span>
                  {/if}
                  <button type="button" onclick={() => (openingModalRepId = rep.id)}
                          class="text-gray-400 hover:text-indigo-600 hover:underline ml-1">
                    change
                  </button>
                </p>
              </div>
```

Add the picker modal at the end of the file, alongside the existing `assignModalRep` block:

```svelte
{#if openingModalRepId}
  <OpeningPicker repId={openingModalRepId} onclose={() => (openingModalRepId = null)} />
{/if}
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from the pre-existing baseline (12 errors, all in `src/routes/auth/**`).

- [ ] **Step 4: Commit**

```bash
cd mychess
git add "src/routes/(coach)/coach/repertoires/+page.server.ts" "src/routes/(coach)/coach/repertoires/+page.svelte"
git commit -m "feat: show and let coaches edit each repertoire's ECO opening"
git push
```

---

### Task 8: Wire opening display + edit into `/(player)/repertoires`

**Files:**
- Modify: `src/routes/(player)/repertoires/+page.server.ts`
- Modify: `src/routes/(player)/repertoires/+page.svelte`

**Depends on Task 2 (columns) and Task 6 (component).**

- [ ] **Step 1: Add the columns to the load query and a new `updateOpening` action**

Replace the full contents of `mychess/src/routes/(player)/repertoires/+page.server.ts`:

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

- [ ] **Step 2: Add the UI**

Replace the full contents of `mychess/src/routes/(player)/repertoires/+page.svelte`:

```svelte
<script lang="ts">
  import OpeningPicker from '$lib/components/OpeningPicker.svelte';

  let { data } = $props<{ data: { repertoires: any[]; assignedRepertoires: any[] } }>();
  let openingModalRepId = $state<string | null>(null);
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
                {#if rep.eco_code}
                  <p class="text-xs text-indigo-500">{rep.eco_code} — {rep.eco_name}</p>
                {/if}
              </div>
              <a href="/learn" class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-700 transition-colors">Train</a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section>
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold text-gray-900">My Repertoires</h1>
        <a href="/repertoires/new"
           class="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors">
          + Create Repertoire
        </a>
      </div>
      {#if data.repertoires.length === 0}
        <div class="text-center py-16 text-gray-400">
          <p class="text-4xl mb-4">📚</p>
          <p class="font-semibold text-lg text-gray-500">No repertoires yet</p>
          {#if !data.assignedRepertoires?.length}
            <p class="text-sm mt-1">Ask your coach to assign one, or create your own.</p>
          {/if}
        </div>
      {:else}
        <ul class="space-y-2">
          {#each data.repertoires as rep}
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
        </ul>
      {/if}
    </section>

  </div>
</main>

{#if openingModalRepId}
  <OpeningPicker repId={openingModalRepId} onclose={() => (openingModalRepId = null)} />
{/if}
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass — including `src/routes/(player)/repertoires/repertoires.test.ts`, which only asserts the "Assigned by your coach" section and the empty-state hint (both preserved unchanged in the markup above); `svelte-check` error count unchanged from the 12-error baseline.

- [ ] **Step 4: Commit**

```bash
cd mychess
git add "src/routes/(player)/repertoires/+page.server.ts" "src/routes/(player)/repertoires/+page.svelte"
git commit -m "feat: show and let players edit their repertoires' ECO opening"
git push
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd mychess && npx vitest run`
Expected: all tests pass (baseline 214 + 9 classify + 1 pgn-import + 5 OpeningPicker = 229).

- [ ] **Step 2: Run the type-check**

Run: `cd mychess && npm run check`
Expected: error count unchanged from the pre-existing 12-error baseline (all in `src/routes/auth/**`), no new errors introduced by this feature.

- [ ] **Step 3: Confirm migration status with the user**

Remind the user (if not already confirmed) to apply `supabase/migrations/0022_repertoire_eco.sql` via the Supabase SQL editor if they haven't already — the code is fully shipped by this point, but new uploads won't actually persist an opening tag until the columns exist in production.

---

## Out of scope (confirmed with the user during brainstorming)

- Filter-by-opening UI on the repertoire list pages — this plan only lands the data and manual tagging.
- Transposition-aware detection (position/FEN based) — matching is exact SAN move-sequence prefix only.
- Sub-variation granularity beyond one entry per ECO code.
- Any change to `/coach/players/[player_id]`'s per-student assign modal — not named in the spec's scope.
