// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { pickPracticeAttempt, splitAttempt } from './practice';
import type { Variation } from './variations';

function makeVariation(leafMoveId: string, playerMoveCount: number): Variation & { deepestReached: number } {
	const path = [];
	for (let i = 0; i < playerMoveCount * 2; i++) {
		const isPlayerTurn = i % 2 === 0;
		path.push({
			moveId: i === playerMoveCount * 2 - 1 ? leafMoveId : `${leafMoveId}-step${i}`,
			san: `san${i}`,
			fromFen: `fen${i}`,
			toFen: `fen${i + 1}`,
			isPlayerTurn
		});
	}
	const variationKey = path.map((s) => s.moveId).join('>');
	return { leafMoveId, variationKey, path, playerMoveCount, deepestReached: 0 };
}

describe('pickPracticeAttempt', () => {
	it('returns null when every variation is already satisfied at the level', () => {
		const v = { ...makeVariation('leaf1', 4), deepestReached: 4 };
		expect(pickPracticeAttempt([v], 1)).toBeNull();
	});

	it('picks a not-yet-satisfied variation and a start point below its target depth', () => {
		const v = makeVariation('leaf1', 10);
		const result = pickPracticeAttempt([v], 2, () => 0.5); // deterministic "random"
		expect(result).not.toBeNull();
		expect(result!.variation.leafMoveId).toBe('leaf1');
		expect(result!.targetDepth).toBe(6); // level 2 depth
		expect(result!.startPoint).toBeGreaterThanOrEqual(0);
		expect(result!.startPoint).toBeLessThan(6);
	});

	it('never picks a variation that is already satisfied, even if others are not', () => {
		const done = { ...makeVariation('done', 4), deepestReached: 4 };
		const notDone = makeVariation('notdone', 10);
		// random() always returns 0 -> would pick index 0 if it were a candidate
		const result = pickPracticeAttempt([done, notDone], 1, () => 0);
		expect(result!.variation.leafMoveId).toBe('notdone');
	});
});

describe('splitAttempt', () => {
	it('auto-plays nothing and quizzes through the final required player move when startPoint is 0', () => {
		const v = makeVariation('leaf1', 3);
		const { prefix, quizSteps } = splitAttempt(v.path, 0, 3);
		expect(prefix).toHaveLength(0);
		// v.path has 6 steps (3 player + 3 opponent, alternating, starting on player).
		// quizSteps covers everything through the 3rd (final) player move — index 4 —
		// but excludes the trailing opponent-only step (index 5): 5 steps, not 6.
		expect(quizSteps).toHaveLength(5);
	});

	it('auto-plays the known prefix and quizzes only the remaining moves', () => {
		const v = makeVariation('leaf1', 3);
		// path: [p0(player), o0(opp), p1(player), o1(opp), p2(player), o2(opp)]
		const { prefix, quizSteps } = splitAttempt(v.path, 1, 3);
		expect(prefix.map((s) => s.moveId)).toEqual([v.path[0].moveId, v.path[1].moveId]);
		expect(quizSteps[0].isPlayerTurn).toBe(true);
		expect(quizSteps[0].moveId).toBe(v.path[2].moveId);
	});

	it('stops exactly at the target depths final player move, not beyond', () => {
		const v = makeVariation('leaf1', 5);
		const { quizSteps } = splitAttempt(v.path, 0, 2);
		const lastStep = quizSteps[quizSteps.length - 1];
		expect(lastStep.isPlayerTurn).toBe(true);
		expect(lastStep.moveId).toBe(v.path[2].moveId); // the 2nd player move is at path index 2
	});

	it('throws when targetDepthValue exceeds the number of player moves in the path', () => {
		const v = makeVariation('leaf1', 3);
		expect(() => splitAttempt(v.path, 0, 10)).toThrow();
	});

	it('throws when startPoint is out of range for the path', () => {
		const v = makeVariation('leaf1', 3);
		expect(() => splitAttempt(v.path, 10, 3)).toThrow();
	});
});
