# Level Gauntlet & Demotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Practice's purely-additive, one-directional leveling (`move_progress`-derived, 3-move chunks) with an explicit, persisted gauntlet: 2-move chunks, a sliding 2-level review window, a 3-strikes demotion back a level on repeated review mistakes, and a level only "mastered" once every one of its tasks clears with zero mistakes in a real FIFO-with-requeue queue.

**Architecture:** `src/lib/mastery/levels.ts` keeps pure level-depth math (now 2-move chunks) but drops the functions that derived a level from permanent move-history (`isSatisfied`/`currentLevel`/`activeLevel` — dead once level state is explicit). A new pure module, `src/lib/mastery/levelProgress.ts`, owns the run state machine (build/reconcile a task queue, resolve one attempt's outcome — clear/requeue/demote/level-up). `src/lib/mastery/practice.ts`'s `splitAttempt` grows a sliding auto-play boundary and tags each quiz step with which level's material it belongs to. A new table, `level_progress`, persists one row per (player, repertoire); `src/lib/server/level-progress.ts` and a new `src/routes/api/practice/attempt` endpoint replace the old per-move `move_progress` write path with one POST per completed attempt. `move_progress` itself is left in place, unused, per this repo's non-destructive migration convention.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Supabase/Postgres, vitest.

**Spec:** `docs/superpowers/specs/2026-08-07-level-gauntlet-mastery-design.md`

---

### Task 1: `levels.ts` — 2-move chunks, export `taskKey`, drop dead derivation functions

**Files:**
- Modify: `mychess/src/lib/mastery/levels.ts`
- Test: `mychess/src/lib/mastery/levels.test.ts`

- [ ] **Step 1: Replace the test file**

Replace the full contents of `mychess/src/lib/mastery/levels.test.ts`:

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
	it('is a uniform 2-move chunk per level, with no fixed ceiling', () => {
		expect(levelDepth(1)).toBe(2);
		expect(levelDepth(2)).toBe(4);
		expect(levelDepth(3)).toBe(6);
		expect(levelDepth(10)).toBe(20);
	});
});

describe('targetDepth', () => {
	it('is the level depth when the variation is longer', () => {
		expect(targetDepth({ playerMoveCount: 12 }, 2)).toBe(4);
	});

	it("is the variation's own length when shorter than the level depth", () => {
		expect(targetDepth({ playerMoveCount: 2 }, 2)).toBe(2);
	});
});

describe('taskKey', () => {
	it('is the move id the target-depth prefix ends on', () => {
		const v = variation(4, 'v1-');
		expect(taskKey(v, 1)).toBe('v1-p2'); // depth 2 -> ends on the 2nd player move
		expect(taskKey(v, 2)).toBe('v1-p4'); // depth 4 -> ends on the 4th
	});

	it("falls back to the variation's own last move once its length caps the target", () => {
		const v = variation(2, 'short-');
		expect(taskKey(v, 5)).toBe('short-p2');
	});
});

describe('levelTaskVariations', () => {
	it('drops a variation once a strictly earlier level already fully covers it', () => {
		const short = variation(2, 'short-'); // fully covered by level 1 (depth 2)
		const long = variation(6, 'long-');
		expect(levelTaskVariations([short, long], 1).map((v) => v.playerMoveCount)).toEqual([2, 6]);
		expect(levelTaskVariations([short, long], 2)).toEqual([long]);
	});

	it('counts a variation exactly at a level boundary as ending there, not continuing', () => {
		const exact = variation(2, 'exact-'); // ends precisely at level 1's depth
		expect(levelTaskVariations([exact], 1)).toEqual([exact]);
		expect(levelTaskVariations([exact], 2)).toEqual([]);
	});

	it('collapses variations sharing an identical prefix at this level into one task', () => {
		const shared: { moveId: string; isPlayerTurn: boolean }[] = [];
		for (let i = 1; i <= 2; i++) {
			shared.push({ moveId: `s-p${i}`, isPlayerTurn: true });
			shared.push({ moveId: `s-o${i}`, isPlayerTurn: false });
		}
		const a = { playerMoveCount: 3, path: [...shared, { moveId: 'a-p3', isPlayerTurn: true }] };
		const b = { playerMoveCount: 3, path: [...shared, { moveId: 'b-p3', isPlayerTurn: true }] };
		expect(levelTaskVariations([a, b], 1).length).toBe(1); // identical through level 1's depth (2)
		expect(levelTaskVariations([a, b], 2).length).toBe(2); // diverge at move 3, level 2's depth
	});

	it("does not collapse variations that already differ within this level's own depth", () => {
		const a = variation(3, 'a-');
		const b = variation(3, 'b-');
		expect(levelTaskVariations([a, b], 1).length).toBe(2);
	});
});

describe('levelCap', () => {
	it('is 0 for an empty variation list', () => {
		expect(levelCap([])).toBe(0);
	});

	it('rounds up to the nearest 2-move chunk covering the longest variation', () => {
		expect(levelCap([variation(4, 'a-')])).toBe(2); // ceil(4/2) = 2
		expect(levelCap([variation(9, 'b-')])).toBe(5); // ceil(9/2) = 5
	});

	it('is driven by the longest variation among several', () => {
		expect(levelCap([variation(2, 'short-'), variation(7, 'long-')])).toBe(4); // ceil(7/2) = 4
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/levels.test.ts`
Expected: FAIL — `taskKey` is not exported by `./levels` (and several expectations mismatch the old 3-move-chunk values).

- [ ] **Step 3: Replace the implementation**

Replace the full contents of `mychess/src/lib/mastery/levels.ts`:

```ts
// mychess/src/lib/mastery/levels.ts
/**
 * Levels are uniform 2-move chunks with no fixed ceiling: L*n* covers the
 * player's own moves 1 through 2*n*.
 */
export type Level = number;

type VariationLike = {
	playerMoveCount: number;
	path: { moveId: string; isPlayerTurn: boolean }[];
};

const MOVES_PER_LEVEL = 2;

export function levelDepth(level: Level): number {
	return level * MOVES_PER_LEVEL;
}

/** The depth this variation must reach at this level — capped by its own natural length. */
export function targetDepth(variation: { playerMoveCount: number }, level: Level): number {
	return Math.min(variation.playerMoveCount, levelDepth(level));
}

/**
 * The move a variation's target-depth prefix ends on, at `level` — the
 * stable identity of the "task" a level presents. The moves table is a
 * shared tree, so two variations that reach the same move id here have an
 * identical path up to this depth: solving one solves both.
 */
export function taskKey(variation: VariationLike, level: Level): string {
	const target = targetDepth(variation, level);
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
export function levelTaskVariations(variations: VariationLike[], level: Level): VariationLike[] {
	const relevant = variations.filter((v) => v.playerMoveCount > levelDepth(level - 1));
	const seen = new Map<string, VariationLike>();
	for (const v of relevant) {
		const key = taskKey(v, level);
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
export function levelCap(variations: VariationLike[]): number {
	return Math.ceil(maxPlayerMoveCount(variations) / MOVES_PER_LEVEL);
}
```

Note: `isSatisfied`, `currentLevel`, and `activeLevel` are deleted — under the new design, "which level is active" is explicit persisted state (`level_progress.level`), never derived from move-correctness history, so nothing calls these anymore.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mychess && npx vitest run src/lib/mastery/levels.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/mastery/levels.ts src/lib/mastery/levels.test.ts
git commit -m "feat: 2-move level chunks, export taskKey, drop history-derived level functions"
```

---

### Task 2: `practice.ts` — sliding review window, band tagging, queue-based picking

**Files:**
- Modify: `mychess/src/lib/mastery/practice.ts`
- Test: `mychess/src/lib/mastery/practice.test.ts`

**Depends on Task 1** (`taskKey`, new `levelDepth`).

- [ ] **Step 1: Replace the test file**

Replace the full contents of `mychess/src/lib/mastery/practice.test.ts`:

```ts
// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { pickQueuedAttempt, pickReviewAttempt, splitAttempt } from './practice';
import { taskKey } from './levels';
import type { Variation, VariationStep } from './variations';

function makeVariation(playerMoveCount: number, prefix: string): Variation {
	const path: VariationStep[] = [];
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

describe('pickQueuedAttempt', () => {
	it('returns null when every queue entry is cleared', () => {
		const v = makeVariation(3, 'done-');
		const queue = [{ key: taskKey(v, 1), status: 'cleared' as const }];
		expect(pickQueuedAttempt([v], 1, queue)).toBeNull();
	});

	it('returns null for an empty queue', () => {
		expect(pickQueuedAttempt([], 1, [])).toBeNull();
	});

	it('picks the variation behind the first pending queue entry and computes its target depth', () => {
		const a = makeVariation(10, 'a-');
		const b = makeVariation(10, 'b-');
		const queue = [
			{ key: taskKey(a, 2), status: 'cleared' as const },
			{ key: taskKey(b, 2), status: 'pending' as const }
		];
		const result = pickQueuedAttempt([a, b], 2, queue);
		expect(result).not.toBeNull();
		expect(result!.variation.leafMoveId).toBe(b.leafMoveId);
		expect(result!.targetDepth).toBe(4); // level 2 depth
		expect(result!.taskKey).toBe(taskKey(b, 2));
	});

	it('always picks the front pending entry, regardless of how many others are pending', () => {
		const a = makeVariation(4, 'a-');
		const b = makeVariation(4, 'b-');
		const queue = [
			{ key: taskKey(a, 1), status: 'pending' as const },
			{ key: taskKey(b, 1), status: 'pending' as const }
		];
		const result = pickQueuedAttempt([a, b], 1, queue);
		expect(result!.variation.leafMoveId).toBe(a.leafMoveId);
	});
});

describe('pickReviewAttempt', () => {
	it('picks among variations with quiz content at the level, regardless of queue state', () => {
		const v = makeVariation(6, 'r1-');
		const result = pickReviewAttempt([v], 1, () => 0);
		expect(result).not.toBeNull();
		expect(result!.variation.leafMoveId).toBe(v.leafMoveId);
		expect(result!.targetDepth).toBe(2); // level 1 depth
	});

	it("excludes variations naturally shorter than the level's starting point", () => {
		const short = makeVariation(2, 'short-'); // no content left at level 2 (starts at move 3)
		const long = makeVariation(6, 'long-');
		const result = pickReviewAttempt([short, long], 2, () => 0);
		expect(result!.variation.leafMoveId).toBe(long.leafMoveId);
	});

	it('returns null when no variation has content at the level', () => {
		const v = makeVariation(2, 'v-');
		expect(pickReviewAttempt([v], 2)).toBeNull();
	});
});

describe('splitAttempt', () => {
	it('at level 1, auto-plays nothing and every quiz step is in the "current" band', () => {
		const v = makeVariation(4, 'x-');
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 2);
		expect(prefix).toHaveLength(0);
		expect(quizSteps.map((s) => s.moveId)).toEqual(['x-p1', 'x-o1', 'x-p2']);
		expect(quizSteps.every((s) => s.band === 'current')).toBe(true);
	});

	it('at level 2, auto-plays nothing and asks both level 1 (previous) and level 2 (current) material', () => {
		const v = makeVariation(6, 'y-');
		const { prefix, quizSteps } = splitAttempt(v.path, 2, 4);
		expect(prefix).toHaveLength(0);
		expect(quizSteps.map((s) => s.moveId)).toEqual(['y-p1', 'y-o1', 'y-p2', 'y-o2', 'y-p3', 'y-o3', 'y-p4']);
		expect(quizSteps.find((s) => s.moveId === 'y-p1')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'y-p2')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'y-p3')!.band).toBe('current');
		expect(quizSteps.find((s) => s.moveId === 'y-p4')!.band).toBe('current');
	});

	it('at level 3, auto-plays level 1 and asks level 2 (previous) plus level 3 (current)', () => {
		const v = makeVariation(6, 'z-');
		const { prefix, quizSteps } = splitAttempt(v.path, 3, 6);
		expect(prefix.map((s) => s.moveId)).toEqual(['z-p1', 'z-o1', 'z-p2', 'z-o2']);
		expect(quizSteps[0].moveId).toBe('z-p3');
		expect(quizSteps.find((s) => s.moveId === 'z-p3')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'z-p4')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'z-p5')!.band).toBe('current');
		expect(quizSteps.find((s) => s.moveId === 'z-p6')!.band).toBe('current');
	});

	it("collapses to the variation's own length when shorter than the level depth", () => {
		const v = makeVariation(2, 'w-');
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 2); // targetDepth = min(2,2) = 2
		expect(prefix).toHaveLength(0);
		expect(quizSteps[quizSteps.length - 1].moveId).toBe('w-p2');
	});

	it("throws when the level's auto-play boundary is not below the target depth", () => {
		const v = makeVariation(2, 'w2-');
		expect(() => splitAttempt(v.path, 1, 2)).not.toThrow(); // sanity: valid at level 1
		// At level 3 the auto-play boundary (2) is not below a target depth of
		// 2 — this 2-move variation has no interactive room left at level 3
		// and should never have been picked by pickQueuedAttempt in the first place.
		expect(() => splitAttempt(v.path, 3, 2)).toThrow();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — `pickQueuedAttempt` is not exported, and `band` is `undefined` on quiz steps.

- [ ] **Step 3: Replace the implementation**

Replace the full contents of `mychess/src/lib/mastery/practice.ts`:

```ts
// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { targetDepth, levelDepth, taskKey, levelTaskVariations, type Level } from './levels';

export type QuizStep = VariationStep & { band: 'previous' | 'current' };

export type PracticeAttempt = {
	variation: Variation;
	targetDepth: number;
	taskKey: string;
};

/**
 * Picks the variation behind the first `pending` entry in the level's queue
 * — a real FIFO-with-requeue sequence, not a random pick, since a mistake
 * sends a task to the back (see `levelProgress.ts`'s `resolveAttempt`).
 * Returns null once every entry is `cleared` (the caller should have
 * promoted the level before reaching here) or the queue is empty.
 */
export function pickQueuedAttempt(
	variations: Variation[],
	level: Level,
	queue: { key: string; status: 'pending' | 'cleared' }[]
): PracticeAttempt | null {
	const nextKey = queue.find((entry) => entry.status === 'pending')?.key;
	if (nextKey === undefined) return null;

	const tasks = levelTaskVariations(variations, level) as Variation[];
	const variation = tasks.find((v) => taskKey(v, level) === nextKey);
	if (!variation) return null;

	return { variation, targetDepth: targetDepth(variation, level), taskKey: nextKey };
}

/**
 * Splits a variation's path into the auto-played `prefix` and the
 * `quizSteps` the player walks through interactively. The quiz window is
 * always the CURRENT level plus the one before it (a live review of the
 * previous level's material) — anything older auto-plays. At active level
 * *n*, moves 1 through 2(n-2) auto-play (book line, both colors); the player
 * answers from 2(n-2)+1 through the target depth. Each quiz step is tagged
 * `band: 'previous'` (review material — counts toward demotion, see
 * `levelProgress.ts`) or `'current'` (the level's own new material).
 */
export function splitAttempt(
	path: VariationStep[],
	level: Level,
	targetDepthValue: number
): { prefix: VariationStep[]; quizSteps: QuizStep[] } {
	const playerIndices: number[] = [];
	path.forEach((step, i) => {
		if (step.isPlayerTurn) playerIndices.push(i);
	});

	const startPoint = levelDepth(Math.max(level - 2, 0)); // moves before this auto-play
	const previousLevelDepth = levelDepth(level - 1); // review-band ceiling
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
		return { ...step, band: playerMovesSeen <= previousLevelDepth ? 'previous' : 'current' };
	});

	return {
		prefix: path.slice(0, nextPlayerIdx),
		quizSteps
	};
}

/**
 * Picks a random variation with quiz content at `level`, ignoring queue
 * state — used to review a level the player has already passed. Read-only:
 * review never reports a result back, so it never touches `level_progress`.
 */
export function pickReviewAttempt(
	variations: Variation[],
	level: Level,
	random: () => number = Math.random
): PracticeAttempt | null {
	const candidates = variations.filter((v) => v.playerMoveCount > levelDepth(level - 1));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	return { variation: chosen, targetDepth: targetDepth(chosen, level), taskKey: taskKey(chosen, level) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
cd mychess
git add src/lib/mastery/practice.ts src/lib/mastery/practice.test.ts
git commit -m "feat: sliding 2-level review window with band tagging, queue-based attempt picking"
```

---

### Task 3: `levelProgress.ts` — queue build/reconcile/resolve, replaces `moveProgress.ts`

**Files:**
- Create: `mychess/src/lib/mastery/levelProgress.ts`
- Create: `mychess/src/lib/mastery/levelProgress.test.ts`
- Delete: `mychess/src/lib/mastery/moveProgress.ts`
- Delete: `mychess/src/lib/mastery/moveProgress.test.ts`

**Depends on Task 1** (`levelCap`, `levelTaskVariations`, `taskKey`).

- [ ] **Step 1: Write the new test file**

Create `mychess/src/lib/mastery/levelProgress.test.ts`:

```ts
// mychess/src/lib/mastery/levelProgress.test.ts
import { describe, it, expect } from 'vitest';
import {
	buildQueue,
	reconcileQueue,
	resolveAttempt,
	syncLevelProgress,
	repertoireProgress,
	type LevelProgressRow
} from './levelProgress';
import { taskKey } from './levels';
import type { Variation } from './variations';

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

describe('buildQueue', () => {
	it('creates one pending entry per task at the level', () => {
		const a = variation(2, 'a-');
		const b = variation(6, 'b-');
		const queue = buildQueue([a, b], 1, () => 0);
		expect(queue).toHaveLength(2);
		expect(queue.every((e) => e.status === 'pending')).toBe(true);
	});

	it('shuffles using the injected random source', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const c = variation(2, 'c-');
		// random() always 0 -> Fisher-Yates walks the array end-to-start,
		// always swapping with index 0, ending on [b, c, a].
		const queue = buildQueue([a, b, c], 1, () => 0);
		expect(queue.map((e) => e.key)).toEqual([taskKey(b, 1), taskKey(c, 1), taskKey(a, 1)]);
	});
});

describe('reconcileQueue', () => {
	it('drops a queue entry whose task no longer exists', () => {
		const a = variation(2, 'a-');
		const queue = [
			{ key: taskKey(a, 1), status: 'pending' as const },
			{ key: 'stale-key', status: 'pending' as const }
		];
		expect(reconcileQueue(queue, [a], 1)).toEqual([{ key: taskKey(a, 1), status: 'pending' }]);
	});

	it('appends a newly-appearing task as pending, keeping existing order', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const queue = [{ key: taskKey(a, 1), status: 'cleared' as const }];
		expect(reconcileQueue(queue, [a, b], 1)).toEqual([
			{ key: taskKey(a, 1), status: 'cleared' },
			{ key: taskKey(b, 1), status: 'pending' }
		]);
	});
});

describe('resolveAttempt', () => {
	it('marks a clean attempt cleared in place', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1), status: 'pending' },
				{ key: taskKey(b, 1), status: 'pending' }
			]
		};
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false, prevLevelMistakeCount: 0 }, [a, b]);
		expect(next.queue).toEqual([
			{ key: taskKey(a, 1), status: 'cleared' },
			{ key: taskKey(b, 1), status: 'pending' }
		]);
		expect(next.level).toBe(1);
	});

	it('requeues a dirty attempt to the back instead of clearing it', () => {
		const a = variation(2, 'a-');
		const b = variation(2, 'b-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1), status: 'pending' },
				{ key: taskKey(b, 1), status: 'pending' }
			]
		};
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: true, prevLevelMistakeCount: 0 }, [a, b]);
		expect(next.queue).toEqual([
			{ key: taskKey(b, 1), status: 'pending' },
			{ key: taskKey(a, 1), status: 'pending' }
		]);
	});

	it('advances to the next level, with a fresh queue, once every task clears', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false, prevLevelMistakeCount: 0 }, [a], () => 0);
		expect(next.level).toBe(2);
		expect(next.prevLevelMistakes).toBe(0);
		expect(next.queue).toEqual([{ key: taskKey(a, 2), status: 'pending' }]);
	});

	it('becomes mastered past the level cap, keeping the cleared queue', () => {
		const a = variation(2, 'a-'); // 1-level repertoire (cap = 1)
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: false, prevLevelMistakeCount: 0 }, [a]);
		expect(next.level).toBe(2); // cap(1) + 1 — sentinel for "mastered"
		expect(next.queue).toEqual([{ key: taskKey(a, 1), status: 'cleared' }]);
	});

	it('demotes a level back down at 3 accumulated previous-band mistakes, discarding its queue', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = {
			level: 2,
			prevLevelMistakes: 2,
			queue: [{ key: taskKey(a, 2), status: 'pending' }]
		};
		const next = resolveAttempt(row, { taskKey: taskKey(a, 2), hadMistake: true, prevLevelMistakeCount: 1 }, [a], () => 0);
		expect(next.level).toBe(1);
		expect(next.prevLevelMistakes).toBe(0);
		expect(next.queue).toEqual([{ key: taskKey(a, 1), status: 'pending' }]);
	});

	it('never demotes below level 1', () => {
		const a = variation(10, 'a-');
		const row: LevelProgressRow = { level: 1, prevLevelMistakes: 2, queue: [{ key: taskKey(a, 1), status: 'pending' }] };
		const next = resolveAttempt(row, { taskKey: taskKey(a, 1), hadMistake: true, prevLevelMistakeCount: 1 }, [a]);
		expect(next.level).toBe(1);
		expect(next.prevLevelMistakes).toBe(3);
	});
});

describe('syncLevelProgress', () => {
	it('reconciles a stale queue and advances immediately if that makes it fully cleared', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = {
			level: 1,
			prevLevelMistakes: 0,
			queue: [
				{ key: taskKey(a, 1), status: 'cleared' },
				{ key: 'removed-task', status: 'pending' }
			]
		};
		const next = syncLevelProgress(row, [a], () => 0);
		expect(next.level).toBe(2); // cap(1)+1, mastered
	});

	it('leaves an already-mastered row untouched', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'cleared' }] };
		expect(syncLevelProgress(row, [a])).toEqual(row);
	});
});

describe('repertoireProgress', () => {
	it('is "mastered" vacuously for a repertoire with no variations', () => {
		expect(repertoireProgress([], null)).toEqual({
			level: 'mastered',
			totalVariations: 0,
			totalLevels: 0,
			levelTaskCount: 0,
			levelSolvedCount: 0
		});
	});

	it('defaults to a fresh level 1 when no row exists yet', () => {
		const a = variation(6, 'a-');
		const progress = repertoireProgress([a], null);
		expect(progress.level).toBe(1);
		expect(progress.totalLevels).toBe(3); // ceil(6/2)
		expect(progress.levelTaskCount).toBe(1);
		expect(progress.levelSolvedCount).toBe(0);
	});

	it('reports the row level/queue directly when one exists', () => {
		const a = variation(6, 'a-');
		const b = variation(6, 'b-');
		const row: LevelProgressRow = {
			level: 2,
			prevLevelMistakes: 1,
			queue: [
				{ key: taskKey(a, 2), status: 'cleared' },
				{ key: taskKey(b, 2), status: 'pending' }
			]
		};
		const progress = repertoireProgress([a, b], row);
		expect(progress.level).toBe(2);
		expect(progress.levelTaskCount).toBe(2);
		expect(progress.levelSolvedCount).toBe(1);
	});

	it('reports "mastered" once the row level exceeds the cap', () => {
		const a = variation(2, 'a-');
		const row: LevelProgressRow = { level: 2, prevLevelMistakes: 0, queue: [{ key: taskKey(a, 1), status: 'cleared' }] };
		const progress = repertoireProgress([a], row);
		expect(progress.level).toBe('mastered');
		expect(progress.levelTaskCount).toBe(1);
		expect(progress.levelSolvedCount).toBe(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mychess && npx vitest run src/lib/mastery/levelProgress.test.ts`
Expected: FAIL — cannot find module `./levelProgress`.

- [ ] **Step 3: Write the implementation**

Create `mychess/src/lib/mastery/levelProgress.ts`:

```ts
// mychess/src/lib/mastery/levelProgress.ts
import type { Variation } from './variations';
import { levelCap, levelTaskVariations, taskKey, type Level } from './levels';

export type QueueEntry = { key: string; status: 'pending' | 'cleared' };
export type LevelProgressRow = { level: number; prevLevelMistakes: number; queue: QueueEntry[] };
export type AttemptResult = { taskKey: string; hadMistake: boolean; prevLevelMistakeCount: number };

export type RepertoireProgress = {
	level: Level | 'mastered';
	totalVariations: number;
	totalLevels: number;
	levelTaskCount: number;
	levelSolvedCount: number;
};

const DEMOTION_THRESHOLD = 3;

/** A freshly shuffled, all-pending queue for every task at `level`. */
export function buildQueue(
	variations: Variation[],
	level: Level,
	random: () => number = Math.random
): QueueEntry[] {
	const keys = levelTaskVariations(variations, level).map((v) => taskKey(v, level));
	for (let i = keys.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[keys[i], keys[j]] = [keys[j], keys[i]];
	}
	return keys.map((key) => ({ key, status: 'pending' as const }));
}

/**
 * Reconciles a stored queue against the level's freshly-enumerated tasks —
 * handles a repertoire edited after a run started. Tasks no longer present
 * are dropped; newly-appearing tasks are appended as pending. Existing
 * entries (and their `cleared`/`pending` status) keep their position.
 */
export function reconcileQueue(queue: QueueEntry[], variations: Variation[], level: Level): QueueEntry[] {
	const freshKeys = new Set(levelTaskVariations(variations, level).map((v) => taskKey(v, level)));
	const kept = queue.filter((entry) => freshKeys.has(entry.key));
	const keptKeys = new Set(kept.map((entry) => entry.key));
	const added = [...freshKeys]
		.filter((key) => !keptKeys.has(key))
		.map((key) => ({ key, status: 'pending' as const }));
	return [...kept, ...added];
}

function isFullyCleared(queue: QueueEntry[]): boolean {
	return queue.every((entry) => entry.status === 'cleared');
}

/**
 * Advances a row whose queue is fully cleared to the next level, or — past
 * the repertoire's level cap — leaves it as a mastered terminal state,
 * keeping the just-cleared queue so the UI can still show "M/M solved"
 * instead of resetting to an empty 0/0.
 */
function advanceIfCleared(
	row: LevelProgressRow,
	variations: Variation[],
	cap: number,
	random: () => number
): LevelProgressRow {
	if (!isFullyCleared(row.queue)) return row;
	const nextLevel = row.level + 1;
	if (nextLevel > cap) return { ...row, level: nextLevel };
	return { level: nextLevel, prevLevelMistakes: 0, queue: buildQueue(variations, nextLevel, random) };
}

/**
 * Reconciles `row`'s queue against the current repertoire content and, if
 * that leaves it fully cleared, advances the level. Run on every load,
 * before serving an attempt, to absorb a repertoire edited after a run
 * started.
 */
export function syncLevelProgress(
	row: LevelProgressRow,
	variations: Variation[],
	random: () => number = Math.random
): LevelProgressRow {
	const cap = levelCap(variations);
	if (row.level > cap) return row; // already mastered — nothing to reconcile
	const reconciled = { ...row, queue: reconcileQueue(row.queue, variations, row.level) };
	return advanceIfCleared(reconciled, variations, cap, random);
}

/**
 * Applies one completed attempt's outcome to a level's run: accumulates
 * previous-level-band mistakes (demoting a level at the 3-strikes threshold
 * and discarding the departing level's queue), or marks the attempted task
 * cleared — requeuing it to the back on a mistake instead — advancing to
 * the next level once every task is cleared. There's nothing to demote
 * below level 1: no `previous` band exists there, so its mistake count
 * never actually matters, even though it can keep growing.
 */
export function resolveAttempt(
	row: LevelProgressRow,
	result: AttemptResult,
	variations: Variation[],
	random: () => number = Math.random
): LevelProgressRow {
	const cap = levelCap(variations);
	const prevLevelMistakes = row.prevLevelMistakes + result.prevLevelMistakeCount;

	if (prevLevelMistakes >= DEMOTION_THRESHOLD && row.level > 1) {
		const demotedLevel = row.level - 1;
		return { level: demotedLevel, prevLevelMistakes: 0, queue: buildQueue(variations, demotedLevel, random) };
	}

	const queue = row.queue.map((entry) =>
		entry.key === result.taskKey && !result.hadMistake ? { ...entry, status: 'cleared' as const } : entry
	);
	const reordered = result.hadMistake
		? [...queue.filter((e) => e.key !== result.taskKey), queue.find((e) => e.key === result.taskKey)!]
		: queue;

	return advanceIfCleared({ level: row.level, prevLevelMistakes, queue: reordered }, variations, cap, random);
}

/**
 * Combines a repertoire's enumerated variations with its `level_progress`
 * row (or `null` if the player hasn't started it yet) into the summary both
 * `/practice` (the picker) and `/practice/[repertoire_id]` (the detail
 * screen) need. Read-only — never reconciles or persists; that's
 * `syncLevelProgress`'s job.
 */
export function repertoireProgress(variations: Variation[], row: LevelProgressRow | null): RepertoireProgress {
	const totalLevels = levelCap(variations);
	if (variations.length === 0) {
		return { level: 'mastered', totalVariations: 0, totalLevels: 0, levelTaskCount: 0, levelSolvedCount: 0 };
	}
	if (!row) {
		return {
			level: 1,
			totalVariations: variations.length,
			totalLevels,
			levelTaskCount: levelTaskVariations(variations, 1).length,
			levelSolvedCount: 0
		};
	}
	return {
		level: row.level > totalLevels ? 'mastered' : row.level,
		totalVariations: variations.length,
		totalLevels,
		levelTaskCount: row.queue.length,
		levelSolvedCount: row.queue.filter((e) => e.status === 'cleared').length
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mychess && npx vitest run src/lib/mastery/levelProgress.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Delete the superseded module**

```bash
cd mychess
git rm src/lib/mastery/moveProgress.ts src/lib/mastery/moveProgress.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd mychess
git add src/lib/mastery/levelProgress.ts src/lib/mastery/levelProgress.test.ts
git commit -m "feat: add levelProgress.ts (queue build/reconcile/resolve), replace moveProgress.ts"
```

---

### Task 4: Migration — `level_progress` table

**Files:**
- Create: `mychess/supabase/migrations/0028_level_progress.sql`

- [ ] **Step 1: Write the migration**

Create `mychess/supabase/migrations/0028_level_progress.sql`:

```sql
-- mychess/supabase/migrations/0028_level_progress.sql
-- Explicit, persisted per-(player, repertoire) leveling run — replaces
-- move_progress-derived leveling for Practice (see
-- docs/superpowers/specs/2026-08-07-level-gauntlet-mastery-design.md).
--
-- Unlike move_progress's permanent "ever correct" fact set, the new rules
-- (a 3-strikes demotion counter, a FIFO-with-requeue task queue, "mastered
-- only with zero mistakes this run") are inherently sequential and can't be
-- recovered from a snapshot of history — this table stores the run
-- explicitly instead of deriving it.
--
-- move_progress: kept, untouched, simply stops being written to — matches
-- this codebase's established non-destructive convention.
create table public.level_progress (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null references public.profiles(id) on delete cascade,
  repertoire_id       uuid not null references public.repertoires(id) on delete cascade,
  level               int not null default 1,
  prev_level_mistakes int not null default 0,
  queue               jsonb not null default '[]'::jsonb,
  updated_at          timestamptz not null default now(),
  unique(player_id, repertoire_id)
);

alter table public.level_progress enable row level security;

create policy "level_progress_player_all" on public.level_progress
  for all using (player_id = auth.uid());

revoke all on public.level_progress from anon, public;
```

- [ ] **Step 2: Commit**

```bash
cd mychess
git add supabase/migrations/0028_level_progress.sql
git commit -m "feat: add level_progress migration"
```

- [ ] **Step 3: Hand off to the user**

Per this repo's convention (no local Postgres, no working service-role key in this environment), paste the migration's contents to the user and ask them to run it in the Supabase dashboard SQL editor (or trigger the `migrate.yml` GitHub Action) before Task 7's endpoint or Task 9's page load are exercised against production.

---

### Task 5: `practice-repertoire.ts` — shared repertoire+variations loader

**Files:**
- Create: `mychess/src/lib/server/practice-repertoire.ts`

This extracts the authorization + move-fetch block that both the practice detail page's load (Task 9) and the new attempt endpoint (Task 7) need, so the two can't drift apart. Not independently unit-tested — matches this codebase's convention of not testing thin Supabase I/O wrappers directly (see `CLAUDE.md`).

- [ ] **Step 1: Write the file**

Create `mychess/src/lib/server/practice-repertoire.ts`:

```ts
// mychess/src/lib/server/practice-repertoire.ts
import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mergeRepertoireIds } from '$lib/repertoire';
import { enumerateVariations, type RawMoveRow, type Variation } from '$lib/mastery/variations';

export type PracticeRepertoire = { id: string; name: string; color: string };

/**
 * Loads a repertoire a player can access (owned or coach-assigned) plus its
 * enumerated variations, or throws a 404 — the same authorization + move
 * fetch both the practice detail page's load and its attempt-reporting
 * endpoint need.
 */
export async function loadRepertoireVariations(
	supabase: SupabaseClient,
	userId: string,
	repertoireId: string
): Promise<{ repertoire: PracticeRepertoire; variations: Variation[] }> {
	const [{ data: ownReps }, { data: assigned }] = await Promise.all([
		supabase.from('repertoires').select('id').eq('player_id', userId),
		supabase.from('assigned_repertoires').select('repertoire_id').eq('player_id', userId)
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

	return { repertoire, variations: enumerateVariations(moves) };
}
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: no new errors attributable to this file (the pre-existing OAuth-route baseline is unaffected).

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/lib/server/practice-repertoire.ts
git commit -m "feat: extract loadRepertoireVariations shared helper"
```

---

### Task 6: `level-progress.ts` — server I/O, replaces `move-progress.ts`

**Files:**
- Create: `mychess/src/lib/server/level-progress.ts`
- Delete: `mychess/src/lib/server/move-progress.ts`

**Depends on Task 3** (`levelProgress.ts`'s pure functions) **and Task 4** (the `level_progress` table).

- [ ] **Step 1: Write the file**

Create `mychess/src/lib/server/level-progress.ts`:

```ts
// mychess/src/lib/server/level-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variation } from '$lib/mastery/variations';
import {
	buildQueue,
	resolveAttempt,
	syncLevelProgress,
	type AttemptResult,
	type LevelProgressRow
} from '$lib/mastery/levelProgress';

type DbRow = { level: number; prev_level_mistakes: number; queue: unknown };

function toRow(r: DbRow): LevelProgressRow {
	return { level: r.level, prevLevelMistakes: r.prev_level_mistakes, queue: r.queue as LevelProgressRow['queue'] };
}

async function upsert(supabase: SupabaseClient, playerId: string, repertoireId: string, row: LevelProgressRow) {
	await supabase.from('level_progress').upsert(
		{
			player_id: playerId,
			repertoire_id: repertoireId,
			level: row.level,
			prev_level_mistakes: row.prevLevelMistakes,
			queue: row.queue
		},
		{ onConflict: 'player_id,repertoire_id' }
	);
}

/**
 * Loads a repertoire's level_progress row, creating a fresh Level 1 run if
 * none exists yet, then reconciles it against the repertoire's current
 * content (a coach edit since the last run) — persisting either write.
 * Returns `null` for a repertoire with no variations (vacuously mastered,
 * nothing to track).
 */
export async function loadSyncedLevelProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[]
): Promise<LevelProgressRow | null> {
	if (variations.length === 0) return null;

	const { data: existing } = await supabase
		.from('level_progress')
		.select('level, prev_level_mistakes, queue')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.maybeSingle();

	const row = existing ? toRow(existing) : { level: 1, prevLevelMistakes: 0, queue: buildQueue(variations, 1) };
	const synced = syncLevelProgress(row, variations);
	await upsert(supabase, playerId, repertoireId, synced);
	return synced;
}

/**
 * Applies a completed Practice attempt's outcome — see
 * `$lib/mastery/levelProgress.ts`'s `resolveAttempt` for the rules. Assumes
 * a row already exists (an attempt can only be reported for a level that
 * was itself served from an existing row); silently no-ops otherwise.
 */
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	result: AttemptResult,
	variations: Variation[]
): Promise<void> {
	const { data: existing, error: selectError } = await supabase
		.from('level_progress')
		.select('level, prev_level_mistakes, queue')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.single();

	if (selectError || !existing) return;

	const next = resolveAttempt(toRow(existing), result, variations);
	await upsert(supabase, playerId, repertoireId, next);
}
```

- [ ] **Step 2: Delete the superseded module**

```bash
cd mychess
git rm src/lib/server/move-progress.ts
```

- [ ] **Step 3: Type-check**

Run: `cd mychess && npm run check`
Expected: new errors only in `src/routes/api/practice/move-progress/+server.ts` (still importing the just-deleted `move-progress.ts`) — resolved in Task 7 when that route is replaced.

- [ ] **Step 4: Commit**

```bash
cd mychess
git add src/lib/server/level-progress.ts
git commit -m "feat: add level-progress.ts server I/O, replace move-progress.ts"
```

---

### Task 7: `/api/practice/attempt` — replaces the per-move endpoint

**Files:**
- Create: `mychess/src/routes/api/practice/attempt/+server.ts`
- Delete: `mychess/src/routes/api/practice/move-progress/+server.ts` (and its now-empty parent directory)

**Depends on Task 5, Task 6.**

- [ ] **Step 1: Write the endpoint**

Create `mychess/src/routes/api/practice/attempt/+server.ts`:

```ts
// mychess/src/routes/api/practice/attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyAttemptResult } from '$lib/server/level-progress';

/**
 * Called once per completed Practice attempt (not per move — see
 * docs/superpowers/specs/2026-08-07-level-gauntlet-mastery-design.md).
 * Skipped entirely during review (read-only, no progress side effects).
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { repertoireId, taskKey, hadMistake, prevLevelMistakeCount } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof taskKey !== 'string' ||
		typeof hadMistake !== 'boolean' ||
		typeof prevLevelMistakeCount !== 'number'
	) {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadRepertoireVariations(supabase, user.id, repertoireId);
	await applyAttemptResult(supabase, user.id, repertoireId, { taskKey, hadMistake, prevLevelMistakeCount }, variations);

	return json({ ok: true });
};
```

- [ ] **Step 2: Delete the superseded route**

```bash
cd mychess
git rm src/routes/api/practice/move-progress/+server.ts
rmdir src/routes/api/practice/move-progress
```

- [ ] **Step 3: Type-check**

Run: `cd mychess && npm run check`
Expected: back to only the pre-existing OAuth-route baseline errors.

- [ ] **Step 4: Commit**

```bash
cd mychess
git add src/routes/api/practice/attempt/+server.ts
git commit -m "feat: add /api/practice/attempt endpoint, replace per-move progress endpoint"
```

---

### Task 8: `repertoire-progress.ts` — rework on top of `level_progress`

**Files:**
- Modify: `mychess/src/lib/server/repertoire-progress.ts`

**Depends on Task 3.**

- [ ] **Step 1: Replace the file**

Replace the full contents of `mychess/src/lib/server/repertoire-progress.ts`:

```ts
// mychess/src/lib/server/repertoire-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations, type RawMoveRow } from '$lib/mastery/variations';
import { repertoireProgress, type RepertoireProgress, type LevelProgressRow } from '$lib/mastery/levelProgress';

export type RepertoireProgressSummary = RepertoireProgress & {
	id: string;
	name: string;
	color: string;
};

/**
 * Every repertoire a player can access (owned + assigned), each with its
 * computed mastery progress. Shared by the `/practice` picker and the
 * dashboard's mastered-repertoire count. Read-only — doesn't reconcile or
 * create `level_progress` rows (that's the detail page's job via
 * `loadSyncedLevelProgress`); a repertoire with no row yet just shows the
 * bootstrap "fresh Level 1" default.
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
	const [{ data: rawMoves }, { data: progressRows }] = await Promise.all([
		supabase
			.from('moves')
			.select('id, san, is_player_turn, repertoire_id, from_position, to_position')
			.in('repertoire_id', repIds),
		supabase
			.from('level_progress')
			.select('repertoire_id, level, prev_level_mistakes, queue')
			.eq('player_id', userId)
			.in('repertoire_id', repIds)
	]);

	// Only RepertoireProgress's fields are needed here, all derived purely
	// from moveId/isPlayerTurn — never from FEN — so the fen columns aren't
	// fetched (unlike the [repertoire_id] detail page, which needs them to
	// render the board).
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

	const rowByRep = new Map<string, LevelProgressRow>();
	for (const r of (progressRows ?? []) as any[]) {
		rowByRep.set(r.repertoire_id, { level: r.level, prevLevelMistakes: r.prev_level_mistakes, queue: r.queue });
	}

	return allReps.map((r: any) => {
		const variations = enumerateVariations(movesByRep.get(r.id) ?? []);
		const progress = repertoireProgress(variations, rowByRep.get(r.id) ?? null);
		return { id: r.id, name: r.name, color: r.color, ...progress };
	});
}
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: same baseline as Task 7 (this file has no colocated test — matches the existing convention of not directly unit-testing thin Supabase I/O wrappers).

- [ ] **Step 3: Commit**

```bash
cd mychess
git add src/lib/server/repertoire-progress.ts
git commit -m "feat: rework loadRepertoireProgressSummaries on top of level_progress"
```

---

### Task 9: Practice detail page load — rework on top of `level_progress`

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts`

**Depends on Task 2, Task 3, Task 5, Task 6.**

- [ ] **Step 1: Replace the file**

Replace the full contents of `mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts`:

```ts
// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedLevelProgress } from '$lib/server/level-progress';
import { repertoireProgress } from '$lib/mastery/levelProgress';
import { pickQueuedAttempt, pickReviewAttempt, splitAttempt } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const { repertoire, variations } = await loadRepertoireVariations(supabase, user!.id, repertoireId);
	const row = await loadSyncedLevelProgress(supabase, user!.id, repertoireId, variations);
	const { level, totalVariations, totalLevels, levelTaskCount, levelSolvedCount } = repertoireProgress(
		variations,
		row
	);

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
		taskKey: string;
	} | null = null;

	if (reviewLevel !== null) {
		const picked = pickReviewAttempt(variations, reviewLevel);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, reviewLevel, picked.targetDepth);
			attempt = { prefix, quizSteps, taskKey: picked.taskKey };
		}
	} else if (level !== 'mastered' && row) {
		const picked = pickQueuedAttempt(variations, level, row.queue);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, level, picked.targetDepth);
			attempt = { prefix, quizSteps, taskKey: picked.taskKey };
		}
	}

	return {
		repertoire,
		level,
		totalVariations,
		totalLevels,
		levelTaskCount,
		levelSolvedCount,
		attempt,
		reviewLevel
	};
};
```

Note: `satisfiedCount` is dropped — confirmed unused by any `.svelte` template (only threaded through as dead data).

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: same pre-existing baseline only.

- [ ] **Step 3: Commit**

```bash
cd mychess
git add "src/routes/(player)/practice/[repertoire_id]/+page.server.ts"
git commit -m "feat: rework practice detail load on top of level_progress"
```

---

### Task 10: Practice detail page UI — attempt-level reporting, demotion banner

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts`

**Depends on Task 2, Task 7, Task 9.**

- [ ] **Step 1: Update the component test mocks**

In `mychess/src/routes/(player)/practice/[repertoire_id]/practice.test.ts`, remove every `satisfiedCount: N,` line from the six mock `data` objects (it's dropped from the page's returned shape in Task 9; the component's `data` prop is loosely typed `any`, so nothing else needs to change in this file). Leave every other line as-is.

- [ ] **Step 2: Run the test to verify it still passes with the field removed**

Run: `cd mychess && npx vitest run "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"`
Expected: PASS (6 tests) — this file doesn't assert on `satisfiedCount`, so removing it from the mocks is a no-op for these assertions; this step just confirms that.

- [ ] **Step 3: Replace the `<script>` block**

In `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`, replace the entire `<script lang="ts">...</script>` block (the original file's lines 1-201) with:

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
	let phase = $state<'playing' | 'success' | 'leveled-up' | 'leveled-down'>('playing');
	let locked = $state(false);
	let replaying = $state(false);
	// Consecutive wrong attempts on the CURRENT quiz move — resets the moment
	// it's solved or a new attempt starts. After 3, a hint becomes available;
	// requesting it highlights the correct piece's square, never the move.
	let wrongCount = $state(0);
	let hintRequested = $state(false);
	// Whether THIS ATTEMPT (not just this move) has had any mistake yet, and
	// how many of those mistakes landed on the "previous level" review band
	// — both reset only in resetForAttempt(), and reported once when the
	// attempt finishes (see reportAttempt), not per move.
	let attemptHadMistake = $state(false);
	let attemptPrevLevelMistakes = $state(0);
	let advanceTimeout: ReturnType<typeof setTimeout> | undefined;
	// Bumped on every resetForAttempt() call so an in-flight prefix replay
	// notices it's been superseded (e.g. rapid re-navigation) and stops
	// writing to boardFen instead of racing the newer one.
	let resetToken = 0;
	// The attempt-report POST is fire-and-forget from handleMove's final move
	// (so the board never blocks on the network) — but nextAttempt must await
	// it before reloading, or invalidateAll() can race the write and re-serve
	// the same task, making Continue look like it did nothing.
	let pendingReport: Promise<unknown> | null = null;

	const REPLAY_STEP_MS = 550;
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

	// The correct move's origin square — computed from the step's own
	// fromFen/san rather than stored, since only the destination is ever
	// meant to stay hidden.
	const hintSquare = $derived.by(() => {
		if (!hintRequested) return null;
		const step = attempt?.quizSteps[quizIdx];
		if (!step) return null;
		try {
			return new Chess(step.fromFen).move(step.san)?.from ?? null;
		} catch {
			return null;
		}
	});

	function advanceThroughOpponentReplies() {
		while (attempt?.quizSteps[quizIdx] && !attempt.quizSteps[quizIdx].isPlayerTurn) {
			boardFen = attempt.quizSteps[quizIdx].toFen;
			quizIdx++;
		}
	}

	// From Level 2 onward, `attempt.prefix` holds the already-mastered moves
	// leading up to this attempt's quiz. Playing them out one at a time (like
	// a PC opponent replaying the line) instead of jumping straight to the
	// quiz position mirrors how the line is actually reached in a real game,
	// reinforcing the path there rather than just the isolated position.
	async function resetForAttempt() {
		const myToken = ++resetToken;
		clearTimeout(advanceTimeout);
		quizIdx = 0;
		phase = 'playing';
		locked = false;
		replaying = false;
		wrongCount = 0;
		hintRequested = false;
		attemptHadMistake = false;
		attemptPrevLevelMistakes = 0;
		if (!attempt) return;

		if (attempt.prefix.length === 0) {
			boardFen = attempt.quizSteps[0]?.fromFen ?? '';
			advanceThroughOpponentReplies();
			return;
		}

		replaying = true;
		boardFen = attempt.prefix[0].fromFen;
		for (const step of attempt.prefix) {
			await sleep(REPLAY_STEP_MS);
			if (myToken !== resetToken) return; // superseded by a newer reset
			boardFen = step.toFen;
		}
		if (myToken !== resetToken) return;
		replaying = false;
		advanceThroughOpponentReplies();
	}

	// Set the board's initial position synchronously, before ChessBoard's own
	// onMount runs — it throws on an empty FEN, and a child's onMount fires
	// before this component's own $effect does, so waiting for the effect
	// below to set boardFen for the first time is too late.
	resetForAttempt();

	// Reset only when the REPERTOIRE itself changes (including on mount) —
	// not on every `attempt` change, since nextAttempt() below also changes
	// `attempt` via invalidateAll() and needs to decide for itself whether to
	// jump straight into the next attempt or show a level transition notice.
	$effect(() => {
		repertoireId;
		untrack(() => resetForAttempt());
	});

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked || replaying) return false;
		const step = attempt?.quizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			// Hold the board here so the green check is actually visible before
			// advancing — updating boardFen in the same tick would clear it
			// before the browser ever paints it.
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= attempt.quizSteps.length) {
					phase = 'success';
					// Grading is per-attempt, not per-move — persist the whole
					// outcome the moment the last quiz step is solved. Skipped
					// during review, which is a pure read-only replay.
					if (reviewLevel === null) pendingReport = reportAttempt();
				}
			}, 500);
			return true;
		} else {
			playWrong();
			wrongCount++;
			if (reviewLevel === null) {
				attemptHadMistake = true;
				if (step.band === 'previous') attemptPrevLevelMistakes++;
			}
			// Don't reveal the book move — just mark the square wrong and let
			// the player try again on the same position.
			return false;
		}
	}

	async function reportAttempt() {
		try {
			await fetch('/api/practice/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId,
					taskKey: attempt.taskKey,
					hadMistake: attemptHadMistake,
					prevLevelMistakeCount: attemptPrevLevelMistakes
				})
			});
		} catch {
			// Report failed — the attempt itself already played out on the
			// board; just skip silently rather than blocking the player on a
			// network hiccup. Worst case: the same task is served again.
		}
	}

	function levelRank(level: number | 'mastered'): number {
		return level === 'mastered' ? Infinity : level;
	}

	async function nextAttempt() {
		const levelBefore = data.level;
		if (pendingReport) await pendingReport;
		pendingReport = null;
		await invalidateAll();
		// `data` now reflects the fresh load. If completing that attempt
		// changed the active level — up on mastering it, or down on a
		// demotion — surface that instead of silently dropping the player
		// into the next quiz. Never applies during review: reviewing a passed
		// level can't change which level is active.
		if (reviewLevel === null && levelRank(data.level) > levelRank(levelBefore)) {
			phase = 'leveled-up';
		} else if (reviewLevel === null && levelRank(data.level) < levelRank(levelBefore)) {
			phase = 'leveled-down';
		} else {
			resetForAttempt();
		}
	}

	function handleContinue() {
		if (phase === 'leveled-up' || phase === 'leveled-down') {
			resetForAttempt();
		} else {
			nextAttempt();
		}
	}
</script>
```

- [ ] **Step 4: Update the level-transition banner in the template**

In the same file, find this block (originally near the end of the template):

```svelte
				{#if phase === 'success' || phase === 'leveled-up'}
					<div class="p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
						{#if phase === 'leveled-up'}
							<p class="text-xl font-bold mb-1 text-indigo-600">🎉 Level up! Now on Level {data.level}</p>
						{:else}
							<p class="text-xl font-bold mb-1 text-green-600">✅ Solved!</p>
						{/if}
```

Replace it with:

```svelte
				{#if phase === 'success' || phase === 'leveled-up' || phase === 'leveled-down'}
					<div class="p-5 bg-white border border-gray-200 rounded-2xl text-center shadow-sm">
						{#if phase === 'leveled-up'}
							<p class="text-xl font-bold mb-1 text-indigo-600">🎉 Level up! Now on Level {data.level}</p>
						{:else if phase === 'leveled-down'}
							<p class="text-xl font-bold mb-1 text-amber-600">⬇️ Back to Level {data.level} — brush up and try again</p>
						{:else}
							<p class="text-xl font-bold mb-1 text-green-600">✅ Solved!</p>
						{/if}
```

(The closing `{/if}`, the `Continue` button, and everything else in that block are unchanged.)

- [ ] **Step 5: Run the component test suite again**

Run: `cd mychess && npx vitest run "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"`
Expected: PASS (6 tests) — these are static-prop render tests and don't exercise `handleMove`/`nextAttempt`, so they're unaffected by the script changes; this confirms nothing broke.

- [ ] **Step 6: Type-check**

Run: `cd mychess && npm run check`
Expected: same pre-existing baseline only.

- [ ] **Step 7: Commit**

```bash
cd mychess
git add "src/routes/(player)/practice/[repertoire_id]/+page.svelte" "src/routes/(player)/practice/[repertoire_id]/practice.test.ts"
git commit -m "feat: report attempts (not moves) to the server, add demotion banner"
```

---

### Task 11: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit test suite**

Run: `cd mychess && npm test`
Expected: PASS, no failures, no leftover references to `moveProgress`/`move-progress`/`correctMoveIdSet`/`markMoveCorrect`/`pickPracticeAttempt`/`isSatisfied`/`currentLevel`/`activeLevel`.

- [ ] **Step 2: Full type-check**

Run: `cd mychess && npm run check`
Expected: only the documented pre-existing ~12 OAuth-route baseline errors (see `CLAUDE.md`) — no new errors.

- [ ] **Step 3: Confirm no dangling references**

Run: `cd mychess && grep -rn "move_progress\|moveProgress\|markMoveCorrect\|pickPracticeAttempt" src`
Expected: no output (everything migrated to `level_progress`/`levelProgress`/`applyAttemptResult`/`pickQueuedAttempt`).

- [ ] **Step 4: Manual smoke test (requires the Task 4 migration already applied in Supabase)**

Run: `cd mychess && npm run dev`, then in a browser:
1. Open `/practice`, pick a repertoire with at least 6-8 of your own moves, confirm it shows "Level 1 of N".
2. Open its detail page — confirm Level 1 asks only 2 moves (no auto-play), and deliberately playing a wrong move requeues that line (it should be re-served later, not immediately).
3. Clear every Level 1 task cleanly — confirm it advances to Level 2 and now asks 4 moves (Level 1 + Level 2, still nothing auto-played).
4. On Level 2, deliberately miss the same "previous level" (Level 1) quiz move 3 times across separate attempts — confirm it demotes back to Level 1 and Level 1 must be fully re-cleared before Level 2 reappears.
5. Confirm `/practice` and the dashboard's "Repertoires mastered" tile still render sensibly for a repertoire fully cleared through its last level.

Report back what was and wasn't verified live — this step can't be fully automated (see spec's Out of scope note on demotion-banner interaction not having an automated test).
