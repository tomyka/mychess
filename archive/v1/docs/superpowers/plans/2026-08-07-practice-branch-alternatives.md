# Practice Branch Alternatives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a repertoire prepares more than one reply at the same position, accept whichever one the player actually plays instead of only the single variation an attempt happened to pin, crediting whichever task that move actually completes.

**Architecture:** `splitAttempt` (pure, `src/lib/mastery/practice.ts`) gains a 4th parameter — the level's full `variations` array — and annotates each player-turn `QuizStep` with an `alternatives: { san: string; taskKey: string | null }[]` list: other repertoire moves valid at that exact board position (matched by `fromFen`), each tagged with the task it completes (`taskKey`) or `null` if it's a valid book move that isn't itself a task boundary at this level. The two server-side call sites thread `variations` through. The client (`+page.svelte`'s `handleMove`) checks a wrong-against-the-pinned-move answer against `step.alternatives` before falling back to "wrong": a match with a `taskKey` completes that task (final/star feedback, reports the alternative's key instead of the pinned attempt's); a match with `taskKey: null` is accepted (check feedback) but ends the attempt with nothing reported, since the board no longer follows the pinned script.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-07-practice-branch-alternatives-design.md`

---

### Task 1: Compute per-step alternatives in `splitAttempt`

**Files:**
- Modify: `mychess/src/lib/mastery/practice.ts`
- Test: `mychess/src/lib/mastery/practice.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `mychess/src/lib/mastery/practice.test.ts` with:

```typescript
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
		expect(result!.targetDepth).toBe(6); // level 2 depth
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

describe('splitAttempt', () => {
	it('at level 1, auto-plays nothing and every quiz step is in the "current" band', () => {
		const v = makeVariation(4, 'x-');
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 3, [v]);
		expect(prefix).toHaveLength(0);
		expect(quizSteps.map((s) => s.moveId)).toEqual(['x-p1', 'x-o1', 'x-p2', 'x-o2', 'x-p3']);
		expect(quizSteps.every((s) => s.band === 'current')).toBe(true);
	});

	it('at level 2, auto-plays nothing and asks both level 1 (previous) and level 2 (current) material', () => {
		const v = makeVariation(6, 'y-');
		const { prefix, quizSteps } = splitAttempt(v.path, 2, 6, [v]);
		expect(prefix).toHaveLength(0);
		expect(quizSteps.map((s) => s.moveId)).toEqual([
			'y-p1', 'y-o1', 'y-p2', 'y-o2', 'y-p3', 'y-o3', 'y-p4', 'y-o4', 'y-p5', 'y-o5', 'y-p6'
		]);
		expect(quizSteps.find((s) => s.moveId === 'y-p1')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'y-p2')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'y-p3')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'y-p4')!.band).toBe('current');
		expect(quizSteps.find((s) => s.moveId === 'y-p5')!.band).toBe('current');
		expect(quizSteps.find((s) => s.moveId === 'y-p6')!.band).toBe('current');
	});

	it('at level 3, auto-plays level 1 and asks level 2 (previous) plus level 3 (current)', () => {
		const v = makeVariation(9, 'z-');
		const { prefix, quizSteps } = splitAttempt(v.path, 3, 9, [v]);
		expect(prefix.map((s) => s.moveId)).toEqual(['z-p1', 'z-o1', 'z-p2', 'z-o2', 'z-p3', 'z-o3']);
		expect(quizSteps[0].moveId).toBe('z-p4');
		expect(quizSteps.find((s) => s.moveId === 'z-p4')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'z-p5')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'z-p6')!.band).toBe('previous');
		expect(quizSteps.find((s) => s.moveId === 'z-p7')!.band).toBe('current');
		expect(quizSteps.find((s) => s.moveId === 'z-p8')!.band).toBe('current');
		expect(quizSteps.find((s) => s.moveId === 'z-p9')!.band).toBe('current');
	});

	it("collapses to the variation's own length when shorter than the level depth", () => {
		const v = makeVariation(2, 'w-');
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 2, [v]); // targetDepth = min(2,2) = 2
		expect(prefix).toHaveLength(0);
		expect(quizSteps[quizSteps.length - 1].moveId).toBe('w-p2');
	});

	it("throws when the level's auto-play boundary is not below the target depth", () => {
		const v = makeVariation(2, 'w2-');
		expect(() => splitAttempt(v.path, 1, 2, [v])).not.toThrow(); // sanity: valid at level 1
		// At level 3 the auto-play boundary (2) is not below a target depth of
		// 2 — this 2-move variation has no interactive room left at level 3
		// and should never have been picked by pickQueuedAttempt in the first place.
		expect(() => splitAttempt(v.path, 3, 2, [v])).toThrow();
	});

	it('reports no alternatives when no other variation shares the branch position', () => {
		const v = makeVariation(3, 'a-');
		const { quizSteps } = splitAttempt(v.path, 1, 3, [v]);
		expect(quizSteps.every((s) => s.alternatives.length === 0)).toBe(true);
	});

	it('finds an alternative that completes another task at this level', () => {
		// a and b share an identical first player move/reply, then diverge on
		// their second (and final) player move — a branch landing exactly on
		// both tasks' own target-depth move for level 1 (depth 3, collapsed to
		// each variation's own 2-move length).
		const shared: VariationStep = { moveId: 'shared-p1', san: 'P1', fromFen: 'start', toFen: 'mid', isPlayerTurn: true };
		const sharedReply: VariationStep = { moveId: 'shared-o1', san: 'O1', fromFen: 'mid', toFen: 'branch', isPlayerTurn: false };
		const a: Variation = {
			leafMoveId: 'a-p2',
			variationKey: 'shared-p1>shared-o1>a-p2',
			path: [shared, sharedReply, { moveId: 'a-p2', san: 'Nf3', fromFen: 'branch', toFen: 'a-end', isPlayerTurn: true }],
			playerMoveCount: 2
		};
		const b: Variation = {
			leafMoveId: 'b-p2',
			variationKey: 'shared-p1>shared-o1>b-p2',
			path: [shared, sharedReply, { moveId: 'b-p2', san: 'Bc4', fromFen: 'branch', toFen: 'b-end', isPlayerTurn: true }],
			playerMoveCount: 2
		};
		const { quizSteps } = splitAttempt(a.path, 1, 2, [a, b]);
		const branchStep = quizSteps.find((s) => s.moveId === 'a-p2')!;
		expect(branchStep.alternatives).toEqual([{ san: 'Bc4', taskKey: taskKey(b, 1) }]);
	});

	it('marks a mid-line branch alternative with a null taskKey', () => {
		// b is longer than a beyond the branch, so b's own target-depth move at
		// this level lands past the branch point — the branch itself isn't b's
		// taskKey, just a valid book move partway through a longer line.
		const shared: VariationStep = { moveId: 'shared-p1', san: 'P1', fromFen: 'start', toFen: 'mid', isPlayerTurn: true };
		const sharedReply: VariationStep = { moveId: 'shared-o1', san: 'O1', fromFen: 'mid', toFen: 'branch', isPlayerTurn: false };
		const a: Variation = {
			leafMoveId: 'a-p2',
			variationKey: 'shared-p1>shared-o1>a-p2',
			path: [shared, sharedReply, { moveId: 'a-p2', san: 'Nf3', fromFen: 'branch', toFen: 'a-end', isPlayerTurn: true }],
			playerMoveCount: 2
		};
		const bStep2: VariationStep = { moveId: 'b-p2', san: 'Bc4', fromFen: 'branch', toFen: 'b-mid', isPlayerTurn: true };
		const bReply2: VariationStep = { moveId: 'b-o2', san: 'O2', fromFen: 'b-mid', toFen: 'b-branch2', isPlayerTurn: false };
		const bStep3: VariationStep = { moveId: 'b-p3', san: 'Bb5', fromFen: 'b-branch2', toFen: 'b-end', isPlayerTurn: true };
		const b: Variation = {
			leafMoveId: 'b-p3',
			variationKey: 'shared-p1>shared-o1>b-p2>b-o2>b-p3',
			path: [shared, sharedReply, bStep2, bReply2, bStep3],
			playerMoveCount: 3
		};
		// Level 1 depth is 3; a's own target depth collapses to 2 (its natural
		// length). b's target depth is min(3,3)=3 — its taskKey-defining move is
		// its 3rd player move, not the branch (its 2nd) — so the branch carries
		// a null taskKey.
		const { quizSteps } = splitAttempt(a.path, 1, 2, [a, b]);
		const branchStep = quizSteps.find((s) => s.moveId === 'a-p2')!;
		expect(branchStep.alternatives).toEqual([{ san: 'Bc4', taskKey: null }]);
	});

	it('does not match a transposition reaching the same fromFen via a different player-move count', () => {
		// c reaches the SAME fromFen ('branch') as a's second player move, but
		// as its own FIRST player move — a different position in the move-count
		// sequence, so it must not be treated as an alternative to a's second move.
		const shared: VariationStep = { moveId: 'shared-p1', san: 'P1', fromFen: 'start', toFen: 'mid', isPlayerTurn: true };
		const sharedReply: VariationStep = { moveId: 'shared-o1', san: 'O1', fromFen: 'mid', toFen: 'branch', isPlayerTurn: false };
		const a: Variation = {
			leafMoveId: 'a-p2',
			variationKey: 'shared-p1>shared-o1>a-p2',
			path: [shared, sharedReply, { moveId: 'a-p2', san: 'Nf3', fromFen: 'branch', toFen: 'a-end', isPlayerTurn: true }],
			playerMoveCount: 2
		};
		const c: Variation = {
			leafMoveId: 'c-p1',
			variationKey: 'c-p1',
			path: [{ moveId: 'c-p1', san: 'Qh5', fromFen: 'branch', toFen: 'c-end', isPlayerTurn: true }],
			playerMoveCount: 1
		};
		const { quizSteps } = splitAttempt(a.path, 1, 2, [a, c]);
		const branchStep = quizSteps.find((s) => s.moveId === 'a-p2')!;
		expect(branchStep.alternatives).toHaveLength(0);
	});

	it('excludes the canonical move itself from its own alternatives list', () => {
		const shared: VariationStep = { moveId: 'shared-p1', san: 'P1', fromFen: 'start', toFen: 'mid', isPlayerTurn: true };
		const sharedReply: VariationStep = { moveId: 'shared-o1', san: 'O1', fromFen: 'mid', toFen: 'branch', isPlayerTurn: false };
		const aStep2: VariationStep = { moveId: 'a-p2', san: 'Nf3', fromFen: 'branch', toFen: 'a-end', isPlayerTurn: true };
		const a: Variation = {
			leafMoveId: 'a-p2',
			variationKey: 'shared-p1>shared-o1>a-p2',
			path: [shared, sharedReply, aStep2],
			playerMoveCount: 2
		};
		// b plays the exact same san as a at the branch, then continues further
		// — a degenerate but valid input (enumerateVariations only splits on
		// actual divergence; sharing the branch move here just means a's own
		// step must never appear as an "alternative" to itself).
		const b: Variation = {
			leafMoveId: 'b-p3',
			variationKey: 'shared-p1>shared-o1>a-p2>b-o2>b-p3',
			path: [
				shared,
				sharedReply,
				aStep2,
				{ moveId: 'b-o2', san: 'O2', fromFen: 'a-end', toFen: 'b-mid', isPlayerTurn: false },
				{ moveId: 'b-p3', san: 'Bb5', fromFen: 'b-mid', toFen: 'b-end', isPlayerTurn: true }
			],
			playerMoveCount: 3
		};
		const { quizSteps } = splitAttempt(a.path, 1, 2, [a, b]);
		const branchStep = quizSteps.find((s) => s.moveId === 'a-p2')!;
		expect(branchStep.alternatives).toHaveLength(0);
	});

	it('never computes alternatives for a non-player-turn (opponent) step', () => {
		const v = makeVariation(2, 'o-');
		const { quizSteps } = splitAttempt(v.path, 1, 2, [v]);
		const opponentStep = quizSteps.find((s) => s.moveId === 'o-o1')!;
		expect(opponentStep.alternatives).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — `splitAttempt` called with 4 arguments but the current signature only accepts 3 (TypeScript error), and/or `quizSteps[].alternatives` is `undefined`.

- [ ] **Step 3: Implement the alternatives computation**

Replace the full contents of `mychess/src/lib/mastery/practice.ts` with:

```typescript
// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { targetDepth, levelDepth, taskKey, levelTaskVariations, hasContentAtLevel, type Level } from './levels';

export type QuizStep = VariationStep & {
	band: 'previous' | 'current';
	// Other moves the repertoire allows from this exact board position
	// (matched by fromFen, so transpositions reaching it via a different
	// player-move count correctly don't match — see alternativesAt).
	// taskKey is set when playing that alternative completes a distinct
	// task at this level (it's that variation's own target-depth move);
	// null when it's a valid book move that isn't a task boundary here.
	// Always empty for a non-player-turn step.
	alternatives: { san: string; taskKey: string | null }[];
};

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

/** The `n`th (1-indexed) player-turn step in `path`, or undefined if it has fewer. */
function nthPlayerStep(path: VariationStep[], n: number): VariationStep | undefined {
	let seen = 0;
	for (const step of path) {
		if (!step.isPlayerTurn) continue;
		seen++;
		if (seen === n) return step;
	}
	return undefined;
}

/**
 * Other moves the repertoire allows at the exact board position reached
 * after `playerMoveIndex` player moves (matched by `fromFen`) — every
 * variation sharing that same board position at that same point in its own
 * sequence, excluding the canonical move itself and de-duplicated by SAN.
 * Each alternative is tagged with the `taskKey` it completes if this
 * position is that variation's own target-depth move for `level`, or `null`
 * if it's a valid book move that isn't a task boundary here (a branch
 * earlier in a longer line).
 */
function alternativesAt(
	variations: Variation[],
	level: Level,
	playerMoveIndex: number,
	fromFen: string,
	canonicalSan: string
): { san: string; taskKey: string | null }[] {
	const found = new Map<string, string | null>();
	for (const variation of variations) {
		const step = nthPlayerStep(variation.path, playerMoveIndex);
		if (!step || step.fromFen !== fromFen || step.san === canonicalSan) continue;
		if (found.has(step.san)) continue;
		const isTaskBoundary = playerMoveIndex === targetDepth(variation, level);
		found.set(step.san, isTaskBoundary ? taskKey(variation, level) : null);
	}
	return [...found.entries()].map(([san, tk]) => ({ san, taskKey: tk }));
}

/**
 * Splits a variation's path into the auto-played `prefix` and the
 * `quizSteps` the player walks through interactively. The quiz window is
 * always the CURRENT level plus the one before it (a live review of the
 * previous level's material) — anything older auto-plays. At active level
 * *n*, moves 1 through 3(n-2) auto-play (book line, both colors); the player
 * answers from 3(n-2)+1 through the target depth. Each quiz step is tagged
 * `band: 'previous'` (review material — counts toward demotion, see
 * `levelProgress.ts`) or `'current'` (the level's own new material), plus
 * any `alternatives` the repertoire also allows at that exact position
 * (see `alternativesAt`) — `variations` is the level's full task set, used
 * only to look those up, independent of which one variation is being split.
 */
export function splitAttempt(
	path: VariationStep[],
	level: Level,
	targetDepthValue: number,
	variations: Variation[]
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
		const alternatives = step.isPlayerTurn
			? alternativesAt(variations, level, playerMovesSeen, step.fromFen, step.san)
			: [];
		return { ...step, band: playerMovesSeen <= previousLevelDepth ? 'previous' : 'current', alternatives };
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
	const candidates = variations.filter((v) => hasContentAtLevel(v, level));
	if (candidates.length === 0) return null;

	const chosen = candidates[Math.floor(random() * candidates.length)];
	return { variation: chosen, targetDepth: targetDepth(chosen, level), taskKey: taskKey(chosen, level) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Type-check**

Run: `cd mychess && npm run check`
Expected: `0 ERRORS` (existing pre-existing warnings unrelated to this change are fine).

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/mastery/practice.ts mychess/src/lib/mastery/practice.test.ts
git commit -m "$(cat <<'EOF'
feat: compute per-step branch alternatives in splitAttempt

Each player-turn quiz step now carries the other repertoire moves valid
at that exact board position (matched by fromFen), tagged with the task
each one completes (or null for a valid book move that isn't a task
boundary here) — lays the groundwork for accepting either branch during
an attempt instead of only the one variation that was pinned.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Thread `variations` through the server-side call sites

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts`

This file has no dedicated test file (server I/O wrapper, per this codebase's convention of testing the pure logic it calls rather than the wrapper itself — see `practice-repertoire.ts`'s own lack of tests). Verified instead by type-check plus Task 4's manual pass.

- [ ] **Step 1: Update both `splitAttempt` calls**

In `mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts`, the `load` function currently reads (lines 39-51):

```typescript
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
```

Change both `splitAttempt` calls to pass `variations` as the 4th argument:

```typescript
	if (reviewLevel !== null) {
		const picked = pickReviewAttempt(variations, reviewLevel);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, reviewLevel, picked.targetDepth, variations);
			attempt = { prefix, quizSteps, taskKey: picked.taskKey };
		}
	} else if (level !== 'mastered' && row) {
		const picked = pickQueuedAttempt(variations, level, row.queue);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, level, picked.targetDepth, variations);
			attempt = { prefix, quizSteps, taskKey: picked.taskKey };
		}
	}
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: `0 ERRORS`.

- [ ] **Step 3: Commit**

```bash
git add "mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts"
git commit -m "$(cat <<'EOF'
feat: pass variations into splitAttempt from the practice detail load

Both pickReviewAttempt and pickQueuedAttempt call sites now supply the
level's full variation set so splitAttempt can compute branch
alternatives for each quiz step.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Accept branch alternatives in `handleMove`

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`

`practice.test.ts` in this directory renders the component from static prop fixtures and never simulates a board move (`handleMove` is never invoked by it), so no existing test exercises this path — it isn't touched by this task, matching this repo's established convention of verifying `+page.svelte` interaction logic manually rather than through component tests (see the design spec's Testing section). Task 4 covers that manual pass.

- [ ] **Step 1: Update `handleMove`**

In `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`, the function currently reads (lines 142-196):

```typescript
	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked || replaying) return false;
		const currentAttempt = attempt;
		const currentReviewLevel = reviewLevel;
		const step = currentAttempt?.quizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			// Whether THIS move is the last one in the attempt — decided now,
			// synchronously, since ChessBoard needs the star-vs-check choice at
			// move time, before the 500ms hold below even starts.
			const isFinalMove = quizIdx + 1 >= currentAttempt.quizSteps.length;
			// Hold the board here so the check/star is actually visible before
			// advancing — updating boardFen in the same tick would clear it
			// before the browser ever paints it.
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies(currentAttempt);
				locked = false;
				if (quizIdx >= currentAttempt.quizSteps.length) {
					// No confirmation click for a plain solve — auto-advance
					// straight to the next task. `nextAttempt()` still pauses on
					// a leveled-up/leveled-down banner itself when relevant.
					phase = 'advancing';
					// Grading is per-attempt, not per-move — persist the whole
					// outcome the moment the last quiz step is solved. Skipped
					// during review, which is a pure read-only replay. Uses the
					// ATTEMPT/REVIEW-LEVEL CAPTURED AT THE TOP of this function,
					// not the live reactive values — the player can navigate to a
					// different level or exit review during this 500ms hold,
					// which changes `attempt`/`reviewLevel` without going through
					// resetForAttempt(), and reporting against the live (wrong)
					// attempt would corrupt an unrelated task's progress.
					if (currentReviewLevel === null) pendingReport = reportAttempt(currentAttempt);
					nextAttempt();
				}
			}, 500);
			return isFinalMove ? 'final' : true;
		} else {
			playWrong();
			wrongCount++;
			if (currentReviewLevel === null) {
				attemptHadMistake = true;
				if (step.band === 'previous') reportPreviousLevelMistake();
			}
			// Don't reveal the book move — just mark the square wrong and let
			// the player try again on the same position.
			return false;
		}
	}

	async function reportAttempt(reportedAttempt: NonNullable<typeof attempt>) {
		try {
			await fetch('/api/practice/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId,
					taskKey: reportedAttempt.taskKey,
					hadMistake: attemptHadMistake
				})
			});
```

Replace it with:

```typescript
	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked || replaying) return false;
		const currentAttempt = attempt;
		const currentReviewLevel = reviewLevel;
		const step = currentAttempt?.quizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			// Whether THIS move is the last one in the attempt — decided now,
			// synchronously, since ChessBoard needs the star-vs-check choice at
			// move time, before the 500ms hold below even starts.
			const isFinalMove = quizIdx + 1 >= currentAttempt.quizSteps.length;
			// Hold the board here so the check/star is actually visible before
			// advancing — updating boardFen in the same tick would clear it
			// before the browser ever paints it.
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies(currentAttempt);
				locked = false;
				if (quizIdx >= currentAttempt.quizSteps.length) {
					// No confirmation click for a plain solve — auto-advance
					// straight to the next task. `nextAttempt()` still pauses on
					// a leveled-up/leveled-down banner itself when relevant.
					phase = 'advancing';
					// Grading is per-attempt, not per-move — persist the whole
					// outcome the moment the last quiz step is solved. Skipped
					// during review, which is a pure read-only replay. Uses the
					// ATTEMPT/REVIEW-LEVEL CAPTURED AT THE TOP of this function,
					// not the live reactive values — the player can navigate to a
					// different level or exit review during this 500ms hold,
					// which changes `attempt`/`reviewLevel` without going through
					// resetForAttempt(), and reporting against the live (wrong)
					// attempt would corrupt an unrelated task's progress.
					if (currentReviewLevel === null) pendingReport = reportAttempt(currentAttempt.taskKey);
					nextAttempt();
				}
			}, 500);
			return isFinalMove ? 'final' : true;
		}

		// Not the pinned answer — but the repertoire may allow more than one
		// reply at this exact position (see splitAttempt/alternativesAt).
		// Accept it rather than forcing the player to guess which of their own
		// memorized options this particular attempt happened to pin.
		const alt = step.alternatives.find((a) => a.san === detail.san);
		if (alt) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			advanceTimeout = setTimeout(() => {
				locked = false;
				// Either way this attempt is done: the board no longer matches
				// the pinned variation's remaining script, so there's nothing
				// left to continue quizzing here. A branch landing on another
				// task's own target-depth move (alt.taskKey set) completes that
				// task; a branch earlier in a longer line (null) completes
				// nothing, but costs nothing either — the pinned task is left
				// untouched, pending for another attempt.
				phase = 'advancing';
				if (currentReviewLevel === null && alt.taskKey) pendingReport = reportAttempt(alt.taskKey);
				nextAttempt();
			}, 500);
			return alt.taskKey ? 'final' : true;
		}

		playWrong();
		wrongCount++;
		if (currentReviewLevel === null) {
			attemptHadMistake = true;
			if (step.band === 'previous') reportPreviousLevelMistake();
		}
		// Don't reveal the book move — just mark the square wrong and let
		// the player try again on the same position.
		return false;
	}

	async function reportAttempt(taskKey: string) {
		try {
			await fetch('/api/practice/attempt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId,
					taskKey,
					hadMistake: attemptHadMistake
				})
			});
```

(The rest of `reportAttempt` — its `catch` block and closing brace — is unchanged.)

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: `0 ERRORS`.

- [ ] **Step 3: Run the full test suite**

Run: `cd mychess && npm test`
Expected: all existing tests pass (this file's own `practice.test.ts` render-only tests are unaffected, since none of them simulate a board move).

- [ ] **Step 4: Commit**

```bash
git add "mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte"
git commit -m "$(cat <<'EOF'
feat: accept branch alternatives when grading a practice move

A move that doesn't match the pinned quiz step is now checked against
that step's repertoire-valid alternatives before being marked wrong. One
that completes another task credits that task's key instead of the
pinned attempt's; one that doesn't (a branch earlier in a longer line)
is accepted with no penalty but ends the attempt, since the board no
longer follows the pinned script.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `cd mychess && npm run dev`

- [ ] **Step 2: Exercise the golden path**

Open a repertoire in Practice that has **no** branches and confirm normal solving still works exactly as before: correct pinned move advances/levels up as usual, wrong move shows the red cross and lets you retry.

- [ ] **Step 3: Exercise a branch that completes another task**

Using a repertoire (or a quick manual PGN upload) with two variations sharing a prefix and diverging on their final tested move, deliberately play the *other* branch's move at that shared position. Confirm: green check/star feedback (not a red cross), the attempt ends, and revisiting `/practice/<repertoire_id>` later shows that branch's task now counted toward `levelSolvedCount` while the originally-queued one is still pending.

- [ ] **Step 4: Exercise a mid-line branch (no task credit)**

With a repertoire where a shared prefix branches before either line's own target-depth move (e.g. at level 2+, where an attempt spans multiple player moves), play the non-pinned branch partway through. Confirm: accepted with a green check, the attempt ends immediately (no further quiz steps), and neither task's queue entry changes state — the same attempt is likely to be served again next.

- [ ] **Step 5: Confirm review mode is unaffected**

From the Level List, review an already-passed level containing a branch and confirm alternatives are still accepted (no false "wrong"), and that nothing is persisted (progress numbers unchanged after review moves).

- [ ] **Step 6: Run the full verification suite one more time**

Run: `cd mychess && npm test && npm run check`
Expected: all tests pass, `0 ERRORS`.
