// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { pickPracticeAttempt, pickReviewAttempt, splitAttempt } from './practice';
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

describe('pickPracticeAttempt', () => {
	it('returns null when every variation is already satisfied at the level', () => {
		const v = makeVariation(3, 'done-');
		const correct = new Set(['done-p1', 'done-p2', 'done-p3']);
		expect(pickPracticeAttempt([v], 1, correct)).toBeNull();
	});

	it('picks a not-yet-satisfied variation and computes its target depth', () => {
		const v = makeVariation(10, 'leaf1-');
		const result = pickPracticeAttempt([v], 2, new Set(), () => 0.5); // deterministic "random"
		expect(result).not.toBeNull();
		expect(result!.variation.leafMoveId).toBe(v.leafMoveId);
		expect(result!.targetDepth).toBe(6); // level 2 depth
	});

	it('never picks a variation that is already satisfied, even if others are not', () => {
		const done = makeVariation(3, 'done-');
		const notDone = makeVariation(10, 'notdone-');
		const correct = new Set(['done-p1', 'done-p2', 'done-p3']);
		// random() always returns 0 -> would pick index 0 if `done` were a candidate
		const result = pickPracticeAttempt([done, notDone], 1, correct, () => 0);
		expect(result!.variation.leafMoveId).toBe(notDone.leafMoveId);
	});
});

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

describe('splitAttempt', () => {
	it('at level 1, auto-plays nothing and quizzes through the 3rd player move', () => {
		const v = makeVariation(4, 'x-');
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 3);
		expect(prefix).toHaveLength(0);
		expect(quizSteps).toHaveLength(5); // p1,o1,p2,o2,p3
		expect(quizSteps[quizSteps.length - 1].moveId).toBe('x-p3');
		expect(quizSteps[quizSteps.length - 1].isPlayerTurn).toBe(true);
	});

	it('at level 2, auto-plays through the 3rd player move (both colors) and the player starts on the 4th', () => {
		const v = makeVariation(6, 'y-');
		const { prefix, quizSteps } = splitAttempt(v.path, 2, 6);
		expect(prefix.map((s) => s.moveId)).toEqual(['y-p1', 'y-o1', 'y-p2', 'y-o2', 'y-p3', 'y-o3']);
		expect(quizSteps[0].moveId).toBe('y-p4');
		expect(quizSteps[0].isPlayerTurn).toBe(true);
	});

	it("collapses to the variation's own length when shorter than the level depth", () => {
		const v = makeVariation(2, 'z-');
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 2); // targetDepth = min(2,3) = 2
		expect(prefix).toHaveLength(0);
		expect(quizSteps[quizSteps.length - 1].moveId).toBe('z-p2');
	});

	it("throws when the level's auto-play boundary is not below the target depth", () => {
		const v = makeVariation(3, 'w-');
		expect(() => splitAttempt(v.path, 1, 3)).not.toThrow(); // sanity: a valid case at level 1
		// At level 2 the auto-play boundary (3) is not below a target depth of 3 —
		// this variation has no interactive room left at level 2 and should never
		// have been picked by pickPracticeAttempt in the first place.
		expect(() => splitAttempt(v.path, 2, 3)).toThrow();
	});
});
