import { describe, it, expect } from 'vitest';
import { resolveTeachingStep, advanceTeachingProgress, arrowMoveForStep } from './teaching';
import type { VariationStep } from './variations';

function makePath(plies: number): VariationStep[] {
	const path: VariationStep[] = [];
	for (let i = 0; i < plies; i++) {
		path.push({
			moveId: `p${i}`,
			san: `M${i}`,
			fromFen: `f${i}a`,
			toFen: `f${i}b`,
			isPlayerTurn: i % 2 === 0
		});
	}
	return path;
}

describe('resolveTeachingStep', () => {
	it('never teaches a variation no longer than the free zone (5 moves / 10 plies)', () => {
		const path = makePath(6);
		const step = resolveTeachingStep(path, 0, 0);
		expect(step).toEqual({ path, arrowPlies: null, isFinalPass: true });
	});

	it('teaches the first batch beyond the free zone for a fresh, deeper variation', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 0, 0);
		expect(step.path).toEqual(path.slice(0, 20));
		expect(step.arrowPlies).toEqual({ from: 10, to: 20 });
		expect(step.isFinalPass).toBe(false);
	});

	it('blind-retests up to the taught depth once a batch is taught but not yet mastered', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 20, 10);
		expect(step.path).toEqual(path.slice(0, 20));
		expect(step.arrowPlies).toBeNull();
		expect(step.isFinalPass).toBe(false);
	});

	it('reports the final batch\'s blind retest as the final pass', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 25, 20);
		expect(step.path).toEqual(path);
		expect(step.arrowPlies).toBeNull();
		expect(step.isFinalPass).toBe(true);
	});

	it('serves the full path with no arrow once every batch is mastered', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 25, 25);
		expect(step).toEqual({ path, arrowPlies: null, isFinalPass: true });
	});
});

describe('advanceTeachingProgress', () => {
	it('leaves both counters unchanged (floored to the free zone) on a mistake', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 3, 3, true);
		expect(result).toEqual({ taughtPlies: 10, masteredPlies: 10, solved: false });
	});

	it('a clean teach pass advances taught_plies to the batch end only', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 0, 0, false);
		expect(result).toEqual({ taughtPlies: 20, masteredPlies: 10, solved: false });
	});

	it('a clean non-final blind retest advances mastered_plies to match taught_plies', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 20, 10, false);
		expect(result).toEqual({ taughtPlies: 20, masteredPlies: 20, solved: false });
	});

	it('a clean final blind retest reports solved', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 25, 20, false);
		expect(result).toEqual({ taughtPlies: 25, masteredPlies: 25, solved: true });
	});

	it('a variation no longer than the free zone is solved on its very first clean attempt', () => {
		const path = makePath(6);
		const result = advanceTeachingProgress(path, 0, 0, false);
		expect(result).toEqual({ taughtPlies: 6, masteredPlies: 6, solved: true });
	});
});

describe('arrowMoveForStep', () => {
	const playedE4: VariationStep = {
		moveId: 'm1',
		san: 'e4',
		fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
		toFen: 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/8/RNBQKBNR w KQkq - 0 1',
		isPlayerTurn: true
	};

	it('returns null when there is no arrow range', () => {
		expect(arrowMoveForStep(playedE4, 12, null)).toBeNull();
	});

	it('returns null when the ply index is outside the arrow range', () => {
		expect(arrowMoveForStep(playedE4, 9, { from: 10, to: 20 })).toBeNull();
		expect(arrowMoveForStep(playedE4, 20, { from: 10, to: 20 })).toBeNull();
	});

	it('returns null for an opponent-turn ply even inside the arrow range', () => {
		const opponentStep = { ...playedE4, isPlayerTurn: false };
		expect(arrowMoveForStep(opponentStep, 12, { from: 10, to: 20 })).toBeNull();
	});

	it('returns the correct move\'s from/to squares for a player-turn ply inside the arrow range', () => {
		expect(arrowMoveForStep(playedE4, 12, { from: 10, to: 20 })).toEqual({ from: 'e2', to: 'e4' });
	});

	it('returns null if the san cannot be parsed against fromFen', () => {
		const badStep = { ...playedE4, san: 'Zz9' };
		expect(arrowMoveForStep(badStep, 12, { from: 10, to: 20 })).toBeNull();
	});
});
