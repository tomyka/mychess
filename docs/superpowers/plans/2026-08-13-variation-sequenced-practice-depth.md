# Variation-Sequenced Practice Depth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Practice mode stops advancing every variation in a repertoire together (breadth-first, fixed `MOVES_PER_LEVEL = 3`). Instead: (1) the moves-per-level chunk size becomes a configurable per-repertoire setting, and (2) `level_progress` tracks ONE active variation at a time — that variation's own levels progress exactly as today (queue, demotion, review, maintenance), and once it's mastered, the next not-yet-practiced variation (in `enumerateVariations()`'s own order) becomes active at a fresh Level 1.

**Architecture:** Deliberately surgical. `levels.ts` and `levelProgress.ts` keep every existing function, test, and behavior (queue/FIFO, 3-strikes demotion, maintenance review, optimistic-concurrency writes) — they're generic over "whatever variations array you hand them" and never assumed breadth-first. The only structural addition is a new pure module, `variationSequence.ts`, that decides *which* one-element `[variation]` slice gets passed into that existing machinery, and advances to the next slice on mastery. `chunk_size` replaces the hardcoded `MOVES_PER_LEVEL` constant as an explicit parameter threaded through every function that used it.

**Deliberate side effect, not a regression:** `alternativesAt`'s cross-variation "accept a sibling's branch and keep going" behavior is fed by the full repertoire's variations today. Once every call site only ever passes `[activeVariation]` (a one-element array), `alternativesAt` naturally has nothing left to compare against and always returns `[]` — branch-alternative acceptance goes inert without any code deleted. This is intentional: sequential, one-variation-at-a-time drilling means a move into a sibling variation should be rejected, not silently followed, while that sibling isn't the one being mastered right now. `continueFromBranch` and `/api/practice/continue` become unreachable dead code as a result — flagged in Task 10 for a follow-up removal, not deleted in this plan (small, safe diff now; removal is a separate, non-urgent cleanup).

**Explicitly out of scope (separate follow-up plan):** the UI. `+page.svelte`'s "Level X of Y" / `LevelList` / practice-depth-edit control keep working exactly as before (now describing the *active variation's* own levels, which is strictly more correct than today, not broken) — but showing "Variation 3 of 12", exposing the new configurable chunk size in the UI, and any Chessbook-style teach/test-pass redesign from the PRD are follow-up work, not this plan.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Supabase (Postgres + RLS), Vitest, all within the existing `mychess/` app (working directory for every command below).

**PRD:** `docs/superpowers/specs/2026-08-13-mastery-per-variation-practice-redesign-prd.md`
**GitHub issue:** [tomyka/mychess#60](https://github.com/tomyka/mychess/issues/60)

All file paths below are relative to `mychess/` (the SvelteKit app directory — one level below the repo root).

---

### Task 1: Migration — `chunk_size` and `active_variation_key`

**Files:**
- Create: `supabase/migrations/0044_practice_chunk_and_active_variation.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- mychess/supabase/migrations/0044_practice_chunk_and_active_variation.sql
-- Two changes enabling sequential, one-variation-at-a-time Practice instead
-- of the breadth-first "every variation advances together" model:
--
-- 1. chunk_size: how many of the player's own moves make up one level
--    (replaces the hardcoded MOVES_PER_LEVEL=3 constant in
--    src/lib/mastery/levels.ts) — configurable per repertoire so a player
--    can shrink it for a repertoire with very long lines instead of being
--    stuck chaining large chunks of moves at once to advance.
-- 2. active_variation_key: which ONE variation level_progress.level/queue
--    currently track. Nullable — null means "not yet decided," resolved to
--    the first variation in enumerateVariations()'s own order (see
--    pickActiveVariation in src/lib/mastery/variationSequence.ts).
alter table public.repertoires
  add column chunk_size integer not null default 3
    check (chunk_size > 0);

alter table public.level_progress
  add column active_variation_key text;

-- Existing progress was computed breadth-first across every variation at
-- once — it doesn't correspond to "how far into ONE variation" under the
-- new sequential model, and reconciling it in place could show a
-- never-before-practiced variation's LATER levels as already in progress.
-- Reset to a fresh Level 1 run; loadSyncedLevelProgress picks the first
-- variation and builds it a proper queue on next load. No other users yet
-- (see CLAUDE.md) — nothing of value is lost.
update public.level_progress
  set level = 1, prev_level_mistakes = 0, queue = '[]'::jsonb, active_variation_key = null;
```

- [ ] **Step 2: Hand off to the user**

Per this repo's convention (`CLAUDE.md` — no local Postgres/service-role key available), paste the file's contents to the user and ask them to run it in the Supabase dashboard SQL editor before continuing. Do not proceed to rely on either column existing until they confirm.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0044_practice_chunk_and_active_variation.sql
git commit -m "feat: add chunk_size and active_variation_key columns"
```

---

### Task 2: `levels.ts` — make chunk size a parameter

**Files:**
- Modify: `src/lib/mastery/levels.ts`
- Modify: `src/lib/mastery/levels.test.ts`

- [ ] **Step 1: Update the failing tests first**

Replace `src/lib/mastery/levels.test.ts` in full:

```ts
// mychess/src/lib/mastery/levels.test.ts
import { describe, it, expect } from 'vitest';
import { levelDepth, targetDepth, taskKey, levelTaskVariations, levelCap } from './levels';

function variation(playerMoveCount: number, prefix: string) {
	const path: { moveId: string; isPlayerTurn: boolean }[] = [];
	for (let i = 1; i <= playerMoveCount; i++) {
		path.push({ moveId: `${prefix}p${i}`, isPlayerTurn: true });
		path.push({ moveId: `${prefix}o${i}`, isPlayerTurn: false });
	}
	return { playerMoveCount, path };
}

describe('levelDepth', () => {
	it('is chunkSize-many moves per level, with no fixed ceiling', () => {
		expect(levelDepth(1, 3)).toBe(3);
		expect(levelDepth(2, 3)).toBe(6);
		expect(levelDepth(3, 3)).toBe(9);
		expect(levelDepth(10, 3)).toBe(30);
	});

	it('uses whatever chunkSize is passed, not a fixed constant', () => {
		expect(levelDepth(1, 5)).toBe(5);
		expect(levelDepth(2, 5)).toBe(10);
		expect(levelDepth(4, 1)).toBe(4);
	});
});

describe('targetDepth', () => {
	it('is the level depth when the variation is longer', () => {
		expect(targetDepth({ playerMoveCount: 12 }, 2, 3)).toBe(6);
	});

	it("is the variation's own length when shorter than the level depth", () => {
		expect(targetDepth({ playerMoveCount: 2 }, 2, 3)).toBe(2);
	});

	it('respects a smaller configured chunkSize', () => {
		expect(targetDepth({ playerMoveCount: 12 }, 2, 1)).toBe(2);
	});
});

describe('taskKey', () => {
	it('is the move id the target-depth prefix ends on', () => {
		const v = variation(4, 'v1-');
		expect(taskKey(v, 1, 3)).toBe('v1-p3'); // depth 3 -> ends on the 3rd player move
		expect(taskKey(v, 2, 3)).toBe('v1-p4'); // depth 6, capped at the variation's own 4th move
	});

	it("falls back to the variation's own last move once its length caps the target", () => {
		const v = variation(2, 'short-');
		expect(taskKey(v, 5, 3)).toBe('short-p2');
	});

	it('uses the configured chunkSize, not a fixed 3', () => {
		const v = variation(4, 'v2-');
		expect(taskKey(v, 1, 1)).toBe('v2-p1'); // chunkSize 1 -> depth 1
		expect(taskKey(v, 2, 1)).toBe('v2-p2');
	});
});

describe('levelTaskVariations', () => {
	it('drops a variation once a strictly earlier level already fully covers it', () => {
		const short = variation(2, 'short-'); // fully covered by level 1 (depth 3)
		const long = variation(6, 'long-');
		expect(levelTaskVariations([short, long], 1, 3).map((v) => v.playerMoveCount)).toEqual([2, 6]);
		expect(levelTaskVariations([short, long], 2, 3)).toEqual([long]);
	});

	it('counts a variation exactly at a level boundary as ending there, not continuing', () => {
		const exact = variation(3, 'exact-'); // ends precisely at level 1's depth
		expect(levelTaskVariations([exact], 1, 3)).toEqual([exact]);
		expect(levelTaskVariations([exact], 2, 3)).toEqual([]); // nothing left at level 2
	});

	it('collapses variations sharing an identical prefix at this level into one task', () => {
		// Both lines play the identical first 3 player moves (all of level 1's
		// depth) and only diverge on their 4th — same underlying moves up to
		// level 1's target depth.
		const shared: { moveId: string; isPlayerTurn: boolean }[] = [];
		for (let i = 1; i <= 3; i++) {
			shared.push({ moveId: `s-p${i}`, isPlayerTurn: true });
			shared.push({ moveId: `s-o${i}`, isPlayerTurn: false });
		}
		const a = { playerMoveCount: 4, path: [...shared, { moveId: 'a-p4', isPlayerTurn: true }] };
		const b = { playerMoveCount: 4, path: [...shared, { moveId: 'b-p4', isPlayerTurn: true }] };
		expect(levelTaskVariations([a, b], 1, 3).length).toBe(1); // identical through level 1's depth (3)
		expect(levelTaskVariations([a, b], 2, 3).length).toBe(2); // diverge at move 4, level 2's depth
	});

	it("does not collapse variations that already differ within this level's own depth", () => {
		const a = variation(3, 'a-');
		const b = variation(3, 'b-');
		expect(levelTaskVariations([a, b], 1, 3).length).toBe(2);
	});
});

describe('levelCap', () => {
	it('is 0 for an empty variation list', () => {
		expect(levelCap([], 3)).toBe(0);
	});

	it('rounds up to the nearest chunk covering the longest variation', () => {
		expect(levelCap([variation(4, 'a-')], 3)).toBe(2); // ceil(4/3) = 2
		expect(levelCap([variation(9, 'b-')], 3)).toBe(3); // ceil(9/3) = 3
	});

	it('is driven by the longest variation among several', () => {
		expect(levelCap([variation(2, 'short-'), variation(7, 'long-')], 3)).toBe(3); // ceil(7/3) = 3
	});

	it('shrinks as chunkSize shrinks', () => {
		expect(levelCap([variation(4, 'a-')], 1)).toBe(4); // ceil(4/1) = 4
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mastery/levels.test.ts`
Expected: FAIL — every exported function still takes only its old parameters; the new `chunkSize` argument doesn't type-check.

- [ ] **Step 3: Implement**

Replace `src/lib/mastery/levels.ts` in full:

```ts
// mychess/src/lib/mastery/levels.ts
/**
 * Levels are uniform chunks of a configurable size (see `repertoires.chunk_size`,
 * threaded through every function here as `chunkSize`) with no fixed ceiling:
 * L*n* covers the player's own moves 1 through *n* * chunkSize.
 */
export type Level = number;

type VariationLike = {
	playerMoveCount: number;
	path: { moveId: string; isPlayerTurn: boolean }[];
};

export function levelDepth(level: Level, chunkSize: number): number {
	return level * chunkSize;
}

/** The depth this variation must reach at this level — capped by its own natural length. */
export function targetDepth(variation: { playerMoveCount: number }, level: Level, chunkSize: number): number {
	return Math.min(variation.playerMoveCount, levelDepth(level, chunkSize));
}

/** Whether `variation` still has any content left to ask at `level` (i.e. a strictly earlier level hasn't already fully covered it). */
export function hasContentAtLevel(variation: { playerMoveCount: number }, level: Level, chunkSize: number): boolean {
	return variation.playerMoveCount > levelDepth(level - 1, chunkSize);
}

/**
 * The move a variation's target-depth prefix ends on, at `level` — the
 * stable identity of the "task" a level presents. The moves table is a
 * shared tree, so two variations that reach the same move id here have an
 * identical path up to this depth: solving one solves both.
 */
export function taskKey(variation: VariationLike, level: Level, chunkSize: number): string {
	const target = targetDepth(variation, level, chunkSize);
	let playerMovesSeen = 0;
	for (const step of variation.path) {
		if (!step.isPlayerTurn) continue;
		playerMovesSeen++;
		if (playerMovesSeen === target) return step.moveId;
	}
	return variation.path.at(-1)?.moveId ?? '';
}

/**
 * The distinct tasks that exist at `level`: variations with content
 * remaining there (a variation a strictly earlier level already fully
 * covers drops out), deduplicated by `taskKey` — two variations identical
 * up to this level's depth are the same task, since solving one solves both.
 */
export function levelTaskVariations(variations: VariationLike[], level: Level, chunkSize: number): VariationLike[] {
	const relevant = variations.filter((v) => hasContentAtLevel(v, level, chunkSize));
	const seen = new Map<string, VariationLike>();
	for (const v of relevant) {
		const key = taskKey(v, level, chunkSize);
		if (!seen.has(key)) seen.set(key, v);
	}
	return [...seen.values()];
}

function maxPlayerMoveCount(variations: VariationLike[]): number {
	return variations.reduce((max, v) => Math.max(max, v.playerMoveCount), 0);
}

/**
 * The number of levels a repertoire has: the level whose depth first covers
 * every variation's full length. 0 for an empty variation list (nothing to
 * level).
 */
export function levelCap(variations: VariationLike[], chunkSize: number): number {
	return Math.ceil(maxPlayerMoveCount(variations) / chunkSize);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/levels.test.ts`
Expected: PASS (all tests)

Do NOT run the full suite yet — `levelProgress.test.ts` and `practice.test.ts` still call these functions with their OLD (pre-chunkSize) argument counts, so `chunkSize` arrives as `undefined` inside them and every depth computation silently becomes `NaN`. That's expected breakage, fixed by Task 3 (`levelProgress.test.ts`) and Task 5 (`practice.test.ts`), not a regression to chase down now.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/levels.ts src/lib/mastery/levels.test.ts
git commit -m "feat: make levels.ts chunk size a parameter instead of a fixed constant"
```

---

### Task 3: `levelProgress.ts` — thread `chunkSize`, add `activeVariationKey`

**Files:**
- Modify: `src/lib/mastery/levelProgress.ts`
- Modify: `src/lib/mastery/levelProgress.test.ts`

**Note:** this task comes before the new `variationSequence.ts` module (Task 4) even though it was designed second — `variationSequence.ts`'s `advanceVariationIfMastered` calls `buildQueue`/`effectiveLevelCap` with the NEW `chunkSize` argument, so those two functions must already accept it before that module can work. Doing it in the other order would make Task 4's own tests throw (`chunkSize`, a number, would land in `buildQueue`'s old `random` parameter slot and get called as a function).

- [ ] **Step 1: Update the type and every function signature**

In `src/lib/mastery/levelProgress.ts`:

```ts
import type { Variation } from './variations';
import { levelCap, levelTaskVariations, taskKey, type Level } from './levels';

export type QueueEntry = { key: string; status: 'pending' | 'cleared' };
export type LevelProgressRow = {
	level: number;
	prevLevelMistakes: number;
	queue: QueueEntry[];
	// Which ONE variation level/queue currently track — see
	// src/lib/mastery/variationSequence.ts (Task 4). Optional (not required) so
	// the many pre-existing test fixtures across this file and practice.test.ts
	// that hand-construct rows without caring about sequencing don't all need
	// updating — an omitted value is treated identically to `null`
	// (`pickActiveVariation` falls back to the first variation) everywhere
	// it's read.
	activeVariationKey?: string | null;
};
```

Update `repertoireShape` and `effectiveLevelCap` to take `chunkSize`:

```ts
export function repertoireShape(variations: Variation[], chunkSize: number): RepertoireShape {
	return {
		totalVariations: variations.length,
		totalLevels: levelCap(variations, chunkSize),
		level1TaskCount: levelTaskVariations(variations, 1, chunkSize).length
	};
}

export function effectiveLevelCap(variations: Variation[], maxLevel: number, chunkSize: number): number {
	return Math.min(levelCap(variations, chunkSize), maxLevel);
}
```

Update `buildQueue` and `reconcileQueue`:

```ts
export function buildQueue(
	variations: Variation[],
	level: Level,
	chunkSize: number,
	random: () => number = Math.random
): QueueEntry[] {
	const keys = levelTaskVariations(variations, level, chunkSize).map((v) => taskKey(v, level, chunkSize));
	for (let i = keys.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[keys[i], keys[j]] = [keys[j], keys[i]];
	}
	return keys.map((key) => ({ key, status: 'pending' as const }));
}

export function reconcileQueue(queue: QueueEntry[], variations: Variation[], level: Level, chunkSize: number): QueueEntry[] {
	const freshKeys = new Set(levelTaskVariations(variations, level, chunkSize).map((v) => taskKey(v, level, chunkSize)));
	const kept = queue.filter((entry) => freshKeys.has(entry.key));
	const keptKeys = new Set(kept.map((entry) => entry.key));
	const added = [...freshKeys]
		.filter((key) => !keptKeys.has(key))
		.map((key) => ({ key, status: 'pending' as const }));
	return [...kept, ...added];
}
```

Update the internal `advanceIfCleared` and the three exported functions that call it:

```ts
function advanceIfCleared(
	row: LevelProgressRow,
	variations: Variation[],
	cap: number,
	chunkSize: number,
	random: () => number
): LevelProgressRow {
	if (!isFullyCleared(row.queue)) return row;
	const nextLevel = row.level + 1;
	if (nextLevel > cap) return { ...row, level: nextLevel, prevLevelMistakes: 0 };
	return { level: nextLevel, prevLevelMistakes: 0, queue: buildQueue(variations, nextLevel, chunkSize, random) };
}

export function syncLevelProgress(
	row: LevelProgressRow,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number,
	random: () => number = Math.random
): LevelProgressRow {
	const cap = effectiveLevelCap(variations, maxLevel, chunkSize);
	if (row.level > cap) return row; // already mastered — nothing to reconcile
	const reconciled = { ...row, queue: reconcileQueue(row.queue, variations, row.level, chunkSize) };
	return advanceIfCleared(reconciled, variations, cap, chunkSize, random);
}

export function resolveAttempt(
	row: LevelProgressRow,
	result: AttemptResult,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number,
	random: () => number = Math.random
): LevelProgressRow {
	const cap = effectiveLevelCap(variations, maxLevel, chunkSize);
	if (row.level > cap) return row; // already mastered — a stale/replayed report is a no-op
	if (!row.queue.some((entry) => entry.key === result.taskKey)) return row; // stale/unrecognized task — no-op

	const queue = row.queue.map((entry) =>
		entry.key === result.taskKey && !result.hadMistake ? { ...entry, status: 'cleared' as const } : entry
	);
	let reordered = result.hadMistake
		? [...queue.filter((e) => e.key !== result.taskKey), queue.find((e) => e.key === result.taskKey)!]
		: queue;

	if (result.abandonedTaskKey && result.abandonedTaskKey !== result.taskKey) {
		const abandoned = reordered.find((e) => e.key === result.abandonedTaskKey && e.status === 'pending');
		if (abandoned) reordered = [...reordered.filter((e) => e !== abandoned), abandoned];
	}

	return advanceIfCleared({ ...row, queue: reordered }, variations, cap, chunkSize, random);
}

export function resolvePreviousLevelMistake(
	row: LevelProgressRow,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number,
	random: () => number = Math.random
): MistakeOutcome {
	const cap = effectiveLevelCap(variations, maxLevel, chunkSize);
	if (row.level > cap || row.level <= 1) return { row, demoted: false };

	const prevLevelMistakes = row.prevLevelMistakes + 1;
	if (prevLevelMistakes >= DEMOTION_THRESHOLD) {
		const demotedLevel = row.level - 1;
		return {
			row: { level: demotedLevel, prevLevelMistakes: 0, queue: buildQueue(variations, demotedLevel, chunkSize, random) },
			demoted: true
		};
	}

	return { row: { ...row, prevLevelMistakes }, demoted: false };
}
```

Update `repertoireProgress` (the one caller of `repertoireShape` that takes raw variations) — `repertoireProgressFromShape` itself needs NO change, since it only ever consumes an already-computed shape plus a row:

```ts
export function repertoireProgress(
	variations: Variation[],
	row: LevelProgressRow | null,
	maxLevel: number,
	chunkSize: number
): RepertoireProgress {
	const shape = repertoireShape(variations, chunkSize);
	return repertoireProgressFromShape({ ...shape, totalLevels: Math.min(shape.totalLevels, maxLevel) }, row);
}
```

- [ ] **Step 2: Update every test call site**

`src/lib/mastery/levelProgress.test.ts` needs a `chunkSize` argument (`3`, matching the removed `MOVES_PER_LEVEL` constant) appended to every call below. Apply each of these exact replacements (old line → new line) — every other line in the file is unchanged:

```
buildQueue([a, b], 1, () => 0)                                          -> buildQueue([a, b], 1, 3, () => 0)
buildQueue([a, b, c], 1, () => 0)                                       -> buildQueue([a, b, c], 1, 3, () => 0)
reconcileQueue(queue, [a], 1)                                           -> reconcileQueue(queue, [a], 1, 3)
reconcileQueue(queue, [a, b], 1)                                        -> reconcileQueue(queue, [a, b], 1, 3)
resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false }, [a, b], UNCAPPED)          -> resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false }, [a, b], UNCAPPED, 3)
resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: true }, [a, b], UNCAPPED)           -> resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: true }, [a, b], UNCAPPED, 3)
resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false }, [a], UNCAPPED, () => 0)     -> resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false }, [a], UNCAPPED, 3, () => 0)
resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false }, [a], UNCAPPED)              -> resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false }, [a], UNCAPPED, 3)
resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: true }, [a], UNCAPPED)               -> resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: true }, [a], UNCAPPED, 3)
resolveAttempt(row, { taskKey: 'not-a-real-key', hadMistake: false }, [a], UNCAPPED)           -> resolveAttempt(row, { taskKey: 'not-a-real-key', hadMistake: false }, [a], UNCAPPED, 3)
resolveAttempt(row, { taskKey: taskKey(b, 1), hadMistake: false, abandonedTaskKey: taskKey(a, 1) }, [a, b, c], UNCAPPED)  -> resolveAttempt(row, { taskKey: taskKey(b, 1, 3), hadMistake: false, abandonedTaskKey: taskKey(a, 1, 3) }, [a, b, c], UNCAPPED, 3)
resolveAttempt(row, { taskKey: taskKey(b, 1), hadMistake: false, abandonedTaskKey: taskKey(a, 1) }, [a, b], UNCAPPED)     -> resolveAttempt(row, { taskKey: taskKey(b, 1, 3), hadMistake: false, abandonedTaskKey: taskKey(a, 1, 3) }, [a, b], UNCAPPED, 3)
resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false, abandonedTaskKey: taskKey(a, 1) }, [a, b], UNCAPPED)     -> resolveAttempt(row, { taskKey: taskKey(a, 1, 3), hadMistake: false, abandonedTaskKey: taskKey(a, 1, 3) }, [a, b], UNCAPPED, 3)
resolveAttempt(row, { taskKey: taskKey(a, 2), hadMistake: false }, [a], 2, () => 0)            -> resolveAttempt(row, { taskKey: taskKey(a, 2, 3), hadMistake: false }, [a], 2, 3, () => 0)
resolvePreviousLevelMistake(row, [a], UNCAPPED)                                                -> resolvePreviousLevelMistake(row, [a], UNCAPPED, 3)
resolvePreviousLevelMistake(row, [a], UNCAPPED, () => 0)                                       -> resolvePreviousLevelMistake(row, [a], UNCAPPED, 3, () => 0)
syncLevelProgress(row, [a], UNCAPPED, () => 0)                                                 -> syncLevelProgress(row, [a], UNCAPPED, 3, () => 0)
syncLevelProgress(row, [a], UNCAPPED)                                                           -> syncLevelProgress(row, [a], UNCAPPED, 3)
syncLevelProgress(row, [a], 2)                                                                  -> syncLevelProgress(row, [a], 2, 3)
effectiveLevelCap([a], 6)                                                                       -> effectiveLevelCap([a], 6, 3)
effectiveLevelCap([a], 6)  (second occurrence, natural-cap-30 test)                             -> effectiveLevelCap([a], 6, 3)
repertoireProgress([], null, UNCAPPED)                                                          -> repertoireProgress([], null, UNCAPPED, 3)
repertoireProgress([a], null, UNCAPPED)                                                         -> repertoireProgress([a], null, UNCAPPED, 3)
repertoireProgress([a, b], row, UNCAPPED)                                                       -> repertoireProgress([a, b], row, UNCAPPED, 3)
repertoireProgress([a], row, UNCAPPED)                                                          -> repertoireProgress([a], row, UNCAPPED, 3)
repertoireProgress([a], null, 6)  (both occurrences)                                            -> repertoireProgress([a], null, 6, 3)
repertoireShape([])                                                                             -> repertoireShape([], 3)
repertoireShape([a, b])  (both occurrences)                                                     -> repertoireShape([a, b], 3)
```

Also update every remaining bare `taskKey(x, N)` call anywhere in the file (used to build queue/row fixtures, not shown above because it's inside the replacements already listed) to `taskKey(x, N, 3)`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/levelProgress.test.ts`
Expected: PASS (all tests, unchanged behavior — this task is a pure mechanical parameter threading, not a logic change)

- [ ] **Step 4: Commit**

```bash
git add src/lib/mastery/levelProgress.ts src/lib/mastery/levelProgress.test.ts
git commit -m "feat: thread chunkSize through levelProgress.ts, add activeVariationKey"
```

---

### Task 4: New `variationSequence.ts` — pick and advance the active variation

**Files:**
- Create: `src/lib/mastery/variationSequence.ts`
- Create: `src/lib/mastery/variationSequence.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// mychess/src/lib/mastery/variationSequence.test.ts
import { describe, it, expect } from 'vitest';
import { pickActiveVariation, nextVariation, advanceVariationIfMastered, variationSequenceProgress } from './variationSequence';
import type { LevelProgressRow } from './levelProgress';
import type { Variation } from './variations';

const UNCAPPED = 100;

function variation(playerMoveCount: number, prefix: string): Variation {
	const path: Variation['path'] = [];
	for (let i = 1; i <= playerMoveCount; i++) {
		path.push({ moveId: `${prefix}p${i}`, san: `P${i}`, fromFen: `f${i}a`, toFen: `f${i}b`, isPlayerTurn: true });
		path.push({ moveId: `${prefix}o${i}`, san: `O${i}`, fromFen: `f${i}b`, toFen: `f${i + 1}a`, isPlayerTurn: false });
	}
	return {
		leafMoveId: path[path.length - 1].moveId,
		variationKey: path.map((s) => s.moveId).join('>'),
		path,
		playerMoveCount
	};
}

describe('pickActiveVariation', () => {
	it('returns null for an empty variation list', () => {
		expect(pickActiveVariation([], null)).toBeNull();
	});

	it('defaults to the first variation when no key is given', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		expect(pickActiveVariation([a, b], null)).toBe(a);
	});

	it('returns the variation matching the given key', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		expect(pickActiveVariation([a, b], b.variationKey)).toBe(b);
	});

	it('falls back to the first variation when the key no longer matches anything (e.g. excluded/edited repertoire)', () => {
		const a = variation(2, 'a-');
		expect(pickActiveVariation([a], 'stale-key')).toBe(a);
	});
});

describe('nextVariation', () => {
	it('returns the variation right after the given key', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const c = variation(2, 'c-');
		expect(nextVariation([a, b, c], a.variationKey)).toBe(b);
	});

	it('returns null when the given key is the last variation', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		expect(nextVariation([a, b], b.variationKey)).toBeNull();
	});

	it('returns null when the given key is not found', () => {
		const a = variation(2, 'a-');
		expect(nextVariation([a], 'no-such-key')).toBeNull();
	});
});

describe('advanceVariationIfMastered', () => {
	it('leaves the row untouched (but stamps activeVariationKey) when the active variation is not yet mastered', () => {
		const a = variation(6, 'a-'); // cap = 2
		const b = variation(6, 'b-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [], activeVariationKey: a.variationKey };
		const next = advanceVariationIfMastered(row, [a, b], UNCAPPED, 3);
		expect(next.level).toBe(1);
		expect(next.activeVariationKey).toBe(a.variationKey);
	});

	it('advances to the next variation, resetting to a fresh level 1, once the active one is mastered', () => {
		const a = variation(2, 'a-'); // cap = 1
		const b = variation(6, 'b-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 3, queue: [], activeVariationKey: a.variationKey };
		const next = advanceVariationIfMastered(row, [a, b], UNCAPPED, 3, () => 0);
		expect(next.activeVariationKey).toBe(b.variationKey);
		expect(next.level).toBe(1);
		expect(next.prevLevelMistakes).toBe(0);
		expect(next.queue.map((e) => e.status)).toEqual(['pending']);
	});

	it('stays mastered (no next variation) once the LAST variation is mastered', () => {
		const a = variation(2, 'a-'); // cap = 1
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [], activeVariationKey: a.variationKey };
		const next = advanceVariationIfMastered(row, [a], UNCAPPED, 3);
		expect(next.activeVariationKey).toBe(a.variationKey);
		expect(next.level).toBe(2); // unchanged — nothing left to advance to
	});

	it('defaults to the first variation when activeVariationKey is missing (bootstrap row)', () => {
		const a = variation(6, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [] };
		const next = advanceVariationIfMastered(row, [a], UNCAPPED, 3);
		expect(next.activeVariationKey).toBe(a.variationKey);
	});

	it('is a no-op for an empty variation list', () => {
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [] };
		expect(advanceVariationIfMastered(row, [], UNCAPPED, 3)).toEqual(row);
	});
});

describe('variationSequenceProgress', () => {
	it('is all zero for an empty variation list', () => {
		expect(variationSequenceProgress([], null, UNCAPPED, 3)).toEqual({ variationsMastered: 0, totalVariationsInSequence: 0 });
	});

	it('is zero mastered, full total, when there is no row yet', () => {
		const a = variation(6, 'a-');
		const b = variation(6, 'b-');
		expect(variationSequenceProgress([a, b], null, UNCAPPED, 3)).toEqual({ variationsMastered: 0, totalVariationsInSequence: 2 });
	});

	it("counts every variation strictly before the active one as mastered, plus the active one itself once IT masters", () => {
		const a = variation(2, 'a-'); // cap = 1
		const b = variation(2, 'b-');
		const c = variation(2, 'c-');
		const inProgress: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [], activeVariationKey: b.variationKey };
		expect(variationSequenceProgress([a, b, c], inProgress, UNCAPPED, 3)).toEqual({
			variationsMastered: 1, // a is before b, b itself isn't done yet
			totalVariationsInSequence: 3
		});

		const bMastered: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [], activeVariationKey: b.variationKey };
		expect(variationSequenceProgress([a, b, c], bMastered, UNCAPPED, 3)).toEqual({
			variationsMastered: 2, // a and b both done
			totalVariationsInSequence: 3
		});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mastery/variationSequence.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// mychess/src/lib/mastery/variationSequence.ts
import type { Variation } from './variations';
import { buildQueue, effectiveLevelCap, type LevelProgressRow } from './levelProgress';

/**
 * The ONE variation level_progress.level/queue currently track. Falls back
 * to the first variation in `variations`' own order when `activeVariationKey`
 * is null (a fresh row) or no longer matches anything (a repertoire edited,
 * or a variation excluded, since the key was last stored) — the same
 * self-healing fallback `reconcileQueue` already applies to a stale queue.
 */
export function pickActiveVariation(variations: Variation[], activeVariationKey: string | null): Variation | null {
	if (variations.length === 0) return null;
	const found = activeVariationKey ? variations.find((v) => v.variationKey === activeVariationKey) : undefined;
	return found ?? variations[0];
}

/** The variation immediately after `currentKey` in `variations`' own order, or null if it's the last one (or not found). */
export function nextVariation(variations: Variation[], currentKey: string): Variation | null {
	const index = variations.findIndex((v) => v.variationKey === currentKey);
	if (index === -1 || index + 1 >= variations.length) return null;
	return variations[index + 1];
}

/**
 * Called after every mutation that might have just cleared the active
 * variation's final level (`resolveAttempt`, `syncLevelProgress`,
 * `resolvePreviousLevelMistake` — the last of which only ever demotes, so
 * this is a harmless pass-through for it, applied uniformly rather than
 * conditionally at each call site). If the active variation isn't mastered
 * yet, just stamps `activeVariationKey` onto the row (nothing else about it
 * sets that field). If it IS mastered (`row.level` past its own level cap)
 * and there's a next variation in sequence, resets to a fresh Level 1 run
 * for that one. If it was the LAST variation, the row is left as-is —
 * `row.level` staying past the (now whole-repertoire) cap IS the "fully
 * mastered" signal `variationSequenceProgress` reads.
 */
export function advanceVariationIfMastered(
	row: LevelProgressRow,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number,
	random: () => number = Math.random
): LevelProgressRow {
	const active = pickActiveVariation(variations, row.activeVariationKey ?? null);
	if (!active) return row;

	const cap = effectiveLevelCap([active], maxLevel, chunkSize);
	if (row.level <= cap) return { ...row, activeVariationKey: active.variationKey };

	const next = nextVariation(variations, active.variationKey);
	if (!next) return { ...row, activeVariationKey: active.variationKey };

	return {
		level: 1,
		prevLevelMistakes: 0,
		queue: buildQueue([next], 1, chunkSize, random),
		activeVariationKey: next.variationKey
	};
}

/**
 * How far through the repertoire's own variation sequence a player has
 * gotten — "M of N variations mastered" — independent of `repertoireProgress`
 * (which, once scoped to `[activeVariation]` at the call site, describes the
 * active variation's OWN level/queue detail, not this repertoire-wide count).
 */
export function variationSequenceProgress(
	variations: Variation[],
	row: { activeVariationKey?: string | null; level: number } | null,
	maxLevel: number,
	chunkSize: number
): { variationsMastered: number; totalVariationsInSequence: number } {
	if (variations.length === 0) return { variationsMastered: 0, totalVariationsInSequence: 0 };
	if (!row) return { variationsMastered: 0, totalVariationsInSequence: variations.length };

	const activeKey = row.activeVariationKey ?? variations[0].variationKey;
	const activeIndex = variations.findIndex((v) => v.variationKey === activeKey);
	if (activeIndex === -1) return { variationsMastered: 0, totalVariationsInSequence: variations.length };

	const cap = effectiveLevelCap([variations[activeIndex]], maxLevel, chunkSize);
	const activeMastered = row.level > cap;
	return {
		variationsMastered: activeMastered ? activeIndex + 1 : activeIndex,
		totalVariationsInSequence: variations.length
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/variationSequence.test.ts`
Expected: PASS

Still don't run the full suite — `practice.test.ts` remains broken for the same reason as Task 2 until Task 5 updates its call sites. `levels.test.ts`, `levelProgress.test.ts`, and `variationSequence.test.ts` should all pass at this point (Tasks 2-3 already made `levelProgress.ts` consistent), so this task's own file plus those two are safe to run together if you want extra confidence: `npx vitest run src/lib/mastery/levels.test.ts src/lib/mastery/levelProgress.test.ts src/lib/mastery/variationSequence.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mastery/variationSequence.ts src/lib/mastery/variationSequence.test.ts
git commit -m "feat: add variationSequence.ts to pick and advance the active variation"
```

---

### Task 5: `practice.ts` — thread `chunkSize`, scope `buildPracticeView` to the active variation

**Files:**
- Modify: `src/lib/mastery/practice.ts`
- Modify: `src/lib/mastery/practice.test.ts`

- [ ] **Step 1: Implement the signature changes**

In `src/lib/mastery/practice.ts`, update every function to take `chunkSize`, and make `buildPracticeView` resolve the active variation:

```ts
// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { targetDepth, levelDepth, taskKey, levelTaskVariations, hasContentAtLevel, type Level } from './levels';
import { repertoireProgress, type LevelProgressRow } from './levelProgress';
import { pickActiveVariation, variationSequenceProgress } from './variationSequence';
```

(keep the `Alternative`/`QuizStep`/`PracticeAttempt` type definitions exactly as they are — no change)

```ts
export function pickQueuedAttempt(
	variations: Variation[],
	level: Level,
	queue: { key: string; status: 'pending' | 'cleared' }[],
	chunkSize: number
): PracticeAttempt | null {
	const nextKey = queue.find((entry) => entry.status === 'pending')?.key;
	if (nextKey === undefined) return null;

	const tasks = levelTaskVariations(variations, level, chunkSize) as Variation[];
	const variation = tasks.find((v) => taskKey(v, level, chunkSize) === nextKey);
	if (!variation) return null;

	return { variation, targetDepth: targetDepth(variation, level, chunkSize), taskKey: nextKey };
}
```

(keep `nthPlayerStep` unchanged)

```ts
function alternativesAt(
	variations: Variation[],
	level: Level,
	playerMoveIndex: number,
	fromFen: string,
	canonicalSan: string,
	chunkSize: number
): Alternative[] {
	const found = new Map<string, Alternative>();
	for (const variation of variations) {
		const step = nthPlayerStep(variation.path, playerMoveIndex);
		if (!step || step.fromFen !== fromFen || step.san === canonicalSan) continue;
		const existing = found.get(step.san);
		if (existing?.kind === 'completes') continue;

		if (!hasContentAtLevel(variation, level, chunkSize)) {
			if (!existing) found.set(step.san, { san: step.san, toFen: step.toFen, moveId: step.moveId, kind: 'dead-end' });
			continue;
		}

		if (playerMoveIndex === targetDepth(variation, level, chunkSize)) {
			found.set(step.san, {
				san: step.san,
				toFen: step.toFen,
				moveId: step.moveId,
				kind: 'completes',
				taskKey: taskKey(variation, level, chunkSize)
			});
			continue;
		}

		if (existing?.kind !== 'continue') {
			found.set(step.san, {
				san: step.san,
				toFen: step.toFen,
				moveId: step.moveId,
				kind: 'continue',
				variationKey: variation.variationKey
			});
		}
	}
	return [...found.values()];
}

export function splitAttempt(
	path: VariationStep[],
	level: Level,
	targetDepthValue: number,
	variations: Variation[],
	chunkSize: number
): { prefix: VariationStep[]; quizSteps: QuizStep[] } {
	const playerIndices: number[] = [];
	path.forEach((step, i) => {
		if (step.isPlayerTurn) playerIndices.push(i);
	});

	const startPoint = levelDepth(Math.max(level - 2, 0), chunkSize);
	const previousLevelDepth = levelDepth(level - 1, chunkSize);
	const nextPlayerIdx = playerIndices[startPoint];
	const targetPlayerIdx = playerIndices[targetDepthValue - 1];

	if (nextPlayerIdx === undefined || targetPlayerIdx === undefined || startPoint >= targetDepthValue) {
		throw new Error(
			`splitAttempt: level ${level} (auto-play boundary ${startPoint}) and targetDepthValue (${targetDepthValue}) are inconsistent with the given path (${playerIndices.length} player moves found)`
		);
	}

	let playerMovesSeen = startPoint;
	const quizSteps: QuizStep[] = path.slice(nextPlayerIdx, targetPlayerIdx + 1).map((step) => {
		if (step.isPlayerTurn) playerMovesSeen++;
		const alternatives = step.isPlayerTurn
			? alternativesAt(variations, level, playerMovesSeen, step.fromFen, step.san, chunkSize)
			: [];
		return {
			...step,
			band: playerMovesSeen <= previousLevelDepth ? 'previous' : 'current',
			playerMoveIndex: playerMovesSeen,
			alternatives
		};
	});

	return {
		prefix: path.slice(0, nextPlayerIdx),
		quizSteps
	};
}

export function pickReviewAttempt(
	variations: Variation[],
	level: Level,
	chunkSize: number,
	random: () => number = Math.random
): PracticeAttempt | null {
	const candidates = variations.filter((v) => hasContentAtLevel(v, level, chunkSize));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	return { variation: chosen, targetDepth: targetDepth(chosen, level, chunkSize), taskKey: taskKey(chosen, level, chunkSize) };
}

export type PracticeView = {
	level: Level | 'mastered';
	totalVariations: number;
	totalLevels: number;
	levelTaskCount: number;
	levelSolvedCount: number;
	attempt: { prefix: VariationStep[]; quizSteps: QuizStep[]; taskKey: string } | null;
	reviewLevel: number | null;
	// "M of N variations mastered" — independent of totalVariations/totalLevels
	// above, which (once buildPracticeView narrows to `[activeVariation]`)
	// describe the ACTIVE variation's own level detail, not the whole
	// repertoire's sequence position. See variationSequence.ts.
	variationsMastered: number;
	totalVariationsInSequence: number;
};

/**
 * Builds the full client-facing practice view — progress summary plus the
 * next attempt to serve — from a repertoire's FULL variation set, its
 * (possibly absent) `level_progress` row, and an already-validated
 * `reviewLevel`. Resolves which ONE variation is currently active
 * (`pickActiveVariation`) and narrows every level/queue computation to just
 * that variation — `variations` itself is only used in full for the
 * variation-sequence progress count (`variationSequenceProgress`) and to
 * find the active variation in the first place.
 */
export function buildPracticeView(
	variations: Variation[],
	row: LevelProgressRow | null,
	reviewLevel: number | null,
	maxLevel: number,
	chunkSize: number
): PracticeView {
	const active = pickActiveVariation(variations, row?.activeVariationKey ?? null);
	const activeList = active ? [active] : [];

	const { level, totalVariations, totalLevels, levelTaskCount, levelSolvedCount } = repertoireProgress(
		activeList,
		row,
		maxLevel,
		chunkSize
	);
	const { variationsMastered, totalVariationsInSequence } = variationSequenceProgress(variations, row, maxLevel, chunkSize);

	let attempt: PracticeView['attempt'] = null;
	if (reviewLevel !== null && active) {
		const picked = pickReviewAttempt(activeList, reviewLevel, chunkSize);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, reviewLevel, picked.targetDepth, activeList, chunkSize);
			attempt = { prefix, quizSteps, taskKey: picked.taskKey };
		}
	} else if (level !== 'mastered' && row && active) {
		const picked = pickQueuedAttempt(activeList, level, row.queue, chunkSize);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, level, picked.targetDepth, activeList, chunkSize);
			attempt = { prefix, quizSteps, taskKey: picked.taskKey };
		}
	}

	return {
		level,
		totalVariations,
		totalLevels,
		levelTaskCount,
		levelSolvedCount,
		attempt,
		reviewLevel,
		variationsMastered,
		totalVariationsInSequence
	};
}

export function continueFromBranch(
	variations: Variation[],
	level: Level,
	variationKey: string,
	afterPlayerMoveIndex: number,
	chunkSize: number
): { quizSteps: QuizStep[]; taskKey: string } | null {
	const variation = variations.find((v) => v.variationKey === variationKey);
	if (!variation || !hasContentAtLevel(variation, level, chunkSize)) return null;

	const { quizSteps } = splitAttempt(variation.path, level, targetDepth(variation, level, chunkSize), variations, chunkSize);
	const cutIndex = quizSteps.findIndex((s) => s.isPlayerTurn && s.playerMoveIndex === afterPlayerMoveIndex);
	if (cutIndex === -1) return null;

	return { quizSteps: quizSteps.slice(cutIndex + 1), taskKey: taskKey(variation, level, chunkSize) };
}
```

Keep the doc comments already on `PracticeAttempt`, `Alternative`, `QuizStep`, and the un-shown functions exactly as they are today — only signatures gain `chunkSize`, no other prose changes there.

- [ ] **Step 2: Update every test call site**

In `src/lib/mastery/practice.test.ts`, append `, 3` (chunk size) as the final argument to every one of these calls — same mechanical rule as Task 3, and every `taskKey(x, N)` fixture call anywhere in the file becomes `taskKey(x, N, 3)`:

```
pickQueuedAttempt([v], 1, queue)                          -> pickQueuedAttempt([v], 1, queue, 3)
pickQueuedAttempt([], 1, [])                              -> pickQueuedAttempt([], 1, [], 3)
pickQueuedAttempt([a, b], 2, queue)                        -> pickQueuedAttempt([a, b], 2, queue, 3)
pickQueuedAttempt([a, b], 1, queue)                        -> pickQueuedAttempt([a, b], 1, queue, 3)
pickReviewAttempt([v], 1, () => 0)                         -> pickReviewAttempt([v], 1, 3, () => 0)
pickReviewAttempt([short, long], 2, () => 0)               -> pickReviewAttempt([short, long], 2, 3, () => 0)
pickReviewAttempt([v], 2)                                  -> pickReviewAttempt([v], 2, 3)
splitAttempt(v.path, 1, 3, [v])                            -> splitAttempt(v.path, 1, 3, [v], 3)
splitAttempt(v.path, 2, 6, [v])                            -> splitAttempt(v.path, 2, 6, [v], 3)
splitAttempt(v.path, 3, 9, [v])                            -> splitAttempt(v.path, 3, 9, [v], 3)
splitAttempt(v.path, 1, 2, [v])   (every occurrence)        -> splitAttempt(v.path, 1, 2, [v], 3)
splitAttempt(v.path, 3, 2, [v])                            -> splitAttempt(v.path, 3, 2, [v], 3)
splitAttempt(a.path, 1, 2, [a, b])   (every occurrence)     -> splitAttempt(a.path, 1, 2, [a, b], 3)
splitAttempt(a.path, 2, 6, [a, b])                          -> splitAttempt(a.path, 2, 6, [a, b], 3)
splitAttempt(a.path, 1, 2, [a, b1, b2])                     -> splitAttempt(a.path, 1, 2, [a, b1, b2], 3)
splitAttempt(a.path, 2, 6, [a, d, e])                       -> splitAttempt(a.path, 2, 6, [a, d, e], 3)
splitAttempt(a.path, 1, 2, [a, g, h])                       -> splitAttempt(a.path, 1, 2, [a, g, h], 3)
splitAttempt(a.path, 1, 2, [a, c])                          -> splitAttempt(a.path, 1, 2, [a, c], 3)
buildPracticeView([v], row, 1, UNCAPPED)                    -> buildPracticeView([v], row, 1, UNCAPPED, 3)
buildPracticeView([v], row, null, UNCAPPED)  (every occurrence) -> buildPracticeView([v], row, null, UNCAPPED, 3)
buildPracticeView([v], null, null, UNCAPPED)                -> buildPracticeView([v], null, null, UNCAPPED, 3)
buildPracticeView([v], row, null, 2)                        -> buildPracticeView([v], row, null, 2, 3)
buildPracticeView([], null, null, UNCAPPED)                 -> buildPracticeView([], null, null, UNCAPPED, 3)
continueFromBranch([a, b], 2, b.variationKey, 2)            -> continueFromBranch([a, b], 2, b.variationKey, 2, 3)
continueFromBranch([a], 1, 'no-such-key', 1)                -> continueFromBranch([a], 1, 'no-such-key', 1, 3)
continueFromBranch([a], 1, a.variationKey, 4)               -> continueFromBranch([a], 1, a.variationKey, 4, 3)
continueFromBranch([a], 5, a.variationKey, 1)               -> continueFromBranch([a], 5, a.variationKey, 1, 3)
continueFromBranch([e, f], 1, e.variationKey, 1)            -> continueFromBranch([e, f], 1, e.variationKey, 1, 3)
```

- [ ] **Step 3: Add tests for the new sequencing behavior in `buildPracticeView`**

Append to the `describe('buildPracticeView', ...)` block:

```ts
	it('serves the SECOND variation once activeVariationKey points past the first', () => {
		const a = makeVariation(2, 'a-'); // cap = 1, would be mastered
		const b = makeVariation(3, 'b-');
		const row = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(b, 1, 3), status: 'pending' as const }], activeVariationKey: b.variationKey };
		const view = buildPracticeView([a, b], row, null, UNCAPPED, 3);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.taskKey).toBe(taskKey(b, 1, 3));
	});

	it('defaults to the FIRST variation when the row has no activeVariationKey yet', () => {
		const a = makeVariation(3, 'a-');
		const b = makeVariation(3, 'b-');
		const row = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1, 3), status: 'pending' as const }] };
		const view = buildPracticeView([a, b], row, null, UNCAPPED, 3);
		expect(view.attempt!.taskKey).toBe(taskKey(a, 1, 3));
	});

	it('reports variationsMastered/totalVariationsInSequence across the whole repertoire, not just the active variation', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const c = makeVariation(2, 'c-');
		const row = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(b, 1, 3), status: 'pending' as const }], activeVariationKey: b.variationKey };
		const view = buildPracticeView([a, b, c], row, null, UNCAPPED, 3);
		expect(view.variationsMastered).toBe(1); // a is done, b (active) isn't yet
		expect(view.totalVariationsInSequence).toBe(3);
	});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: FAIL on type errors in every file that still calls these functions without `chunkSize` — that's expected; Tasks 6-9 fix each remaining call site. Confirm the ONLY errors reported are in `src/lib/server/level-progress.ts`, `src/lib/server/practice-repertoire.ts`, `src/lib/server/repertoire-progress.ts`, the `/api/practice/*` routes, and `src/routes/(player)/practice/[repertoire_id]/+page.server.ts` — if anything else fails, stop and investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mastery/practice.ts src/lib/mastery/practice.test.ts
git commit -m "feat: thread chunkSize through practice.ts, scope buildPracticeView to the active variation"
```

---

### Task 6: `practice-repertoire.ts` — read and expose `chunk_size`

**Files:**
- Modify: `src/lib/server/practice-repertoire.ts`

- [ ] **Step 1: Add `chunkSize` to `PracticeRepertoire` and the select/mapping**

```ts
export type PracticeRepertoire = { id: string; name: string; color: string; practiceDepthLevels: number; chunkSize: number };
```

In `loadRepertoireVariations`, update the `repertoires` select and the returned object:

```ts
		supabase
			.from('repertoires')
			.select('id, name, color, practice_depth_levels, chunk_size')
			.eq('id', repertoireId)
			.maybeSingle(),
```

```ts
	return {
		repertoire: {
			id: repertoire.id,
			name: repertoire.name,
			color: repertoire.color,
			practiceDepthLevels: repertoire.practice_depth_levels,
			chunkSize: repertoire.chunk_size
		},
		variations: enumerateVariations(moves),
		excludedVariationKeys: new Set((exclusions ?? []).map((row: any) => row.variation_key))
	};
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (this file has no dedicated test — see its Task 4-equivalent precedent in the chapter-grouping plan; confirms no regression elsewhere)

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/practice-repertoire.ts
git commit -m "feat: expose chunk_size on PracticeRepertoire"
```

---

### Task 7: `level-progress.ts` — persist `active_variation_key`, wire in `advanceVariationIfMastered`

**Files:**
- Modify: `src/lib/server/level-progress.ts`

- [ ] **Step 1: Replace the file's contents**

```ts
// mychess/src/lib/server/level-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variation } from '$lib/mastery/variations';
import {
	buildQueue,
	resolveAttempt,
	resolvePreviousLevelMistake,
	syncLevelProgress,
	type AttemptResult,
	type LevelProgressRow
} from '$lib/mastery/levelProgress';
import { pickActiveVariation, advanceVariationIfMastered } from '$lib/mastery/variationSequence';

type DbRow = {
	level: number;
	prev_level_mistakes: number;
	queue: unknown;
	version: number;
	active_variation_key: string | null;
};

function toRow(r: DbRow): LevelProgressRow {
	return {
		level: r.level,
		prevLevelMistakes: r.prev_level_mistakes,
		queue: r.queue as LevelProgressRow['queue'],
		activeVariationKey: r.active_variation_key
	};
}

const MAX_CONFLICT_RETRIES = 5;

/**
 * Reads the current row (if any), runs `compute` against it, and persists
 * the result with an optimistic-concurrency check — an `UPDATE ... WHERE
 * version = <version just read>` (or a bare `INSERT` when no row exists
 * yet), retrying against a fresh read whenever that affects zero rows,
 * meaning a concurrent writer landed first.
 *
 * This matters because THREE independent flows mutate the same
 * (player_id, repertoire_id) row: the detail page's on-load sync, an
 * attempt's completion, and an instant previous-level-mistake report (fired
 * unawaited the moment a wrong move lands, so it can genuinely overlap with
 * either of the other two). A plain read-then-write here would let
 * whichever write lands last silently clobber the other.
 *
 * `compute` returns `null` to mean "no row and nothing to create" (an
 * attempt/mistake report against a repertoire with no run yet — shouldn't
 * normally happen, but is a safe no-op rather than an error). Returning the
 * exact `existing` object back is treated as a no-op write too — every pure
 * resolver in `$lib/mastery/levelProgress.ts` already does this for its own
 * no-op cases (stale/replayed report, already mastered), so this falls out
 * for free rather than needing each call site to special-case it.
 */
async function mutateLevelProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	compute: (existing: LevelProgressRow | null) => LevelProgressRow | null
): Promise<LevelProgressRow | null> {
	for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
		const { data: existingRaw } = await supabase
			.from('level_progress')
			.select('level, prev_level_mistakes, queue, version, active_variation_key')
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.maybeSingle();

		const existingRow = existingRaw ? toRow(existingRaw) : null;
		const next = compute(existingRow);
		if (next === null) return existingRow;
		if (existingRow && next === existingRow) return existingRow;

		if (!existingRaw) {
			const { error } = await supabase.from('level_progress').insert({
				player_id: playerId,
				repertoire_id: repertoireId,
				level: next.level,
				prev_level_mistakes: next.prevLevelMistakes,
				queue: next.queue,
				active_variation_key: next.activeVariationKey ?? null,
				version: 0
			});
			if (!error) return next;
			continue; // someone else inserted first — retry, this time as a version-checked update
		}

		const { data: updated } = await supabase
			.from('level_progress')
			.update({
				level: next.level,
				prev_level_mistakes: next.prevLevelMistakes,
				queue: next.queue,
				active_variation_key: next.activeVariationKey ?? null,
				version: existingRaw.version + 1
			})
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.eq('version', existingRaw.version)
			.select('version');
		if (updated && updated.length > 0) return next;
		// Lost the race against a concurrent writer — retry from a fresh read.
	}
	throw new Error(
		`level_progress: exceeded retry limit resolving a concurrent update (player ${playerId}, repertoire ${repertoireId})`
	);
}

/**
 * Loads a repertoire's level_progress row, creating a fresh Level 1 run
 * against the first (or resumed) active variation if none exists yet, then
 * reconciles it against the repertoire's current content — persisting
 * either write. `advanceVariationIfMastered` runs after every sync so a row
 * left sitting past its active variation's cap (e.g. the player closed the
 * tab right after their last correct move) advances to the next variation
 * on this very load, not just on a future attempt report. Returns `null` for
 * a repertoire with no variations (vacuously mastered, nothing to track).
 */
export async function loadSyncedLevelProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number
): Promise<LevelProgressRow | null> {
	if (variations.length === 0) return null;

	return mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		const active = pickActiveVariation(variations, existing?.activeVariationKey ?? null);
		if (!active) return null;
		const row = existing ?? {
			level: 1,
			prevLevelMistakes: 0,
			queue: buildQueue([active], 1, chunkSize),
			activeVariationKey: active.variationKey
		};
		const synced = syncLevelProgress(row, [active], maxLevel, chunkSize);
		return advanceVariationIfMastered(synced, variations, maxLevel, chunkSize);
	});
}

/**
 * Applies a completed Practice attempt's outcome — see
 * `$lib/mastery/levelProgress.ts`'s `resolveAttempt` for the rules, scoped to
 * whichever variation is currently active. `advanceVariationIfMastered` runs
 * afterward so completing a variation's final level immediately switches the
 * active variation, rather than leaving that switch to the next page load.
 */
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	result: AttemptResult,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number
): Promise<LevelProgressRow | null> {
	return mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		if (!existing) return null;
		const active = pickActiveVariation(variations, existing.activeVariationKey ?? null);
		if (!active) return null;
		const resolved = resolveAttempt(existing, result, [active], maxLevel, chunkSize);
		return advanceVariationIfMastered(resolved, variations, maxLevel, chunkSize);
	});
}

/**
 * Applies a single previous-level-band mistake immediately — see
 * `$lib/mastery/levelProgress.ts`'s `resolvePreviousLevelMistake` for the
 * rules, scoped to the active variation. `advanceVariationIfMastered` is
 * applied uniformly afterward for consistency even though a demotion never
 * masters anything — it's a harmless pass-through in that case, and every
 * other mutation path already goes through it, so a mistake report doesn't
 * need its own special case to still carry a correct `activeVariationKey`.
 */
export async function applyPreviousLevelMistake(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number
): Promise<{ demoted: boolean; row: LevelProgressRow } | null> {
	let demoted = false;
	const next = await mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		if (!existing) return null;
		const active = pickActiveVariation(variations, existing.activeVariationKey ?? null);
		if (!active) return null;
		const outcome = resolvePreviousLevelMistake(existing, [active], maxLevel, chunkSize);
		demoted = outcome.demoted;
		return advanceVariationIfMastered(outcome.row, variations, maxLevel, chunkSize);
	});
	return next ? { demoted, row: next } : null;
}

/** When this player last completed a maintenance review of a mastered repertoire, or `null` if never. */
export async function getLastReviewedAt(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<string | null> {
	const { data } = await supabase
		.from('level_progress')
		.select('last_reviewed_at')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.maybeSingle();
	return data?.last_reviewed_at ?? null;
}

/**
 * Records that a maintenance review session just finished — see
 * `reviewFreshness`. A plain update, not routed through
 * `mutateLevelProgress`'s optimistic-concurrency machinery: `last_reviewed_at`
 * doesn't participate in the level/queue/version/active-variation invariants
 * that machinery protects, so a concurrent write to any of those can't
 * corrupt this column or vice versa — Postgres's normal row-level locking is
 * all that's needed here. Assumes a row already exists (only reachable from
 * the Mastered screen, which requires one); silently no-ops otherwise via the
 * `.eq` filters matching nothing.
 */
export async function recordMaintenanceReview(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<void> {
	await supabase
		.from('level_progress')
		.update({ last_reviewed_at: new Date().toISOString() })
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId);
}
```

- [ ] **Step 2: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: type errors remaining only in the `/api/practice/*` routes and `+page.server.ts` (Tasks 8-9 fix these). No test failures — this file has no dedicated test, per this repo's `src/lib/server/*` convention (exercised through the pure-logic tests plus manual verification in Task 10).

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/level-progress.ts
git commit -m "feat: persist active_variation_key, advance it on mastery"
```

---

### Task 8: Wire `chunkSize` through the `/api/practice/*` routes and `+page.server.ts`

**Files:**
- Modify: `src/routes/api/practice/attempt/+server.ts`
- Modify: `src/routes/api/practice/mistake/+server.ts`
- Modify: `src/routes/api/practice/continue/+server.ts`
- Modify: `src/routes/(player)/practice/[repertoire_id]/+page.server.ts`

- [ ] **Step 1: `attempt/+server.ts`**

```ts
	const { repertoire, variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const maxLevel = repertoire.practiceDepthLevels;
	const chunkSize = repertoire.chunkSize;
	const today = new Date().toISOString().slice(0, 10);
	const [row] = await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, { taskKey, hadMistake, abandonedTaskKey }, variations, maxLevel, chunkSize),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);

	return json(buildPracticeView(variations, row, null, maxLevel, chunkSize));
```

- [ ] **Step 2: `mistake/+server.ts`**

```ts
	const { repertoire, variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const maxLevel = repertoire.practiceDepthLevels;
	const chunkSize = repertoire.chunkSize;
	const result = await applyPreviousLevelMistake(supabase, user.id, repertoireId, variations, maxLevel, chunkSize);

	if (!result || !result.demoted) return json({ demoted: false });
	return json({ demoted: true, view: buildPracticeView(variations, result.row, null, maxLevel, chunkSize) });
```

- [ ] **Step 3: `continue/+server.ts`**

```ts
	const { repertoire, variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const result = continueFromBranch(variations, level, variationKey, afterPlayerMoveIndex, repertoire.chunkSize);
	if (!result) throw error(404, 'Continuation not found');

	return json(result);
```

(This endpoint is now unreachable dead code per this plan's Architecture note — kept working and type-correct rather than deleted; flagged in Task 10 for a follow-up removal issue.)

- [ ] **Step 4: `+page.server.ts`**

```ts
// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedLevelProgress, getLastReviewedAt } from '$lib/server/level-progress';
import { repertoireProgress } from '$lib/mastery/levelProgress';
import { pickActiveVariation } from '$lib/mastery/variationSequence';
import { buildPracticeView } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const { repertoire, variations } = await loadFilteredRepertoireVariations(supabase, user!.id, repertoireId);
	const maxLevel = repertoire.practiceDepthLevels;
	const chunkSize = repertoire.chunkSize;
	const row = await loadSyncedLevelProgress(supabase, user!.id, repertoireId, variations, maxLevel, chunkSize);
	const active = pickActiveVariation(variations, row?.activeVariationKey ?? null);
	const { level, totalLevels } = repertoireProgress(active ? [active] : [], row, maxLevel, chunkSize);

	// A `?level=N` request only takes effect for a level strictly below the
	// active variation's own active level (or any level up to its totalLevels
	// once IT is mastered) — anything else is ignored and the page falls back
	// to normal training below.
	const requestedLevel = Number(url.searchParams.get('level'));
	const isValidReview =
		Number.isInteger(requestedLevel) &&
		requestedLevel >= 1 &&
		(level === 'mastered' ? requestedLevel <= totalLevels : requestedLevel < level);
	const reviewLevel = isValidReview ? requestedLevel : null;

	const lastReviewedAt = level === 'mastered' ? await getLastReviewedAt(supabase, user!.id, repertoireId) : null;

	return { repertoire, lastReviewedAt, ...buildPracticeView(variations, row, reviewLevel, maxLevel, chunkSize) };
};
```

- [ ] **Step 5: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: type errors remaining only in `src/lib/server/repertoire-progress.ts` and its two callers (Task 9 fixes these).

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/practice/attempt/+server.ts src/routes/api/practice/mistake/+server.ts src/routes/api/practice/continue/+server.ts "src/routes/(player)/practice/[repertoire_id]/+page.server.ts"
git commit -m "feat: pass chunkSize through the practice API routes and detail page load"
```

---

### Task 9: `repertoire-progress.ts` — read `chunk_size`, thread it through the picker summary

**Files:**
- Modify: `src/lib/server/repertoire-progress.ts`

- [ ] **Step 1: Select `chunk_size` alongside the other repertoire columns**

Update both `.select(...)` calls in `loadRepertoireProgressSummaries` (own repertoires and assigned repertoires) to include `chunk_size`:

```ts
		supabase
			.from('repertoires')
			.select('id, name, color, total_variations, total_levels, level1_task_count, has_chapters, practice_depth_levels, chunk_size')
			.eq('player_id', userId),
		supabase
			.from('assigned_repertoires')
			.select(
				'repertoire:repertoire_id(id, name, color, total_variations, total_levels, level1_task_count, has_chapters, practice_depth_levels, chunk_size)'
			)
			.eq('player_id', userId)
```

- [ ] **Step 2: Thread `chunk_size` through the shape/progress computation**

Update the `progressRows` select to include `active_variation_key`, the `rowByRep` map to carry it, the backfill's `repertoireShape` call, and the final `repertoireShape`/`repertoireProgressFromShape` calls to use each repertoire's own `chunk_size`:

```ts
	const [exclusionsByRep, { data: progressRows }] = await Promise.all([
		fetchExclusionsByRepertoire(supabase, userId, repIds),
		supabase
			.from('level_progress')
			.select('repertoire_id, level, prev_level_mistakes, queue, active_variation_key')
			.eq('player_id', userId)
			.in('repertoire_id', repIds)
	]);
```

```ts
	const backfilledShapes = new Map<string, RepertoireShape>();
	const backfilledHasChapters = new Map<string, boolean>();
	await Promise.all(
		uncachedIds.map(async (repId) => {
			const variations = variationsByRep.get(repId) ?? [];
			const rep = allReps.find((r: any) => r.id === repId);
			const shape = repertoireShape(variations, rep.chunk_size);
			const hasChapters = hasChapterTags(variations);
			backfilledShapes.set(repId, shape);
			backfilledHasChapters.set(repId, hasChapters);
			const { error } = await supabase
				.from('repertoires')
				.update({
					total_variations: shape.totalVariations,
					total_levels: shape.totalLevels,
					level1_task_count: shape.level1TaskCount,
					has_chapters: hasChapters
				})
				.eq('id', repId);
			if (error) console.error(`Failed to backfill shape cache for repertoire ${repId}:`, error);
		})
	);

	const rowByRep = new Map<string, LevelProgressRow>();
	for (const r of (progressRows ?? []) as any[]) {
		rowByRep.set(r.repertoire_id, {
			level: r.level,
			prevLevelMistakes: r.prev_level_mistakes,
			queue: r.queue,
			activeVariationKey: r.active_variation_key
		});
	}

	return allReps.map((r: any) => {
		const naturalShape: RepertoireShape =
			r.total_variations !== null
				? { totalVariations: r.total_variations, totalLevels: r.total_levels, level1TaskCount: r.level1_task_count }
				: backfilledShapes.get(r.id)!;

		const excluded = exclusionsByRep.get(r.id);
		const filteredVariations = variationsByRep.get(r.id) ?? [];
		const effectiveShape = excluded ? repertoireShape(filterVariations(filteredVariations, excluded), r.chunk_size) : naturalShape;

		const shape: RepertoireShape = {
			...effectiveShape,
			totalLevels: Math.min(effectiveShape.totalLevels, r.practice_depth_levels)
		};
		const progress = repertoireProgressFromShape(shape, rowByRep.get(r.id) ?? null);
		return {
			id: r.id,
			name: r.name,
			color: r.color,
			...progress,
			fullVariationCount: naturalShape.totalVariations,
			excludedVariationCount: excluded?.size ?? 0,
			hasChapters: r.has_chapters ?? backfilledHasChapters.get(r.id)!
		};
	});
```

Note what this deliberately does NOT change: `repertoireProgressFromShape` still operates on the WHOLE repertoire's shape here (not narrowed to `[activeVariation]`), same as before this plan — the picker's summary card shows the repertoire's overall natural level count, which was already true today and isn't part of this plan's scope (only the detail page, via `buildPracticeView`, narrows to the active variation). If a future pass wants the picker card to also show "Variation M of N" instead, `variationSequenceProgress` (Task 4) is already available to call here.

- [ ] **Step 3: Run the full test suite and type checker**

Run: `npx vitest run && npm run check`
Expected: PASS, zero type errors anywhere in the project.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/repertoire-progress.ts
git commit -m "feat: read chunk_size when computing repertoire progress summaries"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, zero failures, across every file touched in Tasks 1-9.

- [ ] **Step 2: Run the type checker**

Run: `npm run check`
Expected: zero errors (per `CLAUDE.md`, this is the hard gate before pushing to `main`).

- [ ] **Step 3: Manually verify sequential unlocking end-to-end**

With `npm run dev` running and Task 1's migration confirmed applied: open a repertoire with at least 2 variations on `/practice/[id]`. Fully clear the first variation's levels (playing correctly through every level) and confirm:
- The board immediately starts quizzing the SECOND variation's own Level 1 content, not a mix of both.
- `LevelList`'s level count changes to reflect the second variation's own natural depth (it may differ from the first variation's).
- After both variations are mastered, the "Repertoire Mastered!" screen still appears correctly.

- [ ] **Step 4: Manually verify chunk_size is configurable**

Directly update one repertoire's `chunk_size` in the Supabase dashboard (e.g. from 3 to 5) and confirm on next load that its levels now cover 5 moves each instead of 3 (check `data.totalLevels` shrinks accordingly for the same variation).

- [ ] **Step 5: File a follow-up cleanup issue for the now-dead branch-alternative code path**

```bash
gh issue create --repo tomyka/mychess --title "Remove now-unreachable branch-alternative/continue code after variation-sequenced practice" --body "$(cat <<'EOF'
Since docs/superpowers/plans/2026-08-13-variation-sequenced-practice-depth.md, every splitAttempt/alternativesAt call site only ever passes a single-element [activeVariation] array, so alternativesAt always returns [] in production and continueFromBranch/`/api/practice/continue` are unreachable from the client. Kept in place (not deleted) by that plan to keep its diff small and low-risk.

Follow-up: decide whether to delete this dead code outright, or repurpose it for a future teach-pass/test-pass redesign (see docs/superpowers/specs/2026-08-13-mastery-per-variation-practice-redesign-prd.md) before removing it.
EOF
)"
```

- [ ] **Step 6: Refactor pass**

Per `CLAUDE.md`'s "after finishing a major feature" convention: re-read every file touched in Tasks 1-9 for duplicated logic, dead code, or drift from the pure-logic-in-`lib`/I-O-in-`lib/server` split. Fix anything cheap inline; file a GitHub issue for anything bigger (beyond the one already filed in Step 5).

- [ ] **Step 7: Push**

```bash
git push
```

(Per this repo's convention — production is the test environment and there are no other users yet — push directly to `main` without asking first, per `CLAUDE.md`.)

---

## Post-plan reminders

- Task 1's migration requires the user to take a manual action outside this plan's control (running SQL in the Supabase dashboard). Do not mark the overall feature done until the user has confirmed it.
- This plan deliberately leaves the UI (`+page.svelte`, `LevelList.svelte`) unchanged beyond what falls out automatically from `buildPracticeView`'s new scoping. A follow-up plan should: expose `chunk_size` as an editable setting (alongside the existing practice-depth control), surface `variationsMastered`/`totalVariationsInSequence` ("Variation 3 of 12") somewhere in the detail page, and revisit whether `LevelList`'s copy still reads correctly now that it describes the active variation rather than the whole repertoire.
- GitHub issue #60 should get a comment once this ships, summarizing that the "configurable depth, no full-repertoire leveling" half of the PRD is done, and that the teach-pass/test-pass UX redesign is still open.
