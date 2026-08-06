# Level Visibility & XP Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-repertoire mastery levels visible and navigable (locked levels ahead, a read-only review mode for passed levels, difficulty tags), and remove the XP system everywhere in favor of evaluating players purely by repertoire progression.

**Architecture:** Levels are already a derived view over `move_progress` (`src/lib/mastery/levels.ts`/`moveProgress.ts`/`practice.ts`) — this plan extends that pure layer with a `totalLevels` count, a `levelTag` lookup, and a review-mode attempt picker, then wires them into the practice pages' server load + UI. A new `src/lib/server/repertoire-progress.ts` helper deduplicates the "compute progress for every accessible repertoire" query so both the practice picker and the dashboard's new mastered-count stat can share it. XP removal is a mechanical strip across every awarding path (Practice/Drill/Time Trial/quests), its UI, three XP-gated badges, and the underlying DB columns/RPCs.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Supabase/Postgres, vitest.

---

### Task 1: Extract `levelCap` in `levels.ts`

**Files:**
- Modify: `src/lib/mastery/levels.ts`
- Test: `src/lib/mastery/levels.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/mastery/levels.test.ts` (extend the existing import line and add a new `describe` block):

```ts
import { describe, it, expect } from 'vitest';
import { levelDepth, targetDepth, isSatisfied, currentLevel, activeLevel, levelCap } from './levels';
```

```ts
describe('levelCap', () => {
	it('is 0 for an empty variation list', () => {
		expect(levelCap([])).toBe(0);
	});

	it('rounds up to the nearest 3-move chunk covering the longest variation', () => {
		expect(levelCap([variation(4, 'a-')])).toBe(2); // ceil(4/3) = 2
		expect(levelCap([variation(9, 'b-')])).toBe(3);
	});

	it('is driven by the longest variation among several', () => {
		expect(levelCap([variation(2, 'short-'), variation(7, 'long-')])).toBe(3); // ceil(7/3) = 3
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/levels.test.ts`
Expected: FAIL — `levelCap` is not exported by `./levels`.

- [ ] **Step 3: Implement**

In `src/lib/mastery/levels.ts`, replace the `currentLevel`/`activeLevel` block (lines 61-86) with:

```ts
/**
 * The number of levels a repertoire has: the level whose depth first covers
 * every variation's full length. 0 for an empty variation list (nothing to
 * level).
 */
export function levelCap(variations: VariationLike[]): number {
	return Math.ceil(maxPlayerMoveCount(variations) / 3);
}

/**
 * The highest level where every variation is satisfied, or 0 if none.
 * Target depth is non-decreasing as level increases, so once a level fails
 * to be fully satisfied, no higher level can be either — safe to stop there.
 * The search only needs to go up to the level whose depth covers the
 * longest variation in the repertoire (`cap`) — beyond that, no variation's
 * target depth changes, so no higher level could ever newly satisfy.
 */
export function currentLevel(variations: VariationLike[], correctMoveIds: Set<string>): number {
	const cap = levelCap(variations);
	let level = 0;
	for (let l = 1; l <= cap; l++) {
		if (variations.every((v) => isSatisfied(v, l, correctMoveIds))) {
			level = l;
		} else {
			break;
		}
	}
	return level;
}

/**
 * The level to practice next, or 'mastered' once every variation's full
 * length is covered (equivalently: once `currentLevel` reaches `cap`,
 * including the vacuous case of an empty variation list — nothing to master).
 */
export function activeLevel(
	variations: VariationLike[],
	correctMoveIds: Set<string>
): Level | 'mastered' {
	const cap = levelCap(variations);
	const level = currentLevel(variations, correctMoveIds);
	return level >= cap ? 'mastered' : level + 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mychess && npx vitest run src/lib/mastery/levels.test.ts`
Expected: PASS (all existing tests plus the 3 new `levelCap` tests).

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/mastery/levels.ts src/lib/mastery/levels.test.ts
git commit -m "feat: extract levelCap from currentLevel/activeLevel"
```

---

### Task 2: Add `totalLevels` to `repertoireProgress`

**Files:**
- Modify: `src/lib/mastery/moveProgress.ts`
- Test: `src/lib/mastery/moveProgress.test.ts`

**Depends on Task 1** (`levelCap`).

- [ ] **Step 1: Write the failing assertions**

In `src/lib/mastery/moveProgress.test.ts`, add a `totalLevels` expectation to each of the three existing `repertoireProgress` tests:

```ts
		const progress = repertoireProgress([a, b], rows);
		expect(progress.totalVariations).toBe(2);
		expect(progress.totalLevels).toBe(2); // ceil(6/3) — driven by the longer variation `b`
		expect(progress.level).toBe(2); // both satisfied at level 1 (depth 3); a is done, b needs level 2's depth 6
		expect(progress.satisfiedCount).toBe(1); // only `a` (fully covered) is satisfied at the active level 2
```

```ts
		const progress = repertoireProgress([a], rows);
		expect(progress.level).toBe('mastered');
		expect(progress.satisfiedCount).toBe(1);
		expect(progress.totalVariations).toBe(1);
		expect(progress.totalLevels).toBe(1); // ceil(2/3)
```

```ts
		const progress = repertoireProgress([], []);
		expect(progress.level).toBe('mastered');
		expect(progress.satisfiedCount).toBe(0);
		expect(progress.totalVariations).toBe(0);
		expect(progress.totalLevels).toBe(0);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/moveProgress.test.ts`
Expected: FAIL — `progress.totalLevels` is `undefined`.

- [ ] **Step 3: Implement**

Replace the full contents of `src/lib/mastery/moveProgress.ts`:

```ts
import type { Variation } from './variations';
import { activeLevel, isSatisfied, levelCap, type Level } from './levels';

export type MoveProgressRow = { move_id: string; state: string };

/** Builds the Set of move ids the player has ever played correctly, from raw `move_progress` rows. */
export function correctMoveIdSet(rows: MoveProgressRow[]): Set<string> {
	return new Set(rows.filter((r) => r.state === 'correct').map((r) => r.move_id));
}

export type RepertoireProgress = {
	level: Level | 'mastered';
	satisfiedCount: number;
	totalVariations: number;
	totalLevels: number;
};

/**
 * Combines a repertoire's enumerated variations with its raw `move_progress`
 * rows into the summary both `/practice` (the picker) and
 * `/practice/[repertoire_id]` (the detail screen) need: the active level (or
 * "mastered"), how many variations are already satisfied at that level, and
 * the repertoire's total level count (for "Level X of Y" displays and the
 * level list).
 */
export function repertoireProgress(variations: Variation[], rows: MoveProgressRow[]): RepertoireProgress {
	const correctMoveIds = correctMoveIdSet(rows);
	const level = activeLevel(variations, correctMoveIds);
	const satisfiedCount =
		level === 'mastered'
			? variations.length
			: variations.filter((v) => isSatisfied(v, level, correctMoveIds)).length;
	return {
		level,
		satisfiedCount,
		totalVariations: variations.length,
		totalLevels: levelCap(variations)
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/moveProgress.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/mastery/moveProgress.ts src/lib/mastery/moveProgress.test.ts
git commit -m "feat: add totalLevels to repertoireProgress"
```

---

### Task 3: Level difficulty tags

**Files:**
- Create: `src/lib/mastery/tags.ts`
- Test: `src/lib/mastery/tags.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/mastery/tags.test.ts
import { describe, it, expect } from 'vitest';
import { levelTag } from './tags';

describe('levelTag', () => {
	it('totalLevels 1: the only level is Beginner', () => {
		expect(levelTag(1, 1)).toBe('Beginner');
	});

	it('totalLevels 2: Beginner then Advanced (no Regular/Expert)', () => {
		expect(levelTag(1, 2)).toBe('Beginner');
		expect(levelTag(2, 2)).toBe('Advanced');
	});

	it('totalLevels 3: Beginner, Advanced, Expert', () => {
		expect(levelTag(1, 3)).toBe('Beginner');
		expect(levelTag(2, 3)).toBe('Advanced');
		expect(levelTag(3, 3)).toBe('Expert');
	});

	it('totalLevels 4: Regular appears at level 2', () => {
		expect(levelTag(1, 4)).toBe('Beginner');
		expect(levelTag(2, 4)).toBe('Regular');
		expect(levelTag(3, 4)).toBe('Advanced');
		expect(levelTag(4, 4)).toBe('Expert');
	});

	it('totalLevels 5: Regular grows to two levels', () => {
		expect(levelTag(1, 5)).toBe('Beginner');
		expect(levelTag(2, 5)).toBe('Regular');
		expect(levelTag(3, 5)).toBe('Regular');
		expect(levelTag(4, 5)).toBe('Advanced');
		expect(levelTag(5, 5)).toBe('Expert');
	});

	it('totalLevels 6: Beginner grows to two levels', () => {
		expect(levelTag(1, 6)).toBe('Beginner');
		expect(levelTag(2, 6)).toBe('Beginner');
		expect(levelTag(3, 6)).toBe('Regular');
		expect(levelTag(4, 6)).toBe('Regular');
		expect(levelTag(5, 6)).toBe('Advanced');
		expect(levelTag(6, 6)).toBe('Expert');
	});

	it('totalLevels 7: Advanced grows to two levels', () => {
		expect(levelTag(1, 7)).toBe('Beginner');
		expect(levelTag(2, 7)).toBe('Beginner');
		expect(levelTag(3, 7)).toBe('Regular');
		expect(levelTag(4, 7)).toBe('Regular');
		expect(levelTag(5, 7)).toBe('Advanced');
		expect(levelTag(6, 7)).toBe('Advanced');
		expect(levelTag(7, 7)).toBe('Expert');
	});

	it('totalLevels 10: Expert absorbs every level beyond 6', () => {
		expect(levelTag(6, 10)).toBe('Advanced');
		expect(levelTag(7, 10)).toBe('Expert');
		expect(levelTag(8, 10)).toBe('Expert');
		expect(levelTag(9, 10)).toBe('Expert');
		expect(levelTag(10, 10)).toBe('Expert');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/tags.test.ts`
Expected: FAIL — `./tags` has no exported members (module doesn't exist yet).

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/mastery/tags.ts
import type { Level } from './levels';

export type LevelTag = 'Beginner' | 'Regular' | 'Advanced' | 'Expert';

// [Beginner, Regular, Advanced, Expert] level counts, for totalLevels 1..7.
// Tier sizes grow in a fixed order as totalLevels increases: Regular appears
// at 4, Regular grows at 5, Beginner grows at 6, Advanced grows at 7. Beyond
// 7, Expert absorbs every additional level (see tierSizes below).
const TIER_SIZES: Record<number, [number, number, number, number]> = {
	1: [1, 0, 0, 0],
	2: [1, 0, 1, 0],
	3: [1, 0, 1, 1],
	4: [1, 1, 1, 1],
	5: [1, 2, 1, 1],
	6: [2, 2, 1, 1],
	7: [2, 2, 2, 1]
};

function tierSizes(totalLevels: number): [number, number, number, number] {
	if (totalLevels <= 0) return [0, 0, 0, 0];
	if (totalLevels <= 7) return TIER_SIZES[totalLevels];
	const [b, r, a] = TIER_SIZES[7];
	return [b, r, a, totalLevels - (b + r + a)]; // Expert absorbs everything beyond 7
}

/** The difficulty tag for `level` within a repertoire that has `totalLevels` levels in total. */
export function levelTag(level: Level, totalLevels: number): LevelTag {
	const [b, r, a] = tierSizes(totalLevels);
	if (level <= b) return 'Beginner';
	if (level <= b + r) return 'Regular';
	if (level <= b + r + a) return 'Advanced';
	return 'Expert';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/tags.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/mastery/tags.ts src/lib/mastery/tags.test.ts
git commit -m "feat: add per-level difficulty tags (Beginner/Regular/Advanced/Expert)"
```

---

### Task 4: Review-mode attempt picker

**Files:**
- Modify: `src/lib/mastery/practice.ts`
- Test: `src/lib/mastery/practice.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/mastery/practice.test.ts` (extend the import line and add a new `describe` block after the existing `pickPracticeAttempt` block):

```ts
import { describe, it, expect } from 'vitest';
import { pickPracticeAttempt, pickReviewAttempt, splitAttempt } from './practice';
import type { Variation, VariationStep } from './variations';
```

```ts
describe('pickReviewAttempt', () => {
	it('picks among variations with quiz content at the level, regardless of satisfied state', () => {
		const v = makeVariation(6, 'r1-');
		const result = pickReviewAttempt([v], 1, () => 0);
		expect(result).not.toBeNull();
		expect(result!.variation.leafMoveId).toBe(v.leafMoveId);
		expect(result!.targetDepth).toBe(3); // level 1 depth
	});

	it("excludes variations naturally shorter than the level's starting point", () => {
		const short = makeVariation(2, 'short-'); // no content left at level 2 (starts at move 4)
		const long = makeVariation(6, 'long-');
		const result = pickReviewAttempt([short, long], 2, () => 0);
		expect(result!.variation.leafMoveId).toBe(long.leafMoveId);
	});

	it('returns null when no variation has content at the level', () => {
		const v = makeVariation(2, 'v-');
		expect(pickReviewAttempt([v], 2)).toBeNull();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — `pickReviewAttempt` is not exported by `./practice`.

- [ ] **Step 3: Implement**

Add to the end of `src/lib/mastery/practice.ts` (the `isSatisfied, targetDepth, levelDepth, type Level` import at the top already covers everything this needs):

```ts
/**
 * Picks a random variation with quiz content at `level`, ignoring whether
 * it's already satisfied — used to review a level the player has already
 * passed, where every variation IS already satisfied (so the `isSatisfied`
 * filter `pickPracticeAttempt` uses would exclude everything).
 */
export function pickReviewAttempt(
	variations: Variation[],
	level: Level,
	random: () => number = Math.random
): PracticeAttempt | null {
	const candidates = variations.filter((v) => v.playerMoveCount > levelDepth(level - 1));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	return { variation: chosen, targetDepth: targetDepth(chosen, level) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS (all existing tests plus the 3 new `pickReviewAttempt` tests).

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/mastery/practice.ts src/lib/mastery/practice.test.ts
git commit -m "feat: add pickReviewAttempt for reviewing a passed level"
```

---

### Task 5: Shared repertoire-progress server helper

**Files:**
- Create: `src/lib/server/repertoire-progress.ts`
- Modify: `src/routes/(player)/practice/+page.server.ts`

**Depends on Task 2** (`totalLevels`). Not unit-tested — matches this codebase's convention for thin Supabase I/O wrappers under `src/lib/server/`. This extracts the practice picker's existing data-fetching logic unchanged (just renamed/relocated) so Task 15 (dashboard mastered-count stat) can reuse it instead of duplicating ~40 lines of Supabase querying.

- [ ] **Step 1: Create the shared helper**

```ts
// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { repertoireProgress, type RepertoireProgress } from '$lib/mastery/moveProgress';

export type RepertoireProgressSummary = RepertoireProgress & {
	id: string;
	name: string;
	color: string;
};

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed mastery progress. Shared by the `/practice` picker and the
 * dashboard's mastered-repertoire count so both stay in sync with a single
 * query shape instead of duplicating it.
 */
export async function loadRepertoireProgressSummaries(
	supabase: SupabaseClient,
	userId: string
): Promise<RepertoireProgressSummary[]> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id(id, name, color)')
			.eq('player_id', userId)
	]);

	const assignedReps = (assigned ?? []).map((a: any) => a.repertoire).filter(Boolean);
	const seen = new Set((ownReps ?? []).map((r: any) => r.id));
	const allReps = [...(ownReps ?? []), ...assignedReps.filter((r: any) => !seen.has(r.id))];

	if (allReps.length === 0) return [];

	const repIds = allReps.map((r: any) => r.id);
	const { data: rawMoves } = await supabase
		.from('moves')
		.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
		.in('repertoire_id', repIds);

	// Only level/satisfiedCount/totalVariations/totalLevels are needed here,
	// all derived purely from moveId/isPlayerTurn — never from FEN — so the
	// fen columns aren't fetched (unlike the [repertoire_id] detail page,
	// which needs them to render the board).
	const movesByRep = new Map<string, RawMoveRow[]>();
	for (const m of (rawMoves ?? []) as any[]) {
		const list = movesByRep.get(m.repertoire_id) ?? [];
		list.push({
			id: m.id,
			san: m.san,
			isPlayerTurn: m.is_player_turn,
			fromPositionId: m.from_position,
			toPositionId: m.to_position,
			fromFen: '',
			toFen: ''
		});
		movesByRep.set(m.repertoire_id, list);
	}

	// Filtered via the moves relation (not `.in('move_id', allMoveIds)`) — with
	// move ids embedded directly in the request URL, a player with enough
	// total moves across their repertoires can exceed URL length limits,
	// silently failing the query and making solved progress look like it
	// never saved.
	const { data: progressRows } = await supabase
		.from('move_progress')
		.select('move_id, state, moves!inner(repertoire_id)')
		.eq('player_id', userId)
		.in('moves.repertoire_id', repIds);

	return allReps.map((r: any) => {
		const variations = enumerateVariations(movesByRep.get(r.id) ?? []);
		// `progressRows` spans every repertoire's move ids at once (one query),
		// but repertoireProgress only ever looks up ids that appear in this
		// repertoire's own `variations`, so passing the full set is harmless —
		// no need to pre-split it per repertoire.
		const progress = repertoireProgress(variations, progressRows ?? []);
		return { id: r.id, name: r.name, color: r.color, ...progress };
	});
}
```

- [ ] **Step 2: Refactor the practice picker to use it**

Replace the full contents of `src/routes/(player)/practice/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireProgressSummaries } from '$lib/server/repertoire-progress';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const repertoires = await loadRepertoireProgressSummaries(locals.supabase, user!.id);
	return { repertoires };
};
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from the pre-existing baseline (12 errors, all in `src/routes/auth/**`).

- [ ] **Step 4: Manual check**

Open `/practice` and confirm the repertoire list still renders exactly as before (names, colors, "Level N · X/Y solved" text) — this task only relocates the query, it doesn't change any output yet.

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/server/repertoire-progress.ts "src/routes/(player)/practice/+page.server.ts"
git commit -m "refactor: extract shared repertoire-progress loader for practice picker and dashboard"
```

---

### Task 6: Practice picker — "Level X of Y" + tag label

**Files:**
- Modify: `src/routes/(player)/practice/+page.svelte`

**Depends on Task 3** (`levelTag`) and Task 5 (`totalLevels` now flows through `rep`).

- [ ] **Step 1: Update the label**

In `src/routes/(player)/practice/+page.svelte`, change:

```svelte
<script lang="ts">
  let { data } = $props<{ data: { repertoires: any[] } }>();
</script>
```

to:

```svelte
<script lang="ts">
  import { levelTag } from '$lib/mastery/tags';

  let { data } = $props<{ data: { repertoires: any[] } }>();
</script>
```

and change:

```svelte
                <p class="text-sm text-gray-400">
                  {#if rep.totalVariations === 0}
                    No moves yet
                  {:else if rep.level === 'mastered'}
                    🏆 Mastered
                  {:else}
                    Level {rep.level} · {rep.satisfiedCount}/{rep.totalVariations} solved
                  {/if}
                </p>
```

to:

```svelte
                <p class="text-sm text-gray-400">
                  {#if rep.totalVariations === 0}
                    No moves yet
                  {:else if rep.level === 'mastered'}
                    🏆 Mastered · {levelTag(rep.totalLevels, rep.totalLevels)}
                  {:else}
                    Level {rep.level} of {rep.totalLevels} · {levelTag(rep.level, rep.totalLevels)} · {rep.satisfiedCount}/{rep.totalVariations} solved
                  {/if}
                </p>
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 3: Manual check**

Open `/practice` and confirm each repertoire row now shows e.g. "Level 2 of 4 · Regular · 3/5 solved" (or "🏆 Mastered · Expert" for a fully mastered one).

- [ ] **Step 4: Commit**

```bash
cd mychess
git add "src/routes/(player)/practice/+page.svelte"
git commit -m "feat: show total levels and difficulty tag on the practice picker"
```

---

### Task 7: Practice detail page server load — `totalLevels` + review mode

**Files:**
- Modify: `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`

**Depends on Task 2** (`totalLevels`) and Task 4 (`pickReviewAttempt`).

- [ ] **Step 1: Implement**

Replace the full contents of `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { mergeRepertoireIds } from '$lib/repertoire';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { correctMoveIdSet, repertoireProgress } from '$lib/mastery/moveProgress';
import { pickPracticeAttempt, pickReviewAttempt, splitAttempt } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id').eq('player_id', user!.id),
		supabase.from('assigned_repertoires').select('repertoire_id').eq('player_id', user!.id)
	]);
	const allowedIds = mergeRepertoireIds(
		ownReps?.map((r) => r.id) ?? [],
		assigned?.map((a) => a.repertoire_id) ?? []
	);
	if (!allowedIds.includes(repertoireId)) {
		throw error(404, 'Repertoire not found');
	}

	const [{ data: repertoire }, { data: rawMoves }] = await Promise.all([
		supabase.from('repertoires').select('id, name, color').eq('id', repertoireId).single(),
		supabase
			.from('moves')
			.select(
				'id, san, is_player_turn, from_position, to_position, from_pos:from_position(fen), to_pos:to_position(fen)'
			)
			.eq('repertoire_id', repertoireId)
	]);

	if (!repertoire) {
		throw error(404, 'Repertoire not found');
	}

	const moves: RawMoveRow[] = (rawMoves ?? []).map((m: any) => ({
		id: m.id,
		san: m.san,
		isPlayerTurn: m.is_player_turn,
		fromPositionId: m.from_position,
		toPositionId: m.to_position,
		fromFen: m.from_pos?.fen ?? '',
		toFen: m.to_pos?.fen ?? ''
	}));

	const variations = enumerateVariations(moves);

	// Filtered via the moves relation (not `.in('move_id', moveIds)`) — a
	// repertoire's move ids embedded directly in the request URL can exceed
	// length limits once a repertoire has a few hundred moves, silently
	// failing the query and making solved progress look like it never saved.
	const { data: progressRows } = await supabase
		.from('move_progress')
		.select('move_id, state, moves!inner(repertoire_id)')
		.eq('player_id', user!.id)
		.eq('moves.repertoire_id', repertoireId);

	const { level, satisfiedCount, totalVariations, totalLevels } = repertoireProgress(
		variations,
		progressRows ?? []
	);
	const correctMoveIds = correctMoveIdSet(progressRows ?? []);

	// A `?level=N` request only takes effect for a level strictly below the
	// active one (or any level up to totalLevels once mastered) — anything
	// else (the active level, a locked level, garbage input) is ignored and
	// the page falls back to normal training below. This means URL tampering
	// to peek at a locked level just does nothing, rather than erroring.
	const requestedLevel = Number(url.searchParams.get('level'));
	const isValidReview =
		Number.isInteger(requestedLevel) &&
		requestedLevel >= 1 &&
		(level === 'mastered' ? requestedLevel <= totalLevels : requestedLevel < level);
	const reviewLevel = isValidReview ? requestedLevel : null;

	let attempt: {
		prefix: ReturnType<typeof splitAttempt>['prefix'];
		quizSteps: ReturnType<typeof splitAttempt>['quizSteps'];
	} | null = null;

	if (reviewLevel !== null) {
		const picked = pickReviewAttempt(variations, reviewLevel);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, reviewLevel, picked.targetDepth);
			attempt = { prefix, quizSteps };
		}
	} else if (level !== 'mastered') {
		const picked = pickPracticeAttempt(variations, level, correctMoveIds);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, level, picked.targetDepth);
			attempt = { prefix, quizSteps };
		}
	}

	return { repertoire, level, totalVariations, totalLevels, satisfiedCount, attempt, reviewLevel };
};
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass (no dedicated test file for this loader — matches this codebase's convention for Supabase-touching page loaders); `svelte-check` error count unchanged from baseline.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add "src/routes/(player)/practice/[repertoire_id]/+page.server.ts"
git commit -m "feat: add totalLevels and review-mode level param to practice detail load"
```

---

### Task 8: `LevelList` component

**Files:**
- Create: `src/lib/components/LevelList.svelte`

**Depends on Task 3** (`levelTag`).

- [ ] **Step 1: Implement**

```svelte
<!-- mychess/src/lib/components/LevelList.svelte -->
<script lang="ts">
  import { levelTag } from '$lib/mastery/tags';

  let {
    totalLevels,
    currentLevel,
    reviewLevel = null,
    onselect
  } = $props<{
    totalLevels: number;
    currentLevel: number | 'mastered';
    reviewLevel?: number | null;
    onselect: (level: number) => void;
  }>();

  function status(level: number): 'passed' | 'current' | 'locked' {
    if (currentLevel === 'mastered') return 'passed';
    if (level < currentLevel) return 'passed';
    if (level === currentLevel) return 'current';
    return 'locked';
  }
</script>

<div class="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100 overflow-hidden">
  {#each Array.from({ length: totalLevels }, (_, i) => i + 1) as level}
    {@const st = status(level)}
    <button
      type="button"
      disabled={st === 'locked'}
      onclick={() => st === 'passed' && onselect(level)}
      class="w-full flex items-center justify-between px-4 py-3 text-left transition
             {st === 'locked' ? 'opacity-40 cursor-not-allowed' : ''}
             {reviewLevel === level ? 'bg-indigo-50' : st === 'current' ? 'bg-indigo-50/50' : ''}
             {st === 'passed' ? 'hover:bg-gray-50' : ''}"
    >
      <span class="font-medium text-gray-900">
        Level {level}
        {#if st === 'current'}<span class="text-indigo-600 text-xs ml-1">· current</span>{/if}
      </span>
      <span class="text-sm text-gray-400">{levelTag(level, totalLevels)}</span>
    </button>
  {/each}
  {#if currentLevel === 'mastered'}
    <div class="w-full flex items-center justify-between px-4 py-3 bg-amber-50">
      <span class="font-medium text-amber-700">🏆 Mastered</span>
      <span class="text-sm text-amber-500">{levelTag(totalLevels, totalLevels)}</span>
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Run the type-check**

Run: `cd mychess && npm run check`
Expected: `svelte-check` error count unchanged from baseline (this component isn't used anywhere yet, so it can't itself introduce a runtime issue — this just confirms it type-checks in isolation).

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/lib/components/LevelList.svelte
git commit -m "feat: add LevelList component for passed/current/locked level display"
```

---

### Task 9: Practice detail page UI — level list, review mode, remove XP toast

**Files:**
- Modify: `src/routes/(player)/practice/[repertoire_id]/+page.svelte`

**Depends on Tasks 7 and 8.**

- [ ] **Step 1: Update imports and remove `sessionXp`**

Change:

```svelte
<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	let phase = $state<'playing' | 'success' | 'leveled-up'>('playing');
	let locked = $state(false);
	let replaying = $state(false);
	let sessionXp = $state(0);
```

to:

```svelte
<script lang="ts">
	import ChessBoard from '$lib/components/ChessBoard.svelte';
	import LevelList from '$lib/components/LevelList.svelte';
	import type { Key } from 'chessground/types';
	import { Chess } from 'chess.js';
	import { playCorrect, playWrong } from '$lib/sounds';
	import { goto, invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { levelTag } from '$lib/mastery/tags';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	let phase = $state<'playing' | 'success' | 'leveled-up'>('playing');
	let locked = $state(false);
	let replaying = $state(false);
```

- [ ] **Step 2: Add derived values for review mode and the tag label**

Change:

```svelte
	const attempt = $derived(data.attempt);
	const repertoireId = $derived(data.repertoire?.id);
```

to:

```svelte
	const attempt = $derived(data.attempt);
	const repertoireId = $derived(data.repertoire?.id);
	const reviewLevel = $derived(data.reviewLevel as number | null);
	const currentTag = $derived(
		typeof data.level === 'number' ? levelTag(data.level, data.totalLevels) : levelTag(data.totalLevels, data.totalLevels)
	);

	function selectLevel(level: number) {
		goto(`/practice/${repertoireId}?level=${level}`);
	}

	function exitReview() {
		goto(`/practice/${repertoireId}`);
	}
```

- [ ] **Step 3: Skip the progress write and remove `xpAwarded` handling during review**

Change:

```svelte
		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			// Grading is instant and per-move: persist + award XP for this exact
			// move the moment it's played, independent of whether the rest of the
			// attempt succeeds.
			pendingProgress.push(submitMoveProgress(step.moveId));
```

to:

```svelte
		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			// Grading is instant and per-move: persist the moment it's played,
			// independent of whether the rest of the attempt succeeds. Skipped
			// during review — every move in a passed level is already 'correct',
			// so there's nothing new to persist, and review is intentionally a
			// pure read-only replay.
			if (reviewLevel === null) pendingProgress.push(submitMoveProgress(step.moveId));
```

Change:

```svelte
	async function submitMoveProgress(moveId: string) {
		try {
			const res = await fetch('/api/practice/move-progress', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ moveId })
			});
			const result = await res.json();
			sessionXp += result.xpAwarded ?? 0;
		} catch {
			// Progress submission failed — the move itself already played
			// correctly on the board; just skip the XP bump silently rather than
			// blocking the player on a network hiccup.
		}
	}
```

to:

```svelte
	async function submitMoveProgress(moveId: string) {
		try {
			await fetch('/api/practice/move-progress', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ moveId })
			});
		} catch {
			// Progress submission failed — the move itself already played
			// correctly on the board; just skip silently rather than blocking the
			// player on a network hiccup.
		}
	}
```

- [ ] **Step 4: Skip the level-up check during review in `nextAttempt`**

Change:

```svelte
	async function nextAttempt() {
		const levelBefore = data.level;
		await Promise.all(pendingProgress);
		pendingProgress = [];
		await invalidateAll();
		// `data` now reflects the fresh load. If completing that attempt was
		// the last unsatisfied variation at this level, the recomputed level
		// has already advanced (or the repertoire is now 'mastered', handled
		// by the top-level template branch) — surface that instead of
		// silently dropping the player into the next level's quiz.
		if (typeof levelBefore === 'number' && data.level !== levelBefore) {
			phase = 'leveled-up';
		} else {
			resetForAttempt();
		}
	}
```

to:

```svelte
	async function nextAttempt() {
		const levelBefore = data.level;
		await Promise.all(pendingProgress);
		pendingProgress = [];
		await invalidateAll();
		// `data` now reflects the fresh load. If completing that attempt was
		// the last unsatisfied variation at this level, the recomputed level
		// has already advanced (or the repertoire is now 'mastered', handled
		// by the top-level template branch) — surface that instead of
		// silently dropping the player into the next level's quiz. Never
		// applies during review: reviewing a passed level can't change which
		// level is active, so it always just serves another review attempt.
		if (reviewLevel === null && typeof levelBefore === 'number' && data.level !== levelBefore) {
			phase = 'leveled-up';
		} else {
			resetForAttempt();
		}
	}
```

- [ ] **Step 5: Update the template — header, reviewing banner, level list, labels**

Change:

```svelte
<main class="min-h-screen bg-gray-50 p-4 max-w-5xl mx-auto pb-24">
	<div class="flex items-center justify-between mb-4">
		<a href="/practice" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
		<span class="text-indigo-600 font-bold text-sm">+{sessionXp} XP</span>
	</div>

	{#if data.level === 'mastered' && data.totalVariations > 0}
		<div class="flex flex-col items-center justify-center min-h-screen gap-6 text-center">
			<p class="text-7xl">🏆</p>
			<h1 class="text-3xl font-bold text-gray-900">Repertoire Mastered!</h1>
			<p class="text-gray-500">Every variation in {data.repertoire?.name} is fully learned.</p>
			<a
				href="/practice"
				class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition"
			>
				Back to Repertoires
			</a>
		</div>
	{:else if !attempt}
```

to:

```svelte
<main class="min-h-screen bg-gray-50 p-4 max-w-5xl mx-auto pb-24">
	<div class="mb-4">
		<a href="/practice" class="text-gray-400 text-sm hover:text-gray-600">← All Repertoires</a>
	</div>

	{#if reviewLevel !== null}
		<div class="mb-4 flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-sm">
			<span class="text-indigo-700 font-medium">🔁 Reviewing Level {reviewLevel}</span>
			<button onclick={exitReview} class="text-indigo-600 hover:underline">Exit review</button>
		</div>
	{/if}

	{#if data.level === 'mastered' && data.totalVariations > 0 && reviewLevel === null}
		<div class="flex flex-col items-center gap-6 text-center py-16">
			<p class="text-7xl">🏆</p>
			<h1 class="text-3xl font-bold text-gray-900">Repertoire Mastered!</h1>
			<p class="text-gray-500">Every variation in {data.repertoire?.name} is fully learned.</p>
			<a
				href="/practice"
				class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition"
			>
				Back to Repertoires
			</a>
			<div class="w-full max-w-sm text-left">
				<LevelList totalLevels={data.totalLevels} currentLevel={data.level} reviewLevel={null} onselect={selectLevel} />
			</div>
		</div>
	{:else if !attempt}
```

Change the sidebar progress card:

```svelte
				<div class="w-full lg:w-72 shrink-0 space-y-4">
					<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center">
						<p class="text-gray-400 text-sm font-medium">
							{data.repertoire?.name} · Level {data.level}
						</p>
						<p class="text-gray-400 text-sm">{data.satisfiedCount}/{data.totalVariations} solved</p>
					</div>
```

to:

```svelte
				<div class="w-full lg:w-72 shrink-0 space-y-4">
					<div class="p-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-center">
						<p class="text-gray-400 text-sm font-medium">
							{data.repertoire?.name} · Level {data.level} of {data.totalLevels} · {currentTag}
						</p>
						<p class="text-gray-400 text-sm">{data.satisfiedCount}/{data.totalVariations} solved</p>
					</div>

					<LevelList
						totalLevels={data.totalLevels}
						currentLevel={data.level}
						reviewLevel={reviewLevel}
						onselect={selectLevel}
					/>
```

- [ ] **Step 6: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 7: Manual browser check**

Open a partially-progressed repertoire's `/practice/[repertoire_id]`. Confirm: the level list shows passed levels below the current one as clickable, the current level highlighted, higher levels grayed out and unclickable. Click a passed level, confirm the "Reviewing Level N" banner appears and the board loads a quiz from that level. Solve it, confirm "Continue" serves another review attempt (no level-up message). Click "Exit review", confirm normal training resumes at the real active level. Open a fully mastered repertoire and confirm its level list still lets you review any level.

- [ ] **Step 8: Commit**

```bash
cd mychess
git add "src/routes/(player)/practice/[repertoire_id]/+page.svelte"
git commit -m "feat: add level list and review mode to the practice detail page"
```

---

### Task 10: Remove XP from Practice's move-progress endpoint

**Files:**
- Modify: `src/routes/api/practice/move-progress/+server.ts`

**Depends on Task 9** (the client no longer reads `xpAwarded`).

- [ ] **Step 1: Implement**

Replace the full contents of `src/routes/api/practice/move-progress/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markMoveCorrect } from '$lib/server/move-progress';

/**
 * Called the instant a move is played CORRECTLY (in Practice's interactive
 * range) — grading is per-move, not per-attempt. A move flips 'new' ->
 * 'correct' immediately and stays that way.
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { moveId } = await request.json();
  if (!moveId || typeof moveId !== 'string') {
    throw error(400, 'Invalid request');
  }

  const { error: progressError } = await markMoveCorrect(supabase, user.id, moveId);
  if (progressError) throw error(500, progressError);

  return json({ ok: true });
};
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add "src/routes/api/practice/move-progress/+server.ts"
git commit -m "feat: remove XP awarding from the practice move-progress endpoint"
```

---

### Task 11: Remove XP from Drill mode

**Files:**
- Modify: `src/routes/api/drill/+server.ts`
- Modify: `src/routes/(player)/drill/+page.svelte`

- [ ] **Step 1: Strip XP from the endpoint, keep streak/quest/badge logic**

Replace the full contents of `src/routes/api/drill/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { chain, bestChain } = await request.json() as {
    chain: number;
    bestChain: number;
  };

  // Record drill session
  await supabase.from('sessions').insert({
    player_id: user.id,
    mode: 'drill',
    cards_reviewed: chain
  });

  if (chain > 0) {
    await supabase.rpc('update_streak', { p_player_id: user.id });
  }

  // Update quest progress for drill_streak
  if (chain >= 5) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: quest } = await supabase
      .from('quests')
      .select('*')
      .eq('player_id', user.id)
      .eq('date', today)
      .eq('quest_id', 'drill_streak')
      .single();

    if (quest && !quest.completed) {
      const newProgress = Math.min(quest.progress + 1, quest.target);
      const nowComplete = newProgress >= quest.target;
      await supabase
        .from('quests')
        .update({ progress: newProgress, completed: nowComplete })
        .eq('id', quest.id);
    }
  }

  grantNewBadges(supabase, user.id, { drillStreak: bestChain }).catch(() => {});

  return json({ ok: true });
};
```

- [ ] **Step 2: Strip XP from the Drill UI**

In `src/routes/(player)/drill/+page.svelte`, change:

```svelte
  let currentIdx = $state(0);
  let chain = $state(0);
  let bestChain = $state(0);
  let sessionXp = $state(0);
  let failed = $state(false);
```

to:

```svelte
  let currentIdx = $state(0);
  let chain = $state(0);
  let bestChain = $state(0);
  let failed = $state(false);
```

Change:

```svelte
    if (detail.san === targetSan) {
      playCorrect();
      wrongMove = false;
      chain++;
      if (chain > bestChain) bestChain = chain;
      sessionXp += 2;

      if (chain === 10) {
        playLevelUp();
        sessionXp += 50;
        finished = true;
        submitDrillResult();
        return;
      }
```

to:

```svelte
    if (detail.san === targetSan) {
      playCorrect();
      wrongMove = false;
      chain++;
      if (chain > bestChain) bestChain = chain;

      if (chain === 10) {
        playLevelUp();
        finished = true;
        submitDrillResult();
        return;
      }
```

Change:

```svelte
  async function submitDrillResult() {
    await fetch('/api/drill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, sessionXp, bestChain })
    });
  }
```

to:

```svelte
  async function submitDrillResult() {
    await fetch('/api/drill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain, bestChain })
    });
  }
```

Change:

```svelte
      <div class="text-right">
        <div class="text-base font-bold text-indigo-600">Chain: {chain}</div>
        <div class="text-xs text-gray-400">XP: {sessionXp}</div>
      </div>
```

to:

```svelte
      <div class="text-right">
        <div class="text-base font-bold text-indigo-600">Chain: {chain}</div>
      </div>
```

Change:

```svelte
        <p class="text-gray-500 mt-2">Best chain: <strong>{bestChain}</strong> moves</p>
        {#if bestChain >= 10}
          <p class="text-green-600 font-bold mt-1">+50 bonus XP for 10-chain!</p>
        {/if}
```

to:

```svelte
        <p class="text-gray-500 mt-2">Best chain: <strong>{bestChain}</strong> moves</p>
```

Change:

```svelte
        <div class="bg-gray-50 border border-gray-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-gray-400">Session XP</div>
          <div class="text-2xl font-bold text-gray-700">{sessionXp}</div>
        </div>
      </div>
```

to:

```svelte
      </div>
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 4: Manual browser check**

Play a Drill session, break the chain, confirm no XP is shown anywhere and the chain/best-chain UI still works.

- [ ] **Step 5: Commit**

```bash
cd mychess
git add "src/routes/api/drill/+server.ts" "src/routes/(player)/drill/+page.svelte"
git commit -m "feat: remove XP from Drill mode"
```

---

### Task 12: Remove XP from Time Trial mode

**Files:**
- Modify: `src/routes/api/time-trial/+server.ts`
- Modify: `src/routes/(player)/time-trial/+page.svelte`

- [ ] **Step 1: Strip XP from the endpoint**

Replace the full contents of `src/routes/api/time-trial/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { correct } = await request.json() as {
    correct: number;
  };

  await supabase.from('sessions').insert({
    player_id: user.id,
    mode: 'time_trial',
    cards_reviewed: correct
  });

  if (correct > 0) {
    await supabase.rpc('update_streak', { p_player_id: user.id });
  }

  // Update quest progress for time_trial
  if (correct >= 8) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: quest } = await supabase
      .from('quests')
      .select('*')
      .eq('player_id', user.id)
      .eq('date', today)
      .eq('quest_id', 'time_trial')
      .single();

    if (quest && !quest.completed) {
      const newProgress = Math.min(quest.progress + 1, quest.target);
      const nowComplete = newProgress >= quest.target;
      await supabase
        .from('quests')
        .update({ progress: newProgress, completed: nowComplete })
        .eq('id', quest.id);
    }
  }

  grantNewBadges(supabase, user.id, { ttBestScore: correct }).catch(() => {});

  return json({ ok: true });
};
```

- [ ] **Step 2: Strip XP from the Time Trial UI**

In `src/routes/(player)/time-trial/+page.svelte`, change:

```svelte
  let started = $state(false);
  let finished = $state(false);
  let wrongMove = $state(false);
  let sessionXp = $state(0);
```

to:

```svelte
  let started = $state(false);
  let finished = $state(false);
  let wrongMove = $state(false);
```

Change:

```svelte
    if (detail.san === targetSan) {
      playCorrect();
      wrongMove = false;
      correct++;
      sessionXp += 5;
      currentIdx++;
      return true;
```

to:

```svelte
    if (detail.san === targetSan) {
      playCorrect();
      wrongMove = false;
      correct++;
      currentIdx++;
      return true;
```

Change:

```svelte
    currentIdx = 0;
    correct = 0;
    timeLeft = DURATION;
    started = false;
    finished = false;
    wrongMove = false;
    sessionXp = 0;
  }

  async function submitResult() {
    const bonus = correct >= 20 ? 200 : 0;
    await fetch('/api/time-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct, sessionXp: sessionXp + bonus, bonus })
    });
    if (bonus > 0) sessionXp += bonus;
  }
```

to:

```svelte
    currentIdx = 0;
    correct = 0;
    timeLeft = DURATION;
    started = false;
    finished = false;
    wrongMove = false;
  }

  async function submitResult() {
    await fetch('/api/time-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correct })
    });
  }
```

Change:

```svelte
        <p class="text-gray-500 mt-2">You got <strong>{correct}</strong> correct in 60 seconds</p>
        {#if correct >= 20}
          <p class="text-green-600 font-bold mt-1">+200 Bonus XP for 20+ correct!</p>
        {/if}
```

to:

```svelte
        <p class="text-gray-500 mt-2">You got <strong>{correct}</strong> correct in 60 seconds</p>
```

Change:

```svelte
        <p class="text-gray-500 mb-4">Answer as many opening moves as you can. +5 XP per correct, +200 bonus for 20+!</p>
```

to:

```svelte
        <p class="text-gray-500 mb-4">Answer as many opening moves as you can, before time runs out!</p>
```

Change:

```svelte
        <div class="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 text-center">
          <div class="text-xs text-indigo-400">XP</div>
          <div class="text-2xl font-bold text-indigo-700">{sessionXp}</div>
        </div>
        <div class="bg-red-50 border border-red-100 rounded-xl px-4 py-2 text-center">
```

to:

```svelte
        <div class="bg-red-50 border border-red-100 rounded-xl px-4 py-2 text-center">
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 4: Manual browser check**

Play a full 60-second Time Trial round, confirm no XP is shown anywhere and the correct-count UI still works.

- [ ] **Step 5: Commit**

```bash
cd mychess
git add "src/routes/api/time-trial/+server.ts" "src/routes/(player)/time-trial/+page.svelte"
git commit -m "feat: remove XP from Time Trial mode"
```

---

### Task 13: Remove XP from quests

**Files:**
- Modify: `src/lib/quests/generate.ts`
- Modify: `src/lib/quests/generate.test.ts`
- Modify: `src/routes/api/quests/progress/+server.ts`

- [ ] **Step 1: Drop `xpReward` from quest templates**

Replace the full contents of `src/lib/quests/generate.ts`:

```ts
export interface QuestTemplate {
  id: string;
  description: string;
  target: number;
}

export const QUEST_TEMPLATES: QuestTemplate[] = [
  { id: 'review_cards', description: 'Review 10 cards today',              target: 10 },
  { id: 'new_cards',    description: 'Learn 5 new moves today',            target: 5 },
  { id: 'time_trial',   description: 'Score 8+ in Time Trial',             target: 8 },
  { id: 'sessions',     description: 'Complete 2 training sessions today', target: 2 },
];

/** Deterministic LCG shuffle seeded on date + playerId string */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    hash = ((hash * 1664525) + 1013904223) | 0;
    const j = Math.abs(hash) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Select 3 quests for the given date + player. Deterministic. */
export function selectDailyQuests(date: string, playerId: string): QuestTemplate[] {
  const seed = `${date}:${playerId}`;
  return seededShuffle(QUEST_TEMPLATES, seed).slice(0, 3);
}
```

- [ ] **Step 2: Update the test**

In `src/lib/quests/generate.test.ts`, change:

```ts
  it('each template has required fields', () => {
    for (const t of QUEST_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.target).toBeGreaterThan(0);
      expect(t.xpReward).toBeGreaterThan(0);
    }
  });
```

to:

```ts
  it('each template has required fields', () => {
    for (const t of QUEST_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.target).toBeGreaterThan(0);
    }
  });
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/quests/generate.test.ts`
Expected: PASS

- [ ] **Step 4: Drop the XP RPC calls from the quest-progress endpoint**

Replace the full contents of `src/routes/api/quests/progress/+server.ts`:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user: authUser } = await locals.safeGetSession();
  if (!authUser) throw error(401, 'Unauthorized');

  const body = await request.json();
  const { questId, increment = 1 } = body as { questId: string; increment?: number };

  const today = new Date().toISOString().slice(0, 10);

  const { data: quest } = await supabase
    .from('quests')
    .select('*')
    .eq('player_id', authUser.id)
    .eq('date', today)
    .eq('quest_id', questId)
    .single();

  if (!quest || quest.completed) {
    return json({ updated: false });
  }

  const newProgress = Math.min(quest.progress + increment, quest.target);
  const nowComplete = newProgress >= quest.target;

  const { error: updateErr } = await supabase
    .from('quests')
    .update({ progress: newProgress, completed: nowComplete })
    .eq('id', quest.id);

  if (updateErr) throw error(500, updateErr.message);

  return json({ updated: true, completed: nowComplete, progress: newProgress });
};
```

- [ ] **Step 5: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 6: Commit**

```bash
cd mychess
git add src/lib/quests/generate.ts src/lib/quests/generate.test.ts "src/routes/api/quests/progress/+server.ts"
git commit -m "feat: remove XP reward from quests"
```

---

### Task 14: Remove XP from the dashboard

**Files:**
- Modify: `src/routes/(player)/+page.server.ts`

**Depends on Task 13** (the quest-seeding insert below drops `xp_reward`).

- [ ] **Step 1: Drop `levelFromXp`, the leaderboard query, and XP stats fields**

In `src/routes/(player)/+page.server.ts`, change:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { levelFromXp } from '$lib/srs/xp';
import { selectDailyQuests } from '$lib/quests/generate';
```

to:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { selectDailyQuests } from '$lib/quests/generate';
```

Change:

```ts
  const p = profile as any;
  const totalXp = Number(p?.xp ?? 0);
  const streakDays = Number(p?.streak_days ?? 0);
  const { level, xpInLevel, xpToNextLevel } = levelFromXp(totalXp);
  const today = new Date().toISOString().slice(0, 10);
```

to:

```ts
  const p = profile as any;
  const streakDays = Number(p?.streak_days ?? 0);
  const today = new Date().toISOString().slice(0, 10);
```

Change:

```ts
  // Parallel fetches
  const [statsRes, questsRes, leaderboardRes, noteRes, lichessRatings, chesscomRatings, fideRes] = await Promise.all([
    supabase
      .from('player_stats')
      .select('total_reviews, total_correct, moves_learned, new_cards_today')
      .eq('player_id', user.id)
      .single(),
    supabase
      .from('quests')
      .select('*')
      .eq('player_id', user.id)
      .eq('date', today),
    supabase
      .from('weekly_leaderboard')
      .select('player_id, weekly_xp, rank')
      .order('rank', { ascending: true })
      .limit(10),
    supabase
      .from('coach_notes')
      .select('id, note, created_at')
      .eq('player_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null),
    chesscomUsername ? fetchChesscomRatings(chesscomUsername) : Promise.resolve(null),
```

to:

```ts
  // Parallel fetches
  const [statsRes, questsRes, noteRes, lichessRatings, chesscomRatings, fideRes] = await Promise.all([
    supabase
      .from('player_stats')
      .select('total_reviews, total_correct, moves_learned, new_cards_today')
      .eq('player_id', user.id)
      .single(),
    supabase
      .from('quests')
      .select('*')
      .eq('player_id', user.id)
      .eq('date', today),
    supabase
      .from('coach_notes')
      .select('id, note, created_at')
      .eq('player_id', user.id)
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    lichessUsername ? fetchLichessRatings(lichessUsername) : Promise.resolve(null),
    chesscomUsername ? fetchChesscomRatings(chesscomUsername) : Promise.resolve(null),
```

Change:

```ts
  // Seed quests if none exist for today
  let quests = questsRes.data ?? [];
  if (quests.length === 0) {
    const templates = selectDailyQuests(today, user.id);
    const rows = templates.map(t => ({
      player_id: user.id,
      date: today,
      quest_id: t.id,
      description: t.description,
      target: t.target,
      progress: 0,
      xp_reward: t.xpReward,
      completed: false
    }));
    const { data: inserted } = await supabase.from('quests').insert(rows).select();
    quests = inserted ?? [];
  }

  // Enrich leaderboard with display names
  const lbData = leaderboardRes.data ?? [];
  const playerIds = lbData.map((r: any) => r.player_id);
  let lbEntries: any[] = [];
  if (playerIds.length > 0) {
    const { data: names } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_id')
      .in('id', playerIds);
    const nameMap = new Map((names ?? []).map((n: any) => [n.id, n]));
    lbEntries = lbData.map((r: any) => ({
      rank: r.rank,
      player_name: nameMap.get(r.player_id)?.display_name ?? 'Player',
      avatar_id: nameMap.get(r.player_id)?.avatar_id ?? 'knight',
      weekly_xp: r.weekly_xp,
      is_current_user: r.player_id === user.id
    }));
  }

  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    chesscomUsername,
    chesscomRatings,
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
    upcomingTournaments: upcomingTournaments ?? [],
    fideLookup,
    fideQuery
  };
};
```

to:

```ts
  // Seed quests if none exist for today
  let quests = questsRes.data ?? [];
  if (quests.length === 0) {
    const templates = selectDailyQuests(today, user.id);
    const rows = templates.map(t => ({
      player_id: user.id,
      date: today,
      quest_id: t.id,
      description: t.description,
      target: t.target,
      progress: 0,
      completed: false
    }));
    const { data: inserted } = await supabase.from('quests').insert(rows).select();
    quests = inserted ?? [];
  }

  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    chesscomUsername,
    chesscomRatings,
    fideRatings,
    stats: {
      streak_days: streakDays,
      total_reviews: statsRes.data?.total_reviews ?? 0,
      new_cards_today: statsRes.data?.new_cards_today ?? 0
    },
    quests,
    unreadNote: noteRes.data ?? null,
    avatarId: p?.avatar_id ?? 'knight',
    upcomingTournaments: upcomingTournaments ?? [],
    fideLookup,
    fideQuery
  };
};
```

- [ ] **Step 2: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

Note: `src/routes/(player)/+page.svelte` never rendered `stats.level`/`total_xp`/`xp_in_level`/`xp_to_next` or `data.leaderboard` before this change (confirmed dead in the design spec's investigation), so no template edit is needed here — only the server load changes.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add "src/routes/(player)/+page.server.ts"
git commit -m "feat: remove XP and dead leaderboard data from the dashboard load"
```

---

### Task 15: Dashboard — mastered-repertoire count

**Files:**
- Modify: `src/routes/(player)/+page.server.ts`
- Modify: `src/routes/(player)/+page.svelte`

**Depends on Task 5** (`loadRepertoireProgressSummaries`) and Task 14 (this task builds on the just-cleaned-up load function).

- [ ] **Step 1: Add the computed stat to the server load**

In `src/routes/(player)/+page.server.ts`, change:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { selectDailyQuests } from '$lib/quests/generate';
import { fetchLichessRatings } from '$lib/server/lichess';
import { fetchChesscomRatings } from '$lib/server/chesscom';
```

to:

```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { selectDailyQuests } from '$lib/quests/generate';
import { fetchLichessRatings } from '$lib/server/lichess';
import { fetchChesscomRatings } from '$lib/server/chesscom';
import { loadRepertoireProgressSummaries } from '$lib/server/repertoire-progress';
```

Change:

```ts
  // Parallel fetches
  const [statsRes, questsRes, noteRes, lichessRatings, chesscomRatings, fideRes] = await Promise.all([
```

to:

```ts
  // Parallel fetches
  const [statsRes, questsRes, noteRes, lichessRatings, chesscomRatings, fideRes, repertoireSummaries] = await Promise.all([
```

Change (add the new promise as the last element of the same `Promise.all` array, right after the existing `fideRes` promise):

```ts
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
```

to:

```ts
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
      : Promise.resolve({ data: null, error: null }),
    loadRepertoireProgressSummaries(supabase, user.id)
  ]);
```

Change:

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
    stats: {
      streak_days: streakDays,
      total_reviews: statsRes.data?.total_reviews ?? 0,
      new_cards_today: statsRes.data?.new_cards_today ?? 0
    },
```

to:

```ts
  // A repertoire with no moves yet is vacuously "mastered" by
  // repertoireProgress's math — exclude it from both sides of this ratio, it
  // isn't meaningfully masterable yet.
  const masterableRepertoires = repertoireSummaries.filter((r) => r.totalVariations > 0);
  const masteredRepertoireCount = masterableRepertoires.filter((r) => r.level === 'mastered').length;

  return {
    isGuest,
    session,
    profile,
    lichessUsername,
    lichessRatings,
    chesscomUsername,
    chesscomRatings,
    fideRatings,
    stats: {
      streak_days: streakDays,
      total_reviews: statsRes.data?.total_reviews ?? 0,
      new_cards_today: statsRes.data?.new_cards_today ?? 0,
      mastered_repertoires: masteredRepertoireCount,
      total_masterable_repertoires: masterableRepertoires.length
    },
```

- [ ] **Step 2: Render the new stat**

In `src/routes/(player)/+page.svelte`, change:

```svelte
      <!-- Streak -->
      <StatsRow streakDays={stats.streak_days ?? 0} />
```

to:

```svelte
      <!-- Streak -->
      <StatsRow streakDays={stats.streak_days ?? 0} />

      {#if (stats.total_masterable_repertoires ?? 0) > 0}
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-3 text-center">
          <p class="text-xl font-bold text-amber-500">🏆 {stats.mastered_repertoires} / {stats.total_masterable_repertoires}</p>
          <p class="text-xs text-gray-400 mt-0.5">Repertoires mastered</p>
        </div>
      {/if}
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 4: Manual browser check**

Open the dashboard signed in as a player with at least one repertoire that has moves. Confirm a "🏆 X / Y Repertoires mastered" card appears near the streak card with correct counts, and that it's hidden entirely for a player with no masterable repertoires.

- [ ] **Step 5: Commit**

```bash
cd mychess
git add "src/routes/(player)/+page.server.ts" "src/routes/(player)/+page.svelte"
git commit -m "feat: show mastered-repertoire count on the dashboard"
```

---

### Task 16: Remove XP from badges

**Files:**
- Modify: `src/lib/badges/recalc.ts`
- Modify: `src/lib/badges/recalc.test.ts`
- Modify: `src/lib/badges/grant.ts`
- Modify: `src/lib/badges/grant.test.ts`
- Modify: `src/routes/(player)/badges/+page.svelte`

- [ ] **Step 1: Remove `level` and the three level badges from `recalc.ts`**

Replace the full contents of `src/lib/badges/recalc.ts`:

```ts
export interface BadgeStats {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  sessionCount: number;
  repertoireCount: number;
  ttBestScore: number;
  questsCompleted: number;
  hasUploaded: boolean;
  earnedIds: Set<string>;
}

interface BadgeRule {
  id: string;
  check: (s: BadgeStats) => boolean;
}

const RULES: BadgeRule[] = [
  // First-time
  { id: 'first_move',          check: s => s.totalReviews >= 1 },
  { id: 'first_repertoire',    check: s => s.repertoireCount >= 1 },
  { id: 'first_streak_3',      check: s => s.streakDays >= 3 },
  { id: 'first_time_trial',    check: s => s.ttBestScore >= 1 },
  // Streak
  { id: 'streak_7',            check: s => s.streakDays >= 7 },
  { id: 'streak_30',           check: s => s.streakDays >= 30 },
  { id: 'streak_100',          check: s => s.streakDays >= 100 },
  // streak_freeze_saved is granted manually only
  { id: 'streak_freeze_saved', check: _s => false },
  // Review volume
  { id: 'review_10',           check: s => s.totalReviews >= 10 },
  { id: 'review_100',          check: s => s.totalReviews >= 100 },
  { id: 'review_500',          check: s => s.totalReviews >= 500 },
  { id: 'review_1000',         check: s => s.totalReviews >= 1000 },
  // Mastery
  { id: 'moves_learned_10',    check: s => s.movesLearned >= 10 },
  { id: 'moves_learned_50',    check: s => s.movesLearned >= 50 },
  { id: 'moves_learned_100',   check: s => s.movesLearned >= 100 },
  // Time Trial
  { id: 'speed_demon',         check: s => s.ttBestScore >= 10 },
  { id: 'speed_legend',        check: s => s.ttBestScore >= 20 },
  // Sessions
  { id: 'sessions_10',         check: s => s.sessionCount >= 10 },
  { id: 'sessions_50',         check: s => s.sessionCount >= 50 },
  // Exploration
  { id: 'uploader',            check: s => s.hasUploaded },
  { id: 'multi_repertoire',    check: s => s.repertoireCount >= 2 },
  // Quests
  { id: 'quest_master',        check: s => s.questsCompleted >= 10 },
];

/** Returns badge IDs that should be granted (not already in earnedIds). */
export function checkBadgeEligibility(stats: BadgeStats): string[] {
  return RULES
    .filter(r => !stats.earnedIds.has(r.id) && r.check(stats))
    .map(r => r.id);
}
```

- [ ] **Step 2: Update `recalc.test.ts`**

In `src/lib/badges/recalc.test.ts`, change:

```ts
  const base = {
    totalReviews: 0,
    totalCorrect: 0,
    movesLearned: 0,
    streakDays: 0,
    level: 1,
    sessionCount: 0,
    repertoireCount: 0,
    ttBestScore: 0,
    questsCompleted: 0,
    hasUploaded: false,
    earnedIds: new Set<string>()
  };
```

to:

```ts
  const base = {
    totalReviews: 0,
    totalCorrect: 0,
    movesLearned: 0,
    streakDays: 0,
    sessionCount: 0,
    repertoireCount: 0,
    ttBestScore: 0,
    questsCompleted: 0,
    hasUploaded: false,
    earnedIds: new Set<string>()
  };
```

Remove this test entirely (the badge no longer exists):

```ts
  it('grants level_3 at level 3', () => {
    const result = checkBadgeEligibility({ ...base, level: 3 });
    expect(result).toContain('level_3');
  });
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/badges/recalc.test.ts`
Expected: PASS

- [ ] **Step 4: Remove `level`/`xp` from `grant.ts`**

Replace the full contents of `src/lib/badges/grant.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BadgeStats } from './recalc';
import { checkBadgeEligibility } from './recalc';

export interface BadgeStatsInput {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  sessionCount: number;
  repertoireCount: number;
  ttBestScore: number;
  questsCompleted: number;
  hasUploaded: boolean;
  earnedIds: Set<string>;
}

/** Identity helper — lets tests verify the mapping without mocking Supabase. */
export function buildBadgeStats(input: BadgeStatsInput): BadgeStats {
  return input;
}

/**
 * Collect stats from DB, run eligibility check, insert new badges.
 * Returns the IDs of newly granted badges (empty if none).
 */
export async function grantNewBadges(
  supabase: SupabaseClient,
  playerId: string,
  overrides: Partial<BadgeStatsInput> = {}
): Promise<string[]> {
  const [profileRes, playerStatsRes, sessionRes, repRes, questRes, earnedRes] =
    await Promise.all([
      supabase.from('profiles').select('streak_days').eq('id', playerId).single(),
      supabase.from('player_stats').select('total_reviews, total_correct, moves_learned').eq('player_id', playerId).single(),
      supabase.from('sessions').select('id, mode').eq('player_id', playerId),
      supabase.from('repertoires').select('id').eq('player_id', playerId),
      supabase.from('quests').select('id').eq('player_id', playerId).eq('completed', true),
      supabase.from('badges_earned').select('badge_id').eq('player_id', playerId)
    ]);

  const p = profileRes.data;
  const ks = playerStatsRes.data;
  const sessions = sessionRes.data ?? [];

  const earnedIds = new Set((earnedRes.data ?? []).map((r: any) => r.badge_id as string));

  const stats: BadgeStats = buildBadgeStats({
    totalReviews: ks?.total_reviews ?? 0,
    totalCorrect: ks?.total_correct ?? 0,
    movesLearned: ks?.moves_learned ?? 0,
    streakDays: p?.streak_days ?? 0,
    sessionCount: sessions.length,
    repertoireCount: (repRes.data ?? []).length,
    ttBestScore: 0,
    questsCompleted: (questRes.data ?? []).length,
    hasUploaded: (repRes.data ?? []).length > 0,
    earnedIds,
    ...overrides
  });

  const newBadgeIds = checkBadgeEligibility(stats);
  if (newBadgeIds.length === 0) return [];

  const rows = newBadgeIds.map(id => ({ player_id: playerId, badge_id: id }));
  await supabase.from('badges_earned').insert(rows);

  return newBadgeIds;
}
```

- [ ] **Step 5: Update `grant.test.ts`**

In `src/lib/badges/grant.test.ts`, change:

```ts
  it('maps DB rows to BadgeStats correctly', () => {
    const stats = buildBadgeStats({
      totalReviews: 10,
      totalCorrect: 8,
      movesLearned: 5,
      streakDays: 3,
      level: 2,
      sessionCount: 4,
      repertoireCount: 1,
      ttBestScore: 0,
      questsCompleted: 0,
      hasUploaded: true,
      earnedIds: new Set(['first_move'])
    });
    expect(stats.totalReviews).toBe(10);
    expect(stats.hasUploaded).toBe(true);
    expect(stats.earnedIds.has('first_move')).toBe(true);
  });

  it('handles zero values without throwing', () => {
    const stats = buildBadgeStats({
      totalReviews: 0,
      totalCorrect: 0,
      movesLearned: 0,
      streakDays: 0,
      level: 1,
      sessionCount: 0,
      repertoireCount: 0,
      ttBestScore: 0,
      questsCompleted: 0,
      hasUploaded: false,
      earnedIds: new Set()
    });
    expect(stats.level).toBe(1);
  });
```

to:

```ts
  it('maps DB rows to BadgeStats correctly', () => {
    const stats = buildBadgeStats({
      totalReviews: 10,
      totalCorrect: 8,
      movesLearned: 5,
      streakDays: 3,
      sessionCount: 4,
      repertoireCount: 1,
      ttBestScore: 0,
      questsCompleted: 0,
      hasUploaded: true,
      earnedIds: new Set(['first_move'])
    });
    expect(stats.totalReviews).toBe(10);
    expect(stats.hasUploaded).toBe(true);
    expect(stats.earnedIds.has('first_move')).toBe(true);
  });

  it('handles zero values without throwing', () => {
    const stats = buildBadgeStats({
      totalReviews: 0,
      totalCorrect: 0,
      movesLearned: 0,
      streakDays: 0,
      sessionCount: 0,
      repertoireCount: 0,
      ttBestScore: 0,
      questsCompleted: 0,
      hasUploaded: false,
      earnedIds: new Set()
    });
    expect(stats.streakDays).toBe(0);
  });
```

- [ ] **Step 6: Remove the XP-reward display from the badges page**

In `src/routes/(player)/badges/+page.svelte`, change:

```svelte
          <div class="text-3xl mb-1">{badge.earned ? '🏅' : '🔒'}</div>
          <p class="text-xs font-bold leading-tight text-gray-800">{badge.name}</p>
          <p class="text-xs text-gray-500 mt-0.5 leading-tight">{badge.description}</p>
          {#if badge.earned}
            <p class="text-xs text-indigo-600 font-bold mt-1">+{badge.xp_reward} XP</p>
          {/if}
```

to:

```svelte
          <div class="text-3xl mb-1">{badge.earned ? '🏅' : '🔒'}</div>
          <p class="text-xs font-bold leading-tight text-gray-800">{badge.name}</p>
          <p class="text-xs text-gray-500 mt-0.5 leading-tight">{badge.description}</p>
```

- [ ] **Step 7: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 8: Commit**

```bash
cd mychess
git add src/lib/badges/recalc.ts src/lib/badges/recalc.test.ts src/lib/badges/grant.ts src/lib/badges/grant.test.ts "src/routes/(player)/badges/+page.svelte"
git commit -m "feat: retire XP-gated badges and remove XP reward display"
```

---

### Task 17: Remove XP from the coach player-detail page

**Files:**
- Modify: `src/routes/(coach)/coach/players/[player_id]/+page.server.ts`
- Modify: `src/routes/(coach)/coach/players/[player_id]/+page.svelte`

- [ ] **Step 1: Drop `levelFromXp`/`weekly_xp_goal` and the dead `setGoal` action**

Replace the full contents of `src/routes/(coach)/coach/players/[player_id]/+page.server.ts`:

```ts
import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const [playerRes, statsRes, notesRes, coachRepsRes, assignedRes] = await Promise.all([
    supabase.from('profiles').select('id, display_name').eq('id', params.player_id).single(),
    supabase.from('player_stats').select('*').eq('player_id', params.player_id).single(),
    supabase.from('coach_notes').select('id, note, created_at').eq('player_id', params.player_id).order('created_at', { ascending: false }).limit(5),
    supabase.from('repertoires').select('id, name, color').eq('player_id', user.id),
    supabase
      .from('assigned_repertoires')
      .select('id, repertoire:repertoire_id(id, name, color)')
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id)
  ]);

  return {
    player: playerRes.data,
    stats: statsRes.data,
    notes: notesRes.data ?? [],
    coachReps: coachRepsRes.data ?? [],
    assignedReps: assignedRes.data ?? [],
    playerId: params.player_id
  };
};

export const actions: Actions = {
  addNote: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const note = ((fd.get('note') as string) ?? '').trim();
    if (!note) return fail(400, { error: 'Note cannot be empty' });

    const { error } = await supabase
      .from('coach_notes')
      .insert({ player_id: params.player_id, coach_id: user.id, note });

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  assignRep: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    const { error } = await supabase
      .from('assigned_repertoires')
      .upsert(
        { player_id: params.player_id, coach_id: user.id, repertoire_id: repId },
        { onConflict: 'player_id,repertoire_id' }
      );

    if (error) return fail(500, { error: error.message });
    return { success: true };
  },

  unassignRep: async ({ params, request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Unauthorized' });

    const fd = await request.formData();
    const repId = fd.get('rep_id') as string;
    if (!repId) return fail(400, { error: 'No repertoire selected' });

    const { error } = await supabase
      .from('assigned_repertoires')
      .delete()
      .eq('coach_id', user.id)
      .eq('player_id', params.player_id)
      .eq('repertoire_id', repId);

    if (error) return fail(500, { error: error.message });
    return { success: true };
  }
};
```

(The `setGoal` action is removed entirely — it wrote `profiles.weekly_xp_goal`, and no template in this file rendered a form for it, so it was already dead code.)

- [ ] **Step 2: Remove the "Level" stat card**

In `src/routes/(coach)/coach/players/[player_id]/+page.svelte`, change:

```svelte
      <div class="grid grid-cols-3 gap-4 text-center">
        <div>
          <p class="text-2xl font-bold text-indigo-600">{data.stats?.level ?? 0}</p>
          <p class="text-xs text-gray-400">Level</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-gray-900">{data.stats?.total_reviews ?? 0}</p>
          <p class="text-xs text-gray-400">Reviews</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-gray-900">{data.stats?.moves_learned ?? 0}</p>
          <p class="text-xs text-gray-400">Moves learned</p>
        </div>
      </div>
```

to:

```svelte
      <div class="grid grid-cols-2 gap-4 text-center">
        <div>
          <p class="text-2xl font-bold text-gray-900">{data.stats?.total_reviews ?? 0}</p>
          <p class="text-xs text-gray-400">Reviews</p>
        </div>
        <div>
          <p class="text-2xl font-bold text-gray-900">{data.stats?.moves_learned ?? 0}</p>
          <p class="text-xs text-gray-400">Moves learned</p>
        </div>
      </div>
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass; `svelte-check` error count unchanged from baseline.

- [ ] **Step 4: Commit**

```bash
cd mychess
git add "src/routes/(coach)/coach/players/[player_id]/+page.server.ts" "src/routes/(coach)/coach/players/[player_id]/+page.svelte"
git commit -m "feat: remove XP/level display from the coach player-detail page"
```

---

### Task 18: Delete dead XP-only files

**Files:**
- Delete: `src/lib/srs/xp.ts`
- Delete: `src/lib/srs/xp.test.ts`
- Delete: `src/lib/components/XpBar.svelte`
- Delete: `src/lib/components/LeaderboardPodium.svelte`

**Depends on Tasks 10-15** (every caller of `xpForReview`/`levelFromXp` must be gone first).

- [ ] **Step 1: Confirm nothing still imports these**

Run: `cd mychess && grep -rn "srs/xp\|XpBar\|LeaderboardPodium" src/ --include="*.ts" --include="*.svelte"`
Expected: no matches (only the files' own definitions, which are about to be deleted — if this command finds any *other* file, stop and fix that reference before deleting).

- [ ] **Step 2: Delete the files**

```bash
cd mychess
rm src/lib/srs/xp.ts src/lib/srs/xp.test.ts
rm src/lib/components/XpBar.svelte
rm src/lib/components/LeaderboardPodium.svelte
```

- [ ] **Step 3: Run the full test suite and type-check**

Run: `cd mychess && npx vitest run && npm run check`
Expected: all tests pass (with `xp.test.ts`'s tests now gone — total count will be lower than before this task, that's expected); `svelte-check` error count unchanged from baseline.

- [ ] **Step 4: Commit**

```bash
cd mychess
git add -A
git commit -m "feat: delete dead XP module, XpBar, and LeaderboardPodium"
```

---

### Task 19: Database migration for XP removal

**Files:**
- Create: `supabase/migrations/0027_remove_xp.sql`

**Depends on Task 18** and every prior XP-removal task — the app must no longer read/write any column this migration drops before it's safe to apply.

- [ ] **Step 1: Grep for any other reference to the columns/functions being dropped**

Run: `cd mychess && grep -rln "profiles\.xp\b\|profiles\.level\b\|weekly_xp_goal\|xp_earned\|xp_delta\|xp_reward\|total_xp\|update_xp_and_level\|update_weekly_leaderboard\|submit_session_result\|sync_player_stats" supabase/migrations/*.sql`
Expected: matches only in already-superseded migrations (`0001`, `0003`, `0005`, `0019`) — confirms no migration this plan hasn't accounted for still depends on these. If a new match turns up beyond what Tasks 10-18 already handled, resolve it before writing the migration below (this repo's migration history is known to drift from the live schema — see `mychess/CLAUDE.md` — so treat this as a check, not a formality).

- [ ] **Step 2: Write the migration**

```sql
-- mychess/supabase/migrations/0027_remove_xp.sql
-- Drop XP-dependent functions first (no live callers remain once
-- Practice/Drill/Time Trial/quests stop calling them; submit_session_result
-- and sync_player_stats were already dead — only ever defined, never called
-- from application code).
drop function if exists public.update_xp_and_level(uuid, integer);
drop function if exists public.update_weekly_leaderboard(uuid, integer);
drop function if exists public.submit_session_result(uuid, jsonb);
drop function if exists public.sync_player_stats(uuid);

drop table if exists public.weekly_leaderboard;

alter table public.profiles
  drop column if exists xp,
  drop column if exists level,
  drop column if exists weekly_xp_goal;

alter table public.sessions drop column if exists xp_earned;
alter table public.review_events drop column if exists xp_delta;
alter table public.badges drop column if exists xp_reward;
alter table public.quests drop column if exists xp_reward;
alter table public.player_stats drop column if exists total_xp;
```

- [ ] **Step 3: Commit**

```bash
cd mychess
git add supabase/migrations/0027_remove_xp.sql
git commit -m "feat: add migration dropping XP columns, tables, and RPCs"
```

- [ ] **Step 4: Ask the user to apply it**

Paste the migration's SQL into the Supabase dashboard SQL editor and run it — this repo has no local Postgres or working service-role key, so migrations are always applied manually (see `mychess/CLAUDE.md`). The application code no longer reads or writes any of these columns/functions as of Task 18, so it will keep working before this migration is applied — but apply it before considering this feature fully done, since leftover unused columns/RPCs are exactly the kind of drift `mychess/CLAUDE.md` warns about.

---

### Task 20: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd mychess && npx vitest run`
Expected: all tests pass, 0 failures.

- [ ] **Step 2: Run the type-check**

Run: `cd mychess && npm run check`
Expected: error count unchanged from the pre-existing 12-error baseline (all in `src/routes/auth/**`), no new errors, no leftover reference to any deleted module.

- [ ] **Step 3: Grep for any remaining XP references in application code**

Run: `cd mychess && grep -rniE "\bxp\b|xpAwarded|xpReward|xpFor|levelFromXp" src/ --include="*.ts" --include="*.svelte"`
Expected: no matches. (If anything turns up, it's a leftover from Tasks 10-18 that needs fixing before this feature is done.)

- [ ] **Step 4: Manual browser walkthrough**

Confirm end-to-end:
- `/practice` picker shows "Level X of Y · Tag · A/B solved" (or "🏆 Mastered · Tag") for each repertoire, no XP anywhere.
- Opening a partially-progressed repertoire shows the level list with correct passed/current/locked states; clicking a passed level enters review mode (banner + read-only quiz); "Exit review" returns to normal training.
- A fully mastered repertoire's level list still allows reviewing any level.
- Drill and Time Trial play through fully with no XP display, but chain/correct-count/streak still work.
- The dashboard shows the new "🏆 X / Y Repertoires mastered" card (or hides it if the player has no masterable repertoires) and no leaderboard/XP bar.
- `/badges` shows no "+X XP" text on earned badges, and `level_3`/`level_5`/`level_10` are absent from the grid.
- A coach's player-detail page shows Reviews/Moves learned (no Level card) and has no weekly-XP-goal form.

- [ ] **Step 5: Remind the user about the pending migration**

If Task 19's migration hasn't been confirmed as applied yet, remind the user to run `supabase/migrations/0027_remove_xp.sql` via the Supabase SQL editor.
