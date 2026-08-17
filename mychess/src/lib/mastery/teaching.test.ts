import { describe, it, expect } from 'vitest';
import {
	resolveTeachingStep,
	advanceTeachingProgress,
	arrowMoveForStep,
	sharedMasteredPrefixLength,
	computeMasteredMoveIds,
	isLastPlayerMove,
	effectiveProgress
} from './teaching';
import type { Variation, VariationStep } from './variations';

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

function makeVariation(variationKey: string, path: VariationStep[]): Variation {
	return {
		leafMoveId: path[path.length - 1].moveId,
		variationKey,
		path,
		playerMoveCount: path.filter((s) => s.isPlayerTurn).length,
		chapterNames: []
	};
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

	it('reports a teach batch that reaches the path\'s end over an already-mastered prefix as the FINAL pass', () => {
		const path = makePath(16); // 8 player moves: batch 1 is plies 0-8, batch 2 the rest
		const step = resolveTeachingStep(path, 9, 9);
		expect(step.path).toEqual(path);
		// Still a teach pass — the new tail is still arrowed — but nothing is
		// left to teach afterwards, so no separate blind retest of the same
		// tail follows it (issue #68).
		expect(step.arrowPlies).toEqual({ from: 9, to: 16 });
		expect(step.isFinalPass).toBe(true);
	});

	it('does NOT treat a fresh single-batch variation\'s first teach pass as final — it has never been played blind', () => {
		const path = makePath(6);
		const step = resolveTeachingStep(path, 0, 0);
		expect(step.arrowPlies).toEqual({ from: 0, to: 6 });
		expect(step.isFinalPass).toBe(false);
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

	it('a clean FINAL teach pass masters everything it just taught and solves the variation', () => {
		const path = makePath(16);
		const result = advanceTeachingProgress(path, 9, 9, false);
		expect(result).toEqual({ taughtPlies: 16, masteredPlies: 16, solved: true });
	});

	it('a mistake on a final teach pass still changes nothing — the same teach pass is re-served', () => {
		const path = makePath(16);
		const result = advanceTeachingProgress(path, 9, 9, true);
		expect(result).toEqual({ taughtPlies: 9, masteredPlies: 9, solved: false });
	});
});

/**
 * Drives the REAL read/write pair the way the server does — serve a step,
 * report a clean attempt, feed the resulting counters back in — and reports
 * how many clean attempts a variation takes to reach solved, plus what kind
 * of pass each one was. This is what the issue's "how many times must I
 * replay this before it counts?" complaint actually measures.
 */
function cleanRunToSolved(path: VariationStep[]): { attempts: number; passes: ('teach' | 'blind')[] } {
	let taughtPlies = 0;
	let masteredPlies = 0;
	const passes: ('teach' | 'blind')[] = [];
	// A generous bound: a genuine regression here would loop forever otherwise.
	for (let i = 0; i < 100; i++) {
		const step = resolveTeachingStep(path, taughtPlies, masteredPlies);
		passes.push(step.arrowPlies ? 'teach' : 'blind');
		const next = advanceTeachingProgress(path, taughtPlies, masteredPlies, false);
		expect(next).not.toEqual({ taughtPlies, masteredPlies, solved: false }); // no stuck state
		taughtPlies = next.taughtPlies;
		masteredPlies = next.masteredPlies;
		if (next.solved) return { attempts: passes.length, passes };
	}
	throw new Error('never reached solved');
}

describe('clean attempts needed to solve a variation', () => {
	it('an 8-move variation (shorter than two full batches) solves in 3 clean attempts, not 4', () => {
		// 16 plies / 8 player moves, split 5 + 3 by TEACHING_BATCH_MOVES. Before
		// issue #68 this was teach(1-5) → blind(1-5) → teach(6-8) → blind(6-8) =
		// 4 clean attempts; the trailing blind retest of the just-taught tail
		// was identical to the teach pass that preceded it (same served path,
		// same auto-played mastered prefix, same manual tail — only the arrows
		// differed), so it's gone.
		expect(cleanRunToSolved(makePath(16))).toEqual({ attempts: 3, passes: ['teach', 'blind', 'teach'] });
	});

	it('the same holds for an 8-move variation where the opponent moves first', () => {
		// Opponent-first parity shifts every batch boundary by a ply; the count
		// of clean attempts must not depend on it.
		expect(cleanRunToSolved(makeOpponentFirstPath(16))).toEqual({ attempts: 3, passes: ['teach', 'blind', 'teach'] });
	});

	it('a variation longer than two batches keeps the unchanged teach/blind-retest alternation', () => {
		// 25 plies / 13 player moves = three batches. Every batch except the
		// last still earns its own blind retest, in the same order as before —
		// only the final batch's redundant trailing retest is gone (6 clean
		// attempts before issue #68, 5 now).
		expect(cleanRunToSolved(makePath(25))).toEqual({
			attempts: 5,
			passes: ['teach', 'blind', 'teach', 'blind', 'teach']
		});
	});

	it('a variation of one batch or less still takes 2 clean attempts: taught once, then played blind once', () => {
		// Unchanged by issue #68 on purpose — with nothing mastered behind it,
		// skipping this variation's only blind retest would mark it solved
		// without it ever having been played from memory.
		expect(cleanRunToSolved(makePath(6))).toEqual({ attempts: 2, passes: ['teach', 'blind'] });
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

describe('isLastPlayerMove', () => {
	it('is true at the last ply of a path that ends on the player\'s own move', () => {
		const path = makePath(6); // player-first: plies 0,2,4 are the player's
		expect(isLastPlayerMove(path, 4)).toBe(true);
	});

	it('is false when a later player-turn ply still follows', () => {
		const path = makePath(6);
		expect(isLastPlayerMove(path, 2)).toBe(false);
	});

	it('is true at the player\'s own last move even when a trailing opponent-only run follows it', () => {
		// e.g. a variation whose true leaf is the opponent's reply — the
		// player is never asked to move at that trailing ply, so their own
		// last move (ply 4) must still count as "final", not ply 5.
		const path = [...makePath(5), { moveId: 'p5', san: 'M5', fromFen: 'f5a', toFen: 'f5b', isPlayerTurn: false }];
		expect(isLastPlayerMove(path, 4)).toBe(true);
		expect(path[path.length - 1].isPlayerTurn).toBe(false);
	});
});

describe('sharedMasteredPrefixLength', () => {
	it('returns 0 when nothing is mastered', () => {
		const path = makePath(6);
		expect(sharedMasteredPrefixLength(path, new Set())).toBe(0);
	});

	it('returns the full length when every ply\'s moveId is mastered', () => {
		const path = makePath(6);
		const mastered = new Set(path.map((s) => s.moveId));
		expect(sharedMasteredPrefixLength(path, mastered)).toBe(6);
	});

	it('stops at the first ply whose moveId is not mastered', () => {
		const path = makePath(6);
		const mastered = new Set([path[0].moveId, path[1].moveId, path[2].moveId]);
		expect(sharedMasteredPrefixLength(path, mastered)).toBe(3);
	});

	it('does not skip over a gap — a mastered moveId past an unmastered one does not extend the prefix', () => {
		const path = makePath(6);
		const mastered = new Set([path[0].moveId, path[2].moveId]); // path[1] missing
		expect(sharedMasteredPrefixLength(path, mastered)).toBe(1);
	});
});

describe('computeMasteredMoveIds', () => {
	it('includes every moveId of a fully-solved variation, regardless of its teachingProgress row', () => {
		const path = makePath(6);
		const v = makeVariation('v1', path);
		const mastered = computeMasteredMoveIds([v], new Map(), new Set(['v1']));
		expect(mastered).toEqual(new Set(path.map((s) => s.moveId)));
	});

	it('includes only a variation\'s own mastered prefix when it is not fully solved', () => {
		const path = makePath(6);
		const v = makeVariation('v1', path);
		const progress = new Map([['v1', { taughtPlies: 6, masteredPlies: 3 }]]);
		const mastered = computeMasteredMoveIds([v], progress, new Set());
		expect(mastered).toEqual(new Set(path.slice(0, 3).map((s) => s.moveId)));
	});

	it('contributes nothing for a variation with no progress row that is not solved', () => {
		const path = makePath(6);
		const v = makeVariation('v1', path);
		const mastered = computeMasteredMoveIds([v], new Map(), new Set());
		expect(mastered).toEqual(new Set());
	});

	it('unions contributions across multiple variations', () => {
		const pathA = makePath(6);
		const pathB = makeOpponentFirstPath(4);
		const a = makeVariation('a', pathA);
		const b = makeVariation('b', pathB);
		const progress = new Map([['a', { taughtPlies: 6, masteredPlies: 2 }]]);
		const mastered = computeMasteredMoveIds([a, b], progress, new Set(['b']));
		expect(mastered).toEqual(new Set([...pathA.slice(0, 2).map((s) => s.moveId), ...pathB.map((s) => s.moveId)]));
	});
});

describe('effectiveProgress', () => {
	it('takes the higher of the own counters or the shared floor', () => {
		expect(effectiveProgress(5, 3, 8, false)).toEqual({ taughtPlies: 8, masteredPlies: 8 });
		expect(effectiveProgress(10, 6, 2, false)).toEqual({ taughtPlies: 10, masteredPlies: 6 });
	});

	it('zeroes both counters entirely when resumedAfterBreak is true, ignoring the shared floor too', () => {
		expect(effectiveProgress(20, 10, 15, true)).toEqual({ taughtPlies: 0, masteredPlies: 0 });
	});
});
