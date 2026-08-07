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
