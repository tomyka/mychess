# Practice Branch Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a mid-line branch alternative is taken during Practice (more content still ahead in that line, not itself a task boundary), continue that specific line to its own end instead of ending the attempt — crediting it if solved.

**Architecture:** `practice.ts`'s `alternativesAt` classification becomes a three-way discriminated union (`'completes'` / `'continue'` / `'dead-end'`) instead of a binary `taskKey: string | null`; `QuizStep` gains a `playerMoveIndex` field so the client can identify exactly where a branch occurred. A new pure function `continueFromBranch` resumes a specific variation from a given point by reusing `splitAttempt` in full and discarding everything up to the branch. A new endpoint `POST /api/practice/continue` exposes it. The client (`+page.svelte`) switches its in-progress quiz steps from a pure server-derived value to live, extendable `$state`, splicing in a fetched continuation when a `'continue'` branch is taken instead of ending the attempt.

**Tech Stack:** SvelteKit 2 / Svelte 5, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-08-practice-branch-continuation-design.md`

---

### Task 1: Three-way alternative classification + `continueFromBranch`

**Files:**
- Modify: `mychess/src/lib/mastery/practice.ts`
- Test: `mychess/src/lib/mastery/practice.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `mychess/src/lib/mastery/practice.test.ts` with:

```typescript
// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { pickQueuedAttempt, pickReviewAttempt, splitAttempt, continueFromBranch } from './practice';
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
		expect(() => splitAttempt(v.path, 3, 2, [v])).toThrow();
	});

	it('exposes each quiz step\'s running player-move index', () => {
		const v = makeVariation(3, 'x-');
		const { quizSteps } = splitAttempt(v.path, 1, 3, [v]);
		expect(quizSteps.map((s) => [s.moveId, s.playerMoveIndex])).toEqual([
			['x-p1', 1], ['x-o1', 1], ['x-p2', 2], ['x-o2', 2], ['x-p3', 3]
		]);
	});

	it('reports no alternatives when no other variation shares the branch position', () => {
		const v = makeVariation(3, 'a-');
		const { quizSteps } = splitAttempt(v.path, 1, 3, [v]);
		expect(quizSteps.every((s) => s.alternatives.length === 0)).toBe(true);
	});

	it('classifies an alternative as "completes" when it lands on another task\'s own target-depth move', () => {
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
		expect(branchStep.alternatives).toEqual([
			{ san: 'Bc4', toFen: 'b-end', kind: 'completes', taskKey: taskKey(b, 1) }
		]);
	});

	it('classifies a mid-line branch alternative as "continue" when the sibling has more content ahead', () => {
		// b is longer than a beyond the branch, so b's own target-depth move at
		// this level lands past the branch point — the branch itself isn't b's
		// taskKey, just a valid book move partway through a longer line that
		// should be resumed, not treated as a dead end.
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
		const { quizSteps } = splitAttempt(a.path, 1, 2, [a, b]);
		const branchStep = quizSteps.find((s) => s.moveId === 'a-p2')!;
		expect(branchStep.alternatives).toEqual([
			{ san: 'Bc4', toFen: 'b-mid', kind: 'continue', variationKey: b.variationKey }
		]);
	});

	it('classifies an alternative as "dead-end" when the sibling variation is shorter and already had no content left at this level', () => {
		// b ends exactly at the branch (2 player moves total) — it was already
		// fully resolved as a task back at level 1 (depth 3 >= 2), so it has no
		// content left at level 2's own depth window, even though the branch
		// position numerically equals its own targetDepth for level 2 too.
		// That numeric coincidence must NOT be treated as a live task boundary,
		// and there's nothing to continue either — it's a true dead end.
		const shared: VariationStep = { moveId: 'shared-p1', san: 'P1', fromFen: 'start', toFen: 'mid', isPlayerTurn: true };
		const sharedReply: VariationStep = { moveId: 'shared-o1', san: 'O1', fromFen: 'mid', toFen: 'branch', isPlayerTurn: false };
		const a: Variation = {
			leafMoveId: 'a-p6',
			variationKey: 'shared-p1>shared-o1>a-p2>a-o2>a-p3>a-o3>a-p4>a-o4>a-p5>a-o5>a-p6',
			path: [
				shared,
				sharedReply,
				{ moveId: 'a-p2', san: 'Nf3', fromFen: 'branch', toFen: 'a2b', isPlayerTurn: true },
				{ moveId: 'a-o2', san: 'O2', fromFen: 'a2b', toFen: 'a3a', isPlayerTurn: false },
				{ moveId: 'a-p3', san: 'P3', fromFen: 'a3a', toFen: 'a3b', isPlayerTurn: true },
				{ moveId: 'a-o3', san: 'O3', fromFen: 'a3b', toFen: 'a4a', isPlayerTurn: false },
				{ moveId: 'a-p4', san: 'P4', fromFen: 'a4a', toFen: 'a4b', isPlayerTurn: true },
				{ moveId: 'a-o4', san: 'O4', fromFen: 'a4b', toFen: 'a5a', isPlayerTurn: false },
				{ moveId: 'a-p5', san: 'P5', fromFen: 'a5a', toFen: 'a5b', isPlayerTurn: true },
				{ moveId: 'a-o5', san: 'O5', fromFen: 'a5b', toFen: 'a6a', isPlayerTurn: false },
				{ moveId: 'a-p6', san: 'P6', fromFen: 'a6a', toFen: 'a6b', isPlayerTurn: true }
			],
			playerMoveCount: 6
		};
		const b: Variation = {
			leafMoveId: 'b-p2',
			variationKey: 'shared-p1>shared-o1>b-p2',
			path: [shared, sharedReply, { moveId: 'b-p2', san: 'Bc4', fromFen: 'branch', toFen: 'b-end', isPlayerTurn: true }],
			playerMoveCount: 2
		};
		const { quizSteps } = splitAttempt(a.path, 2, 6, [a, b]);
		const branchStep = quizSteps.find((s) => s.moveId === 'a-p2')!;
		expect(branchStep.band).toBe('previous'); // sanity: within level 2's review-band window
		expect(branchStep.alternatives).toEqual([{ san: 'Bc4', toFen: 'b-end', kind: 'dead-end' }]);
	});

	it('prioritizes "completes" over "continue" when two siblings share one branch edge', () => {
		const shared: VariationStep = { moveId: 'shared-p1', san: 'P1', fromFen: 'start', toFen: 'mid', isPlayerTurn: true };
		const sharedReply: VariationStep = { moveId: 'shared-o1', san: 'O1', fromFen: 'mid', toFen: 'branch', isPlayerTurn: false };
		const a: Variation = {
			leafMoveId: 'a-p2',
			variationKey: 'a-key',
			path: [shared, sharedReply, { moveId: 'a-p2', san: 'Nf3', fromFen: 'branch', toFen: 'a-end', isPlayerTurn: true }],
			playerMoveCount: 2
		};
		// b1 completes exactly at the branch (2-move line).
		const b1: Variation = {
			leafMoveId: 'b1-p2',
			variationKey: 'b1-key',
			path: [shared, sharedReply, { moveId: 'b1-p2', san: 'Bc4', fromFen: 'branch', toFen: 'b-mid', isPlayerTurn: true }],
			playerMoveCount: 2
		};
		// b2 shares the exact same branch edge (same san, same fromFen — a
		// degenerate but valid shared-edge input, same as other tests here)
		// but continues further, still within level 1's own depth (3).
		const b2: Variation = {
			leafMoveId: 'b2-p3',
			variationKey: 'b2-key',
			path: [
				shared,
				sharedReply,
				{ moveId: 'b1-p2', san: 'Bc4', fromFen: 'branch', toFen: 'b-mid', isPlayerTurn: true },
				{ moveId: 'b2-o2', san: 'O2', fromFen: 'b-mid', toFen: 'b2-branch', isPlayerTurn: false },
				{ moveId: 'b2-p3', san: 'Bb5', fromFen: 'b2-branch', toFen: 'b2-end', isPlayerTurn: true }
			],
			playerMoveCount: 3
		};
		const { quizSteps } = splitAttempt(a.path, 1, 2, [a, b1, b2]);
		const branchStep = quizSteps.find((s) => s.moveId === 'a-p2')!;
		expect(branchStep.alternatives).toEqual([
			{ san: 'Bc4', toFen: 'b-mid', kind: 'completes', taskKey: taskKey(b1, 1) }
		]);
	});

	it('prioritizes "continue" over "dead-end" when two siblings share one branch edge', () => {
		const shared: VariationStep = { moveId: 'shared-p1', san: 'P1', fromFen: 'start', toFen: 'mid', isPlayerTurn: true };
		const sharedReply: VariationStep = { moveId: 'shared-o1', san: 'O1', fromFen: 'mid', toFen: 'branch', isPlayerTurn: false };
		const a: Variation = {
			leafMoveId: 'a-p6',
			variationKey: 'a-key',
			path: [
				shared,
				sharedReply,
				{ moveId: 'a-p2', san: 'Nf3', fromFen: 'branch', toFen: 'a2b', isPlayerTurn: true },
				{ moveId: 'a-o2', san: 'O2', fromFen: 'a2b', toFen: 'a3a', isPlayerTurn: false },
				{ moveId: 'a-p3', san: 'P3', fromFen: 'a3a', toFen: 'a3b', isPlayerTurn: true },
				{ moveId: 'a-o3', san: 'O3', fromFen: 'a3b', toFen: 'a4a', isPlayerTurn: false },
				{ moveId: 'a-p4', san: 'P4', fromFen: 'a4a', toFen: 'a4b', isPlayerTurn: true },
				{ moveId: 'a-o4', san: 'O4', fromFen: 'a4b', toFen: 'a5a', isPlayerTurn: false },
				{ moveId: 'a-p5', san: 'P5', fromFen: 'a5a', toFen: 'a5b', isPlayerTurn: true },
				{ moveId: 'a-o5', san: 'O5', fromFen: 'a5b', toFen: 'a6a', isPlayerTurn: false },
				{ moveId: 'a-p6', san: 'P6', fromFen: 'a6a', toFen: 'a6b', isPlayerTurn: true }
			],
			playerMoveCount: 6
		};
		// d: dead end — ends exactly at the branch, already resolved at level 1.
		const d: Variation = {
			leafMoveId: 'd-p2',
			variationKey: 'd-key',
			path: [shared, sharedReply, { moveId: 'd-p2', san: 'Bc4', fromFen: 'branch', toFen: 'd-end', isPlayerTurn: true }],
			playerMoveCount: 2
		};
		// e: shares the exact same branch edge but keeps going — still has
		// content at level 2 and hasn't reached its own target-depth move yet.
		const e: Variation = {
			leafMoveId: 'e-p6',
			variationKey: 'e-key',
			path: [
				shared,
				sharedReply,
				{ moveId: 'd-p2', san: 'Bc4', fromFen: 'branch', toFen: 'd-end', isPlayerTurn: true },
				{ moveId: 'e-o2', san: 'O2', fromFen: 'd-end', toFen: 'e3a', isPlayerTurn: false },
				{ moveId: 'e-p3', san: 'P3', fromFen: 'e3a', toFen: 'e3b', isPlayerTurn: true },
				{ moveId: 'e-o3', san: 'O3', fromFen: 'e3b', toFen: 'e4a', isPlayerTurn: false },
				{ moveId: 'e-p4', san: 'P4', fromFen: 'e4a', toFen: 'e4b', isPlayerTurn: true },
				{ moveId: 'e-o4', san: 'O4', fromFen: 'e4b', toFen: 'e5a', isPlayerTurn: false },
				{ moveId: 'e-p5', san: 'P5', fromFen: 'e5a', toFen: 'e5b', isPlayerTurn: true },
				{ moveId: 'e-o5', san: 'O5', fromFen: 'e5b', toFen: 'e6a', isPlayerTurn: false },
				{ moveId: 'e-p6', san: 'P6', fromFen: 'e6a', toFen: 'e6b', isPlayerTurn: true }
			],
			playerMoveCount: 6
		};
		const { quizSteps } = splitAttempt(a.path, 2, 6, [a, d, e]);
		const branchStep = quizSteps.find((s) => s.moveId === 'a-p2')!;
		expect(branchStep.alternatives).toEqual([
			{ san: 'Bc4', toFen: 'd-end', kind: 'continue', variationKey: e.variationKey }
		]);
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

describe('continueFromBranch', () => {
	it('resumes a variation from a mid-line branch and returns its remaining steps plus taskKey', () => {
		const a = makeVariation(6, 'a-');
		const b = makeVariation(6, 'b-');
		const result = continueFromBranch([a, b], 2, b.variationKey, 2);
		expect(result).not.toBeNull();
		expect(result!.taskKey).toBe(taskKey(b, 2));
		expect(result!.quizSteps.map((s) => s.moveId)).toEqual([
			'b-o2', 'b-p3', 'b-o3', 'b-p4', 'b-o4', 'b-p5', 'b-o5', 'b-p6'
		]);
	});

	it('returns null for an unknown variationKey', () => {
		const a = makeVariation(4, 'a-');
		expect(continueFromBranch([a], 1, 'no-such-key', 1)).toBeNull();
	});

	it('returns null when afterPlayerMoveIndex is not a real player-turn step for that variation at this level', () => {
		const a = makeVariation(4, 'a-');
		// level 1's quiz range for a 4-move variation is player moves 1-3
		// (target depth min(4,3)=3) — index 4 is out of that range.
		expect(continueFromBranch([a], 1, a.variationKey, 4)).toBeNull();
	});

	it("a continuation's own steps still carry their own alternatives (recursion falls out of reusing splitAttempt)", () => {
		const shared: VariationStep = { moveId: 'shared-p1', san: 'P1', fromFen: 'start', toFen: 'mid', isPlayerTurn: true };
		const sharedReply: VariationStep = { moveId: 'shared-o1', san: 'O1', fromFen: 'mid', toFen: 'e2a', isPlayerTurn: false };
		const e: Variation = {
			leafMoveId: 'e-p4',
			variationKey: 'e-key',
			path: [
				shared,
				sharedReply,
				{ moveId: 'e-p2', san: 'Nf3', fromFen: 'e2a', toFen: 'e2b', isPlayerTurn: true },
				{ moveId: 'e-o2', san: 'O2', fromFen: 'e2b', toFen: 'e3a', isPlayerTurn: false },
				{ moveId: 'e-p3', san: 'Bc4', fromFen: 'e3a', toFen: 'e3b', isPlayerTurn: true }, // nested branch point
				{ moveId: 'e-o3', san: 'O3', fromFen: 'e3b', toFen: 'e4a', isPlayerTurn: false },
				{ moveId: 'e-p4', san: 'P4', fromFen: 'e4a', toFen: 'e4b', isPlayerTurn: true }
			],
			playerMoveCount: 4
		};
		// f shares e's prefix through move 2, diverges at move 3.
		const f: Variation = {
			leafMoveId: 'f-p3',
			variationKey: 'f-key',
			path: [
				shared,
				sharedReply,
				{ moveId: 'e-p2', san: 'Nf3', fromFen: 'e2a', toFen: 'e2b', isPlayerTurn: true },
				{ moveId: 'e-o2', san: 'O2', fromFen: 'e2b', toFen: 'e3a', isPlayerTurn: false },
				{ moveId: 'f-p3', san: 'Bb5', fromFen: 'e3a', toFen: 'f-end', isPlayerTurn: true }
			],
			playerMoveCount: 3
		};
		const result = continueFromBranch([e, f], 1, e.variationKey, 1);
		expect(result).not.toBeNull();
		const nested = result!.quizSteps.find((s) => s.moveId === 'e-p3')!;
		expect(nested.alternatives).toEqual([
			{ san: 'Bb5', toFen: 'f-end', kind: 'completes', taskKey: taskKey(f, 1) }
		]);
	});
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: FAIL — `continueFromBranch` doesn't exist yet, `alternatives` entries don't have a `kind`/`toFen` field, `QuizStep` has no `playerMoveIndex`.

- [ ] **Step 3: Implement the three-way classification and `continueFromBranch`**

Replace the full contents of `mychess/src/lib/mastery/practice.ts` with:

```typescript
// mychess/src/lib/mastery/practice.ts
import type { Variation, VariationStep } from './variations';
import { targetDepth, levelDepth, taskKey, levelTaskVariations, hasContentAtLevel, type Level } from './levels';

// Another move the repertoire allows at some quiz step's exact board position.
// - 'completes': lands on ANOTHER variation's own target-depth move for the
//   active level — playing it finishes that task immediately.
// - 'continue': that other variation still has content left at this level
//   (hasContentAtLevel) but hasn't reached its own target-depth move yet —
//   there's more of that specific line to walk before it resolves anything.
// - 'dead-end': that other variation has NO content left at this level (a
//   shorter sibling already fully resolved at an earlier level) — nothing to
//   continue, nothing to credit.
export type Alternative =
	| { san: string; toFen: string; kind: 'completes'; taskKey: string }
	| { san: string; toFen: string; kind: 'continue'; variationKey: string }
	| { san: string; toFen: string; kind: 'dead-end' };

export type QuizStep = VariationStep & {
	band: 'previous' | 'current';
	// The running count of player moves up to and including this step —
	// exposed so a 'continue' alternative taken here can later be resumed
	// (see continueFromBranch) without the caller needing to separately
	// recompute "how many player moves have happened so far."
	playerMoveIndex: number;
	// Other moves the repertoire allows from this exact board position
	// (matched by fromFen, so transpositions reaching it via a different
	// player-move count correctly don't match — see alternativesAt). Always
	// empty for a non-player-turn step.
	alternatives: Alternative[];
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
 * When multiple variations share one edge, the best available classification
 * wins: 'completes' beats 'continue' beats 'dead-end' (this can only ever be
 * a genuine choice between 'continue' and 'dead-end' in practice — a
 * variation can't simultaneously have content at this level, per
 * hasContentAtLevel, AND have another sibling ending exactly here with NO
 * content at this level, since both conditions pin the same playerMoveIndex
 * on opposite sides of levelDepth(level-1); the 'completes' branch is kept
 * for defensive completeness, not because it's reachable today).
 */
function alternativesAt(
	variations: Variation[],
	level: Level,
	playerMoveIndex: number,
	fromFen: string,
	canonicalSan: string
): Alternative[] {
	const found = new Map<string, Alternative>();
	for (const variation of variations) {
		const step = nthPlayerStep(variation.path, playerMoveIndex);
		if (!step || step.fromFen !== fromFen || step.san === canonicalSan) continue;
		const existing = found.get(step.san);
		if (existing?.kind === 'completes') continue; // already the best possible classification

		if (!hasContentAtLevel(variation, level)) {
			if (!existing) found.set(step.san, { san: step.san, toFen: step.toFen, kind: 'dead-end' });
			continue;
		}

		if (playerMoveIndex === targetDepth(variation, level)) {
			found.set(step.san, {
				san: step.san,
				toFen: step.toFen,
				kind: 'completes',
				taskKey: taskKey(variation, level)
			});
			continue;
		}

		if (existing?.kind !== 'continue') {
			found.set(step.san, {
				san: step.san,
				toFen: step.toFen,
				kind: 'continue',
				variationKey: variation.variationKey
			});
		}
	}
	return [...found.values()];
}

/**
 * Splits a variation's path into the auto-played `prefix` and the
 * `quizSteps` the player walks through interactively. The quiz window is
 * always the CURRENT level plus the one before it (a live review of the
 * previous level's material) — anything older auto-plays. At active level
 * *n*, moves 1 through 3(n-2) auto-play (book line, both colors); the player
 * answers from 3(n-2)+1 through the target depth. Each quiz step is tagged
 * `band: 'previous'` (review material — counts toward demotion, see
 * `levelProgress.ts`) or `'current'` (the level's own new material), its
 * running `playerMoveIndex`, and any `alternatives` the repertoire also
 * allows at that exact position (see `alternativesAt`) — `variations` is the
 * repertoire's whole variation set (unfiltered by level; `alternativesAt`
 * does its own filtering), used only to look those up, independent of which
 * one variation is being split.
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

/**
 * Resumes a specific variation from right after a 'continue' branch was
 * taken during an attempt — reuses `splitAttempt` in full for that variation
 * (so any further branch along this line already has its own `alternatives`
 * computed the normal way, recursion for free) and discards everything up to
 * and including the already-played branch move. Returns `null` if
 * `variationKey` doesn't match any variation, or if `afterPlayerMoveIndex`
 * doesn't land on a real player-turn step within that variation's own quiz
 * range at `level` — both indicate a stale/inconsistent request rather than
 * something to guess at.
 */
export function continueFromBranch(
	variations: Variation[],
	level: Level,
	variationKey: string,
	afterPlayerMoveIndex: number
): { quizSteps: QuizStep[]; taskKey: string } | null {
	const variation = variations.find((v) => v.variationKey === variationKey);
	if (!variation) return null;

	const { quizSteps } = splitAttempt(variation.path, level, targetDepth(variation, level), variations);
	const cutIndex = quizSteps.findIndex((s) => s.isPlayerTurn && s.playerMoveIndex === afterPlayerMoveIndex);
	if (cutIndex === -1) return null;

	return { quizSteps: quizSteps.slice(cutIndex + 1), taskKey: taskKey(variation, level) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mychess && npx vitest run src/lib/mastery/practice.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Type-check**

Run: `cd mychess && npm run check`
Expected: 2 errors remain, both in `src/routes/(player)/practice/[repertoire_id]/+page.svelte` (`alt.taskKey`/`alt.variationKey` no longer exist on the old shape) — this is expected and is Task 3's job. Confirm no OTHER files show new errors (in particular, `+page.server.ts` should show 0 new errors — its `ReturnType<typeof splitAttempt>` typing picks up the new shape automatically with no code change needed there).

- [ ] **Step 6: Commit**

```bash
git add mychess/src/lib/mastery/practice.ts mychess/src/lib/mastery/practice.test.ts
git commit -m "$(cat <<'EOF'
feat: three-way branch classification (completes/continue/dead-end)

Splits the old binary taskKey:string|null into a discriminated
Alternative union, distinguishing a genuine mid-line branch (more
content ahead, should be resumed) from a dead end (a shorter sibling
already fully resolved at an earlier level, nothing to continue).
Exposes each QuizStep's running playerMoveIndex and adds
continueFromBranch, which resumes a specific variation from a given
point by reusing splitAttempt in full — any further branch along that
line already has its own alternatives computed the normal way.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: New `/api/practice/continue` endpoint

**Files:**
- Create: `mychess/src/routes/api/practice/continue/+server.ts`

This file has no dedicated test (server I/O wrapper, per this codebase's convention — the pure logic it calls, `continueFromBranch`, is already fully tested in Task 1). Verified by type-check plus Task 4's manual pass. Mirrors the existing `mychess/src/routes/api/practice/attempt/+server.ts` and `mychess/src/routes/api/practice/mistake/+server.ts`.

- [ ] **Step 1: Create the endpoint**

```typescript
// mychess/src/routes/api/practice/continue/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { continueFromBranch } from '$lib/mastery/practice';
import { requireApiUser } from '$lib/server/auth';

/**
 * Resumes a specific line after a mid-line branch alternative was taken
 * during Practice — see `continueFromBranch` for the resolution logic.
 * Read-only: doesn't touch level_progress. The eventual credit only lands
 * via the existing /api/practice/attempt call once the continuation is
 * actually solved to its end.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, level, variationKey, afterPlayerMoveIndex } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof level !== 'number' ||
		typeof variationKey !== 'string' ||
		typeof afterPlayerMoveIndex !== 'number'
	) {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadRepertoireVariations(supabase, user.id, repertoireId);
	const result = continueFromBranch(variations, level, variationKey, afterPlayerMoveIndex);
	if (!result) throw error(404, 'Continuation not found');

	return json(result);
};
```

- [ ] **Step 2: Type-check**

Run: `cd mychess && npm run check`
Expected: same 2 pre-existing `+page.svelte` errors as after Task 1, nothing new.

- [ ] **Step 3: Commit**

```bash
git add mychess/src/routes/api/practice/continue/+server.ts
git commit -m "$(cat <<'EOF'
feat: add POST /api/practice/continue endpoint

Resumes a specific variation from a mid-line branch point, mirroring
the existing /api/practice/attempt and /api/practice/mistake routes.
Read-only — the eventual credit lands via the existing attempt-report
endpoint once the continuation is solved to its end.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Continue in place instead of ending the attempt

**Files:**
- Modify: `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte`

No test file changes — `practice.test.ts` in this directory renders the component from static prop fixtures and never simulates a board move, unaffected by this task (same established convention as the prior branch-alternatives work). Task 4 covers manual verification.

- [ ] **Step 1: Replace the script block**

Replace the entire `<script lang="ts">...</script>` block at the top of `mychess/src/routes/(player)/practice/[repertoire_id]/+page.svelte` (everything from `<script lang="ts">` through its closing `</script>`, i.e. lines 1-328 of the current file) with:

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
	import type { QuizStep } from '$lib/mastery/practice';

	let { data } = $props<{ data: any }>();

	let quizIdx = $state(0);
	let boardFen = $state('');
	// 'advancing' is the brief, non-interactive gap between the final correct
	// move of an attempt (shown as a gold star, not a click-through card) and
	// the next task loading — auto-advances on its own. 'leveled-up' and
	// 'leveled-down' are the only phases that still wait for a Continue click,
	// since those are rarer milestones worth pausing on.
	let phase = $state<'playing' | 'advancing' | 'leveled-up' | 'leveled-down'>('playing');
	let locked = $state(false);
	let replaying = $state(false);
	// Consecutive wrong attempts on the CURRENT quiz move — resets the moment
	// it's solved or a new attempt starts. After 3, a hint becomes available;
	// requesting it highlights the correct piece's square, never the move.
	let wrongCount = $state(0);
	let hintRequested = $state(false);
	// Whether THIS ATTEMPT (not just this move) has had any mistake yet —
	// reset only in resetForAttempt(), reported once when the attempt
	// finishes (see reportAttempt). Previous-level-band mistakes are NOT
	// tracked here — those are reported the instant they happen (see
	// reportPreviousLevelMistake), not batched until the attempt completes,
	// so demotion can fire even if the player never gets this move right.
	let attemptHadMistake = $state(false);
	let advanceTimeout: ReturnType<typeof setTimeout> | undefined;
	// How long the leveled-up/leveled-down banner stays up before auto-
	// advancing into the next attempt — long enough to actually read the
	// message, unlike the brief per-move hold above.
	const LEVEL_TRANSITION_HOLD_MS = 1800;
	let levelTransitionTimeout: ReturnType<typeof setTimeout> | undefined;
	// Bumped on every resetForAttempt() call so an in-flight prefix replay
	// (or a mid-flight branch continuation fetch) notices it's been
	// superseded (e.g. rapid re-navigation) and stops writing to state
	// instead of racing a newer reset.
	let resetToken = 0;
	// The attempt-report POST is fire-and-forget from handleMove's final move
	// (so the board never blocks on the network) — but nextAttempt must await
	// it before reloading, or invalidateAll() can race the write and re-serve
	// the same task, making Continue look like it did nothing.
	let pendingReport: Promise<unknown> | null = null;
	// The in-progress attempt's remaining quiz steps — seeded from
	// attempt.quizSteps on every resetForAttempt(), but extended in place
	// when a mid-line 'continue' branch is taken (see handleMove) rather than
	// staying a pure derived read of `attempt`, since a continuation only
	// exists client-side until the attempt is completed or abandoned.
	let liveQuizSteps = $state<QuizStep[]>([]);
	// Which task to credit if the attempt is completed — starts as the
	// pinned attempt's own taskKey, reassigned to the continued line's
	// taskKey each time a 'continue' branch is taken, so completing a
	// (possibly repeatedly) continued line credits the LAST line actually
	// walked, not the one the attempt originally pinned.
	let creditTaskKey = $state<string | null>(null);

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
		const step = liveQuizSteps[quizIdx];
		if (!step) return null;
		try {
			return new Chess(step.fromFen).move(step.san)?.from ?? null;
		} catch {
			return null;
		}
	});

	function advanceThroughOpponentReplies() {
		while (liveQuizSteps[quizIdx] && !liveQuizSteps[quizIdx].isPlayerTurn) {
			boardFen = liveQuizSteps[quizIdx].toFen;
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
		clearTimeout(levelTransitionTimeout);
		quizIdx = 0;
		phase = 'playing';
		locked = false;
		replaying = false;
		wrongCount = 0;
		hintRequested = false;
		attemptHadMistake = false;
		liveQuizSteps = attempt?.quizSteps ?? [];
		creditTaskKey = attempt?.taskKey ?? null;
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
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- deliberate Svelte dependency-tracking read, not a no-op statement
		repertoireId;
		untrack(() => resetForAttempt());
	});

	async function fetchContinuation(
		activeReviewLevel: number | null,
		variationKey: string,
		afterPlayerMoveIndex: number
	): Promise<{ quizSteps: QuizStep[]; taskKey: string } | null> {
		try {
			const res = await fetch('/api/practice/continue', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					repertoireId,
					level: activeReviewLevel ?? data.level,
					variationKey,
					afterPlayerMoveIndex
				})
			});
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		}
	}

	function handleMove(detail: { from: Key; to: Key; san: string }) {
		if (phase !== 'playing' || locked || replaying) return false;
		const myToken = resetToken;
		const currentReviewLevel = reviewLevel;
		const step = liveQuizSteps[quizIdx];
		if (!step) return false;

		if (detail.san === step.san) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;
			// Whether THIS move is the last one in the attempt — decided now,
			// synchronously, since ChessBoard needs the star-vs-check choice at
			// move time, before the 500ms hold below even starts.
			const isFinalMove = quizIdx + 1 >= liveQuizSteps.length;
			// Fire the completion report NOW, before the hold below, not after
			// it — the report's own network round trip then overlaps with the
			// 500ms hold instead of stacking after it. nextAttempt() still
			// awaits pendingReport before reloading, so correctness (never
			// reloading before the write lands) is unchanged. Reports
			// creditTaskKey, not this attempt's originally-pinned key — if a
			// branch was continued earlier in this same attempt, that's the
			// line actually being finished right now. Skipped during review,
			// which is a pure read-only replay. Uses the REVIEW-LEVEL CAPTURED
			// AT THE TOP of this function, not the live reactive value — the
			// player can navigate to a different level or exit review during
			// the hold, which changes `reviewLevel` without going through
			// resetForAttempt(), and reporting against a live (wrong) value
			// would corrupt an unrelated task's progress.
			if (isFinalMove && currentReviewLevel === null && creditTaskKey) {
				pendingReport = reportAttempt(creditTaskKey);
			}
			// Hold the board here so the check/star is actually visible before
			// advancing — updating boardFen in the same tick would clear it
			// before the browser ever paints it.
			advanceTimeout = setTimeout(() => {
				boardFen = step.toFen;
				quizIdx++;
				advanceThroughOpponentReplies();
				locked = false;
				if (quizIdx >= liveQuizSteps.length) {
					// No confirmation click for a plain solve — auto-advance
					// straight to the next task. `nextAttempt()` still pauses on
					// a leveled-up/leveled-down banner itself when relevant.
					phase = 'advancing';
					nextAttempt();
				}
			}, 500);
			return isFinalMove ? 'final' : true;
		}

		// Not the pinned answer — but the repertoire may allow more than one
		// reply at this exact position (see splitAttempt/alternativesAt).
		// Accept it rather than forcing the player to guess which of their own
		// memorized options this particular attempt happened to pin.
		const alt = step.alternatives.find((a: QuizStep['alternatives'][number]) => a.san === detail.san);
		if (alt) {
			playCorrect();
			locked = true;
			wrongCount = 0;
			hintRequested = false;

			if (alt.kind === 'completes') {
				// Lands on another task's own target-depth move — finishes it
				// immediately, same as solving the pinned line's own final move.
				if (currentReviewLevel === null) pendingReport = reportAttempt(alt.taskKey);
				advanceTimeout = setTimeout(() => {
					locked = false;
					phase = 'advancing';
					nextAttempt();
				}, 500);
				return 'final';
			}

			if (alt.kind === 'dead-end') {
				// A shorter sibling already fully resolved at an earlier level —
				// nothing left to continue, nothing to credit. Accept, end
				// cleanly, leave the originally-pinned task untouched for
				// another attempt.
				advanceTimeout = setTimeout(() => {
					locked = false;
					phase = 'advancing';
					nextAttempt();
				}, 500);
				return true;
			}

			// alt.kind === 'continue' — this line has more content ahead.
			// Resume it in place instead of ending the attempt: fetch the rest
			// of that specific line and splice it into the live quiz sequence,
			// so play continues seamlessly rather than dropping the player
			// into an unrelated fresh attempt.
			const afterPlayerMoveIndex = step.playerMoveIndex;
			const branchIdx = quizIdx;
			advanceTimeout = setTimeout(async () => {
				boardFen = alt.toFen;
				const continuation = await fetchContinuation(currentReviewLevel, alt.variationKey, afterPlayerMoveIndex);
				if (myToken !== resetToken) return; // superseded while we were awaiting
				locked = false;
				if (!continuation) {
					// Fetch failed — fall back to the dead-end behavior above
					// rather than leaving the player stuck mid-attempt.
					phase = 'advancing';
					nextAttempt();
					return;
				}
				liveQuizSteps = [...liveQuizSteps.slice(0, branchIdx + 1), ...continuation.quizSteps];
				creditTaskKey = continuation.taskKey;
				quizIdx = branchIdx + 1;
				advanceThroughOpponentReplies();
				if (quizIdx >= liveQuizSteps.length) {
					// The continuation completed immediately (nothing left after
					// auto-playing the opponent's reply) — same as any other
					// end-of-attempt completion.
					phase = 'advancing';
					if (currentReviewLevel === null) pendingReport = reportAttempt(creditTaskKey);
					nextAttempt();
				}
				// Otherwise phase stays 'playing' — no restart, just resume.
			}, 500);
			return true;
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
		} catch {
			// Report failed — the attempt itself already played out on the
			// board; just skip silently rather than blocking the player on a
			// network hiccup. Worst case: the same task is served again.
		}
	}

	// Fires the instant a wrong move lands on review material — not batched
	// until the attempt completes, since a player who keeps failing this
	// exact move and never gets it right would otherwise never accumulate
	// enough mistakes to demote, no matter how many times they fail it. If
	// this was the demoting mistake, abandon the in-flight attempt right
	// away rather than let the player keep playing against a now-stale quiz.
	async function reportPreviousLevelMistake() {
		try {
			const res = await fetch('/api/practice/mistake', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repertoireId })
			});
			const result = await res.json();
			if (result?.demoted) await handleMidAttemptDemotion();
		} catch {
			// Report failed — worst case this one mistake isn't counted; the
			// player just needs one more before demotion fires.
		}
	}

	// A demotion detected mid-attempt (not at the natural end-of-attempt
	// point `nextAttempt` handles) — the in-flight quiz was built for the
	// level just left, so abandon it and show the same banner a
	// completion-triggered demotion would.
	async function handleMidAttemptDemotion() {
		const myToken = resetToken;
		clearTimeout(advanceTimeout);
		locked = true;
		phase = 'advancing';
		await invalidateAll();
		if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were awaiting
		phase = 'leveled-down';
		scheduleLevelTransition();
	}

	function levelRank(level: number | 'mastered'): number {
		return level === 'mastered' ? Infinity : level;
	}

	// Holds the leveled-up/leveled-down banner up long enough to read, then
	// auto-advances into the next attempt — no confirmation click needed.
	function scheduleLevelTransition() {
		const myToken = resetToken;
		clearTimeout(levelTransitionTimeout);
		levelTransitionTimeout = setTimeout(() => {
			if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were waiting
			resetForAttempt();
		}, LEVEL_TRANSITION_HOLD_MS);
	}

	async function nextAttempt() {
		const levelBefore = data.level;
		const myToken = resetToken;
		if (pendingReport) await pendingReport;
		pendingReport = null;
		await invalidateAll();
		if (myToken !== resetToken) return; // superseded by a resetForAttempt() while we were awaiting
		// `data` now reflects the fresh load. If completing that attempt
		// changed the active level — up on mastering it, or down on a
		// demotion — surface that instead of silently dropping the player
		// into the next quiz. Never applies during review: reviewing a passed
		// level can't change which level is active.
		if (reviewLevel === null && levelRank(data.level) > levelRank(levelBefore)) {
			phase = 'leveled-up';
			scheduleLevelTransition();
		} else if (reviewLevel === null && levelRank(data.level) < levelRank(levelBefore)) {
			phase = 'leveled-down';
			scheduleLevelTransition();
		} else {
			resetForAttempt();
		}
	}
</script>
```

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
feat: continue a mid-line branch in place instead of restarting

The quiz steps for an in-progress attempt become live, extendable
state (liveQuizSteps) instead of a pure read of the server-provided
attempt, so a 'continue' branch alternative can splice in a fetched
continuation and resume play seamlessly — no restart, no dropping the
player into an unrelated fresh attempt. creditTaskKey tracks which
task to report on completion, reassigned each time a branch is
continued so a repeatedly-continued line credits the line actually
walked. 'completes' and 'dead-end' alternatives behave as before.

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

Open a repertoire in Practice with **no** branches and confirm normal solving is unaffected: correct pinned move advances/levels up as usual, wrong move shows the red cross and lets you retry.

- [ ] **Step 3: Exercise a 'completes' branch**

Using a repertoire with two variations sharing a prefix and diverging on their final tested move, play the *other* branch's move there. Confirm: green check/star feedback, the attempt ends, and revisiting the page later shows that branch's task counted toward `levelSolvedCount` while the originally-queued one is still pending. (Same as the prior branch-alternatives feature — should be unchanged.)

- [ ] **Step 4: Exercise a 'continue' branch (the new behavior)**

Using a repertoire where a shared prefix branches before either line's own target-depth move (a level 2+ attempt spans multiple player moves), play the non-pinned branch partway through. Confirm: accepted with a check, a brief pause (watch for how long this actually feels — this is the tradeoff flagged in the design spec), then play resumes on the SAME board with no restart animation and no jump to an unrelated attempt. Solve the rest of that line and confirm it credits correctly (revisit the page, check `levelSolvedCount` reflects the continued line's own task, not the originally-pinned one).

- [ ] **Step 5: Exercise a nested 'continue' (branch within a branch)**

If a repertoire has a line that branches more than once, take a 'continue' branch and then, within the fetched continuation, take ANOTHER branch. Confirm it resumes again rather than falling back to ending the attempt — proving recursion works end-to-end, not just at the unit-test level.

- [ ] **Step 6: Exercise the continuation-fetch-failure fallback**

Hard to trigger organically — if feasible, simulate a network failure (e.g. browser dev tools "offline" toggled briefly right as a 'continue' branch is taken) and confirm it falls back to ending the attempt cleanly (today's dead-end behavior) rather than getting stuck with a locked board.

- [ ] **Step 7: Confirm review mode is unaffected**

From the Level List, review an already-passed level containing a branch and confirm 'continue' branches are still fetched and resumed for visual consistency, but nothing is persisted (progress numbers unchanged after review moves).

- [ ] **Step 8: Run the full verification suite one more time**

Run: `cd mychess && npm test && npm run check`
Expected: all tests pass, `0 ERRORS`.
