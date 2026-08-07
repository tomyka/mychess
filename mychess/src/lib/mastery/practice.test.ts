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

	it('marks a taskKey null when the sibling variation is shorter and already had no content left at this level', () => {
		// b ends exactly at the branch (2 player moves total) — it was already
		// fully resolved as a task back at level 1 (depth 3 >= 2), so it has no
		// content left at level 2's own depth window (hasContentAtLevel is
		// false), even though the branch position numerically equals its own
		// targetDepth for level 2 too. That numeric coincidence must NOT be
		// treated as a live task boundary at level 2 — there's no such queue
		// entry to credit.
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
