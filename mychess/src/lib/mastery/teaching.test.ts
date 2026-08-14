import { describe, it, expect } from 'vitest';
import { resolveTeachingStep, advanceTeachingProgress, arrowMoveForStep } from './teaching';
import type { VariationStep } from './variations';

/** Player moves first (ply 0), like a White repertoire's own line. */
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

/** Opponent moves first (ply 0), like a Black repertoire's own line. */
function makeOpponentFirstPath(plies: number): VariationStep[] {
	const path: VariationStep[] = [];
	for (let i = 0; i < plies; i++) {
		path.push({
			moveId: `q${i}`,
			san: `N${i}`,
			fromFen: `g${i}a`,
			toFen: `g${i}b`,
			isPlayerTurn: i % 2 === 1
		});
	}
	return path;
}

describe('resolveTeachingStep', () => {
	it('teaches the very first batch (moves 1-5) from a fresh variation\'s first attempt, ending right after the player\'s 5th move', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 0, 0);
		// Player moves are at even plies (0, 2, 4, 6, 8) here — the 5th one is
		// ply 8, so the batch is 9 plies (0-8), NOT a flat 10: including the
		// opponent's ply-9 reply would end the batch on the OPPONENT's move,
		// and the player is never asked to move at the array's last index, so
		// the "final move" check that fires the star badge / attempt-report
		// would never trigger.
		expect(step.path).toEqual(path.slice(0, 9));
		expect(step.arrowPlies).toEqual({ from: 0, to: 9 });
		expect(step.isFinalPass).toBe(false);
		expect(step.path[step.path.length - 1].isPlayerTurn).toBe(true);
	});

	it('a batch still ends right after the player\'s 5th move when the opponent moves first', () => {
		const path = makeOpponentFirstPath(25);
		const step = resolveTeachingStep(path, 0, 0);
		// Player moves are at odd plies (1, 3, 5, 7, 9) here — the 5th one is
		// ply 9, so this batch is 10 plies, not 9. Batch width isn't fixed;
		// only "ends on the player's own move" is.
		expect(step.path).toEqual(path.slice(0, 10));
		expect(step.arrowPlies).toEqual({ from: 0, to: 10 });
		expect(step.path[step.path.length - 1].isPlayerTurn).toBe(true);
	});

	it('teaches its entire (short) path when a variation is no longer than one batch', () => {
		const path = makePath(6);
		const step = resolveTeachingStep(path, 0, 0);
		expect(step.path).toEqual(path);
		expect(step.arrowPlies).toEqual({ from: 0, to: 6 });
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
	it('leaves both counters exactly unchanged on a mistake', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 3, 3, true);
		expect(result).toEqual({ taughtPlies: 3, masteredPlies: 3, solved: false });
	});

	it('a clean teach pass on a fresh variation advances taught_plies to the first batch end only', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 0, 0, false);
		expect(result).toEqual({ taughtPlies: 9, masteredPlies: 0, solved: false });
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

	it('a short (one-batch) variation still needs a clean teach pass before it can be solved', () => {
		const path = makePath(6);
		const result = advanceTeachingProgress(path, 0, 0, false);
		expect(result).toEqual({ taughtPlies: 6, masteredPlies: 0, solved: false });
	});

	it('a short (one-batch) variation solves on the blind retest right after its teach pass', () => {
		const path = makePath(6);
		const result = advanceTeachingProgress(path, 6, 0, false);
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
