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
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 3);
		expect(prefix).toHaveLength(0);
		expect(quizSteps.map((s) => s.moveId)).toEqual(['x-p1', 'x-o1', 'x-p2', 'x-o2', 'x-p3']);
		expect(quizSteps.every((s) => s.band === 'current')).toBe(true);
	});

	it('at level 2, auto-plays nothing and asks both level 1 (previous) and level 2 (current) material', () => {
		const v = makeVariation(6, 'y-');
		const { prefix, quizSteps } = splitAttempt(v.path, 2, 6);
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
		const { prefix, quizSteps } = splitAttempt(v.path, 3, 9);
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
