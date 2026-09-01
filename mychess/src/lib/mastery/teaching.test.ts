import { describe, it, expect } from 'vitest';
import {
	resolveTeachingStep,
	advanceTeachingProgress,
	arrowMoveForStep,
	sharedMasteredPrefixLength,
	computeMasteredMoveIds,
	isLastPlayerMove,
	knownProgressFor,
	ceilingPlyFor,
	isPausedAtCeiling,
	computeBlockedKeys,
	isCeilingReachedAnywhere,
	isLockedForTier
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

/**
 * Builds a `VariationStep[]` from a list of SAN moves, alternating turns
 * starting with the player (ply 0) — the ceiling tests below reason about
 * "the Nth player move" in terms of recognizable SAN (e4, Nf3, ...) rather
 * than opaque `makePath`-style indices, since `ceilingPlyFor`/`ceilingMoveCount`
 * are inherently about player-move counts, not raw ply counts.
 */
function path(sanMoves: string[]): VariationStep[] {
	return sanMoves.map((san, i) => ({
		moveId: `c${i}`,
		san,
		fromFen: `c${i}a`,
		toFen: `c${i}b`,
		isPlayerTurn: i % 2 === 0
	}));
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
	it('teaches the very first batch (moves 1-3) from a fresh variation\'s first attempt, ending right after the player\'s 3rd move', () => {
		const path = makePath(25);
		const step = resolveTeachingStep(path, 0, 0);
		// Player moves are at even plies (0, 2, 4) here — the 3rd one is ply
		// 4, so the batch is 5 plies (0-4), NOT a flat 6: including the
		// opponent's ply-5 reply would end the batch on the OPPONENT's move,
		// and the player is never asked to move at the array's last index, so
		// the "final move" check that fires the star badge / attempt-report
		// would never trigger.
		expect(step.path).toEqual(path.slice(0, 5));
		expect(step.arrowPlies).toEqual({ from: 0, to: 5 });
		expect(step.isFinalPass).toBe(false);
		expect(step.path[step.path.length - 1].isPlayerTurn).toBe(true);
	});

	it('a batch still ends right after the player\'s 3rd move when the opponent moves first', () => {
		const path = makeOpponentFirstPath(25);
		const step = resolveTeachingStep(path, 0, 0);
		// Player moves are at odd plies (1, 3, 5) here — the 3rd one is ply
		// 5, so this batch is 6 plies, not 5. Batch width isn't fixed; only
		// "ends on the player's own move" is.
		expect(step.path).toEqual(path.slice(0, 6));
		expect(step.arrowPlies).toEqual({ from: 0, to: 6 });
		expect(step.path[step.path.length - 1].isPlayerTurn).toBe(true);
	});

	it('teaches its entire (short) path when a variation is no longer than one batch', () => {
		const path = makePath(4);
		const step = resolveTeachingStep(path, 0, 0);
		expect(step.path).toEqual(path);
		expect(step.arrowPlies).toEqual({ from: 0, to: 4 });
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
		expect(step).toEqual({ path, arrowPlies: null, isFinalPass: true, pausedAtCeiling: false });
	});

	it('never reports an arrowed pass as final, not even the last batch', () => {
		const path = makePath(8); // 4 player moves: batch 1 is plies 0-4, batch 2 the rest
		const step = resolveTeachingStep(path, 5, 5);
		expect(step.path).toEqual(path);
		expect(step.arrowPlies).toEqual({ from: 5, to: 8 });
		// The reversal of issue #68's exception: the final batch's moves must be
		// asked for from memory once before the variation counts as learned, so
		// this arrowed pass cannot be the one that solves it.
		expect(step.isFinalPass).toBe(false);
	});

	it('follows the last taught batch with a blind retest of the whole path', () => {
		const path = makePath(8);
		const afterFinalTeach = resolveTeachingStep(path, 8, 5);
		expect(afterFinalTeach.arrowPlies).toBeNull();
		expect(afterFinalTeach.path).toEqual(path);
		expect(afterFinalTeach.isFinalPass).toBe(true);
	});

	it('does NOT treat a fresh single-batch variation\'s first teach pass as final — it has never been played blind', () => {
		const path = makePath(4);
		const step = resolveTeachingStep(path, 0, 0);
		expect(step.arrowPlies).toEqual({ from: 0, to: 4 });
		expect(step.isFinalPass).toBe(false);
	});
});

describe('advanceTeachingProgress', () => {
	it('leaves both counters exactly unchanged on a mistake', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 3, 3, true);
		expect(result).toEqual({ taughtPlies: 3, masteredPlies: 3, solved: false, pausedAtCeiling: false });
	});

	it('a clean teach pass on a fresh variation advances taught_plies to the first batch end only', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 0, 0, false);
		expect(result).toEqual({ taughtPlies: 5, masteredPlies: 0, solved: false, pausedAtCeiling: false });
	});

	it('a clean non-final blind retest advances mastered_plies to match taught_plies', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 20, 10, false);
		expect(result).toEqual({ taughtPlies: 20, masteredPlies: 20, solved: false, pausedAtCeiling: false });
	});

	it('a clean final blind retest reports solved', () => {
		const path = makePath(25);
		const result = advanceTeachingProgress(path, 25, 20, false);
		expect(result).toEqual({ taughtPlies: 25, masteredPlies: 25, solved: true, pausedAtCeiling: false });
	});

	it('a short (one-batch) variation still needs a clean teach pass before it can be solved', () => {
		const path = makePath(4);
		const result = advanceTeachingProgress(path, 0, 0, false);
		expect(result).toEqual({ taughtPlies: 4, masteredPlies: 0, solved: false, pausedAtCeiling: false });
	});

	it('a short (one-batch) variation solves on the blind retest right after its teach pass', () => {
		const path = makePath(4);
		const result = advanceTeachingProgress(path, 4, 0, false);
		expect(result).toEqual({ taughtPlies: 4, masteredPlies: 4, solved: true, pausedAtCeiling: false });
	});

	it('a clean LAST teach pass advances what is taught but masters and solves nothing', () => {
		const path = makePath(8);
		const result = advanceTeachingProgress(path, 5, 5, false);
		expect(result).toEqual({ taughtPlies: 8, masteredPlies: 5, solved: false, pausedAtCeiling: false });
		// ...and the blind retest it now owes is what solves the variation.
		expect(advanceTeachingProgress(path, 8, 5, false)).toEqual({
			taughtPlies: 8,
			masteredPlies: 8,
			solved: true,
			pausedAtCeiling: false
		});
	});

	it('a mistake on the last teach pass still changes nothing — the same teach pass is re-served', () => {
		const path = makePath(8);
		const result = advanceTeachingProgress(path, 5, 5, true);
		expect(result).toEqual({ taughtPlies: 5, masteredPlies: 5, solved: false, pausedAtCeiling: false });
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
		expect(next).not.toEqual({ taughtPlies, masteredPlies, solved: false, pausedAtCeiling: false }); // no stuck state
		taughtPlies = next.taughtPlies;
		masteredPlies = next.masteredPlies;
		if (next.solved) return { attempts: passes.length, passes };
	}
	throw new Error('never reached solved');
}

describe('clean attempts needed to solve a variation', () => {
	// Every run below ends on a BLIND pass. That's the property being tested,
	// not the count: issue #68 shaved one attempt off multi-batch lines by
	// letting the last arrowed pass solve the variation, which meant its final
	// moves were never once played from memory. The extra attempt is the price
	// of "no line is learned until it's been played unaided".
	it('a 5-move variation takes 4 clean attempts, ending on a blind pass', () => {
		// 10 plies / 5 player moves, split 3 + 2 by TEACHING_BATCH_MOVES:
		// teach(1-3) → blind(1-3) → teach(4-5) → blind(1-5).
		expect(cleanRunToSolved(makePath(10))).toEqual({
			attempts: 4,
			passes: ['teach', 'blind', 'teach', 'blind']
		});
	});

	it('the same holds for a 5-move variation where the opponent moves first', () => {
		// Opponent-first parity shifts every batch boundary by a ply; the count
		// of clean attempts must not depend on it.
		expect(cleanRunToSolved(makeOpponentFirstPath(10))).toEqual({
			attempts: 4,
			passes: ['teach', 'blind', 'teach', 'blind']
		});
	});

	it('a longer variation alternates teach and blind all the way to the end', () => {
		// 25 plies / 13 player moves = five 3-move batches (3+3+3+3+1), every
		// one of them followed by its own blind retest: 2*5 = 10 clean attempts.
		expect(cleanRunToSolved(makePath(25))).toEqual({
			attempts: 10,
			passes: ['teach', 'blind', 'teach', 'blind', 'teach', 'blind', 'teach', 'blind', 'teach', 'blind']
		});
	});

	it('a variation of one batch or less still takes 2 clean attempts: taught once, then played blind once', () => {
		// Unchanged by issue #68 on purpose — with nothing mastered behind it,
		// skipping this variation's only blind retest would mark it solved
		// without it ever having been played from memory.
		expect(cleanRunToSolved(makePath(4))).toEqual({ attempts: 2, passes: ['teach', 'blind'] });
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

describe('knownProgressFor', () => {
	// Two variations built from makePath share leading moveIds by construction
	// (`p0`, `p1`, ...) — the same thing that makes real sibling variations share
	// an opening, which is what produces a shared floor at all.
	const long = makeVariation('a', makePath(24));

	function siblingMastering(plies: number) {
		return makeVariation('b', makePath(plies));
	}

	it('takes the higher of the variation\'s own counters or the shared sibling floor', () => {
		const b = siblingMastering(8);
		expect(
			knownProgressFor({
				variation: long,
				variations: [long, b],
				teachingProgress: new Map([
					['a', { taughtPlies: 5, masteredPlies: 3 }],
					['b', { taughtPlies: 8, masteredPlies: 8 }]
				]),
				solvedKeys: new Set(),
				resumedAfterBreak: false
			})
		).toEqual({ taughtPlies: 8, masteredPlies: 8 });
	});

	it('keeps its own higher counters when the shared floor is lower', () => {
		const b = siblingMastering(8);
		expect(
			knownProgressFor({
				variation: long,
				variations: [long, b],
				teachingProgress: new Map([
					['a', { taughtPlies: 10, masteredPlies: 6 }],
					['b', { taughtPlies: 2, masteredPlies: 2 }]
				]),
				solvedKeys: new Set(),
				resumedAfterBreak: false
			})
		).toEqual({ taughtPlies: 10, masteredPlies: 6 });
	});

	it('credits the shared floor to a variation with no progress row of its own', () => {
		const b = siblingMastering(8);
		expect(
			knownProgressFor({
				variation: long,
				variations: [long, b],
				teachingProgress: new Map([['b', { taughtPlies: 8, masteredPlies: 8 }]]),
				solvedKeys: new Set(),
				resumedAfterBreak: false
			})
		).toEqual({ taughtPlies: 8, masteredPlies: 8 });
	});

	it('zeroes both counters entirely when resumedAfterBreak is true, discarding the shared floor too', () => {
		const b = siblingMastering(15);
		expect(
			knownProgressFor({
				variation: long,
				variations: [long, b],
				teachingProgress: new Map([
					['a', { taughtPlies: 20, masteredPlies: 10 }],
					['b', { taughtPlies: 15, masteredPlies: 15 }]
				]),
				solvedKeys: new Set(),
				resumedAfterBreak: true
			})
		).toEqual({ taughtPlies: 0, masteredPlies: 0 });
	});
});

describe('ceilingPlyFor', () => {
	it('is the ply just past the Nth player move', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']); // 3 player moves (e4, Nf3, Bb5)
		expect(ceilingPlyFor(p, 2)).toBe(3); // past e4, e5, Nf3 -> index 3
	});

	it('is the whole path when the ceiling exceeds the path length', () => {
		const p = path(['e4', 'e5']);
		expect(ceilingPlyFor(p, 99)).toBe(p.length);
	});

});

describe('resolveTeachingStep with a ceiling', () => {
	it('behaves identically to no ceiling when the variation is shorter than it', () => {
		const p = path(['e4', 'e5', 'Nf3']); // 2 player moves, well under a 9-move ceiling
		const withCeiling = resolveTeachingStep(p, 0, 0, ceilingPlyFor(p, 9));
		const withoutCeiling = resolveTeachingStep(p, 0, 0);
		expect(withCeiling).toEqual({ ...withoutCeiling, pausedAtCeiling: false });
	});

	it('pauses exactly at the ceiling for a variation longer than it, without reaching its own true end', () => {
		// 9 player moves' worth of plies, ceiling of 2 player moves (TEACHING_BATCH_MOVES-aligned).
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
		const ceilingPly = ceilingPlyFor(p, 2);
		// masteredPlies already at the ceiling: nothing more to teach for now.
		const step = resolveTeachingStep(p, ceilingPly, ceilingPly, ceilingPly);
		expect(step.isFinalPass).toBe(true);
		expect(step.pausedAtCeiling).toBe(true);
		expect(step.path.length).toBe(ceilingPly);
	});

	it("is NOT paused when the ceiling ply exactly equals the variation's own true length", () => {
		// Path must itself END on the player's own move for ceilingPlyFor(p, 2) to
		// land on p.length — plyAfterPlayerMoves never lands past a player's own
		// move, so a path with a trailing opponent reply (e.g. one more SAN move
		// appended) would make the ceiling fall one ply SHORT of p.length instead.
		const p = path(['e4', 'e5', 'Nf3']); // 2 player moves (e4, Nf3), ending on Nf3
		const ceilingPly = ceilingPlyFor(p, 2); // equals p.length here
		const step = resolveTeachingStep(p, p.length, p.length, ceilingPly);
		expect(step.isFinalPass).toBe(true);
		expect(step.pausedAtCeiling).toBe(false);
	});

	it('a ceiling regression below already-mastered content does not crash, and clamps served content to the new ceiling', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		const loweredCeilingPly = ceilingPlyFor(p, 2); // pretend a reconciliation regression just lowered the ceiling
		// masteredPlies (4 player moves in) is already PAST the new, lower ceiling.
		const alreadyPast = ceilingPlyFor(p, 4);
		const step = resolveTeachingStep(p, alreadyPast, alreadyPast, loweredCeilingPly);
		expect(step.path.length).toBe(loweredCeilingPly);
		expect(step.pausedAtCeiling).toBe(true);
	});

	it('mid-batch teach/blind-retest passes below the ceiling report pausedAtCeiling: false', () => {
		// Ceiling well past this batch — a non-final pass must never claim to be paused.
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		const ceilingPly = ceilingPlyFor(p, 9); // exceeds path length -> effectively no ceiling
		const teachStep = resolveTeachingStep(p, 0, 0, ceilingPly);
		expect(teachStep.isFinalPass).toBe(false);
		expect(teachStep.pausedAtCeiling).toBe(false);
	});

	it('a fresh (never-taught) variation entirely at or under the ceiling is unaffected by it, all the way to a genuine final pass', () => {
		const p = path(['e4', 'e5', 'Nf3']); // 2 player moves, ending on Nf3 (see note above)
		const ceilingPly = ceilingPlyFor(p, 2); // exactly the variation's own length
		const step = resolveTeachingStep(p, p.length, p.length, ceilingPly);
		expect(step.path.length).toBe(p.length);
		expect(step.isFinalPass).toBe(true);
		expect(step.pausedAtCeiling).toBe(false);
	});
});

describe('advanceTeachingProgress with a ceiling', () => {
	it('reports solved (not paused) for a clean final pass within a variation shorter than the ceiling', () => {
		const p = path(['e4', 'e5']); // 1 player move
		const ceilingPly = ceilingPlyFor(p, 9);
		const next = advanceTeachingProgress(p, p.length, p.length, false, ceilingPly);
		expect(next.solved).toBe(true);
		expect(next.pausedAtCeiling).toBe(false);
	});

	it('reports pausedAtCeiling (never solved) for a clean pass that only reaches the ceiling', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		const ceilingPly = ceilingPlyFor(p, 2);
		const next = advanceTeachingProgress(p, ceilingPly, ceilingPly, false, ceilingPly);
		expect(next.solved).toBe(false);
		expect(next.pausedAtCeiling).toBe(true);
	});

	it('a mistake is a no-op regardless of the ceiling, exactly as without one', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6']);
		const next = advanceTeachingProgress(p, 0, 0, true, ceilingPlyFor(p, 2));
		expect(next).toEqual({ taughtPlies: 0, masteredPlies: 0, solved: false, pausedAtCeiling: false });
	});

	it('a clean teach (arrowed) pass under the ceiling never reports pausedAtCeiling, even mid-way through a longer-than-ceiling variation', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		const ceilingPly = ceilingPlyFor(p, 2);
		const next = advanceTeachingProgress(p, 0, 0, false, ceilingPly);
		expect(next.solved).toBe(false);
		expect(next.pausedAtCeiling).toBe(false);
	});
});

describe('isPausedAtCeiling', () => {
	it('is false for an untouched variation, however long, so it is still fully servable up to the ceiling', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']); // 5 player moves
		expect(isPausedAtCeiling(p, 0, 2)).toBe(false);
	});

	it('is true once mastered progress reaches the ceiling on a variation longer than it', () => {
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
		const ceilingPly = ceilingPlyFor(p, 2);
		expect(isPausedAtCeiling(p, ceilingPly, 2)).toBe(true);
	});

	it('is false once a variation is genuinely fully mastered, even at exactly the ceiling length', () => {
		// Ends on the player's own move (see note in the resolveTeachingStep
		// ceiling tests) so its own true length lands exactly on the ceiling ply.
		const p = path(['e4', 'e5', 'Nf3']); // 2 player moves, exactly the ceiling
		expect(isPausedAtCeiling(p, p.length, 2)).toBe(false);
	});

	it('is false partway through a variation whose masteredPlies is between 0 and the ceiling but the ceiling is below its own length', () => {
		// masteredPlies short of the ceiling itself: not yet paused, still servable.
		const p = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
		const ceilingPly = ceilingPlyFor(p, 2);
		expect(isPausedAtCeiling(p, ceilingPly - 1, 2)).toBe(false);
	});
});

describe('computeBlockedKeys (GitHub issue #168/#171 — shared-credit-aware)', () => {
	it('blocks a never-visited sibling whose entire path is already covered by another variation reaching the ceiling', () => {
		// Both share the exact same first 2 player moves (same moveIds via
		// the shared `path` prefix) and diverge nowhere within the ceiling —
		// `sibling` is a plain prefix of `taught`, so it has nothing left to
		// teach once `taught` reaches the ceiling.
		const taughtPath = path(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']); // 3 player moves
		const sibling = makeVariation('sibling', taughtPath.slice(0, 4)); // 'e4 e5 Nf3 Nc6' — 2 player moves
		const taught = makeVariation('taught', taughtPath);
		const ceilingPly = ceilingPlyFor(taughtPath, 2);

		const blocked = computeBlockedKeys(
			[taught, sibling],
			new Set(),
			new Map([['taught', { taughtPlies: ceilingPly, masteredPlies: ceilingPly }]]),
			2
		);

		expect(blocked.has('sibling')).toBe(true);
		expect(blocked.has('taught')).toBe(true);
	});

	it('does not block a sibling whose own final move would SOLVE it outright, even once another variation reached the ceiling (GitHub issue #172)', () => {
		// Both share moves 0-1 ('s0'/'s1'), then diverge at ply 2 ('t2' vs
		// 'u2') — sibling's own path ENDS at 'u2' (its own true end lands
		// exactly at the ceiling boundary), so teaching it finishes it — a
		// genuine, permanent solve, not more of the same shared content —
		// and is never deferred regardless of what else reached the ceiling.
		const step = (moveId: string, isPlayerTurn: boolean): VariationStep => ({ moveId, san: moveId, fromFen: 'x', toFen: 'y', isPlayerTurn });
		const shared = [step('s0', true), step('s1', false)];
		const taught = makeVariation('taught', [...shared, step('t2', true), step('t3', false), step('t4', true), step('t5', false)]);
		const sibling = makeVariation('sibling', [...shared, step('u2', true)]);
		const ceilingPly = ceilingPlyFor(taught.path, 2); // after the 2nd player move: s0, s1, t2

		const blocked = computeBlockedKeys(
			[taught, sibling],
			new Set(),
			new Map([['taught', { taughtPlies: ceilingPly, masteredPlies: ceilingPly }]]),
			2
		);

		expect(blocked.has('taught')).toBe(true);
		expect(blocked.has('sibling')).toBe(false);
	});

	it('defers a sibling that would only PAUSE (not solve) once another variation already reached the ceiling (GitHub issue #172)', () => {
		// Same shared prefix and divergence as above, but sibling has ONE
		// more ply ('u3') past its own divergent move — its own true end
		// lies beyond the ceiling, so it would merely pause there too, same
		// as `taught` — exactly the "4 continuations" case the user
		// reported: teaching `taught` to the ceiling shouldn't leave every
		// OTHER continuation free to independently spend its own final move.
		const step = (moveId: string, isPlayerTurn: boolean): VariationStep => ({ moveId, san: moveId, fromFen: 'x', toFen: 'y', isPlayerTurn });
		const shared = [step('s0', true), step('s1', false)];
		const taught = makeVariation('taught', [...shared, step('t2', true), step('t3', false), step('t4', true), step('t5', false)]);
		const sibling = makeVariation('sibling', [...shared, step('u2', true), step('u3', false)]);
		const ceilingPly = ceilingPlyFor(taught.path, 2);

		const blocked = computeBlockedKeys(
			[taught, sibling],
			new Set(),
			new Map([['taught', { taughtPlies: ceilingPly, masteredPlies: ceilingPly }]]),
			2
		);

		expect(blocked.has('taught')).toBe(true);
		expect(blocked.has('sibling')).toBe(true);
	});

	it('does not defer an untouched, unrelated variation just because something else reached the ceiling (GitHub issue #172)', () => {
		// `unrelated` shares NOTHING with `taught` — Learn must still "simply
		// serve something else" per the original design's own guarantee.
		const step = (moveId: string, isPlayerTurn: boolean): VariationStep => ({ moveId, san: moveId, fromFen: 'x', toFen: 'y', isPlayerTurn });
		const taught = makeVariation('taught', [
			step('t0', true),
			step('t1', false),
			step('t2', true),
			step('t3', false),
			step('t4', true),
			step('t5', false)
		]);
		const unrelated = makeVariation('unrelated', [step('z0', true), step('z1', false), step('z2', true), step('z3', false)]);
		const ceilingPly = ceilingPlyFor(taught.path, 2);

		const blocked = computeBlockedKeys(
			[taught, unrelated],
			new Set(),
			new Map([['taught', { taughtPlies: ceilingPly, masteredPlies: ceilingPly }]]),
			2
		);

		expect(blocked.has('taught')).toBe(true);
		expect(blocked.has('unrelated')).toBe(false);
	});
});

describe('isCeilingReachedAnywhere (GitHub issue #172)', () => {
	const step = (moveId: string, isPlayerTurn: boolean): VariationStep => ({ moveId, san: moveId, fromFen: 'x', toFen: 'y', isPlayerTurn });

	it('is false when nothing has been taught yet', () => {
		const long = makeVariation('long', [step('a', true), step('b', false), step('c', true), step('d', false)]);
		expect(isCeilingReachedAnywhere([long], new Set(), new Map(), 2)).toBe(false);
	});

	it('is true once a long variation has genuinely been taught to the ceiling and paused', () => {
		const long = makeVariation('long', [step('a', true), step('b', false), step('c', true), step('d', false)]);
		const ceilingPly = ceilingPlyFor(long.path, 2);
		const progress = new Map([['long', { taughtPlies: ceilingPly, masteredPlies: ceilingPly }]]);
		expect(isCeilingReachedAnywhere([long], new Set(), progress, 2)).toBe(true);
	});

	it('is false for a variation that would SOLVE (not pause) at its own true end, even if that end is fully taught', () => {
		// Only 1 player-turn ply exists; a ceiling of 5 player moves can
		// never be reached along this path, so `ceilingPlyFor` falls back to
		// `path.length` itself — this variation's own true end IS the
		// "ceiling," so finishing it is a solve, never a pause.
		const short = makeVariation('short', [step('a', true), step('b', false)]);
		const progress = new Map([['short', { taughtPlies: 2, masteredPlies: 2 }]]); // fully taught, would solve
		expect(isCeilingReachedAnywhere([short], new Set(), progress, 5)).toBe(false);
	});

	it('is false for a variation that is merely untouched, however long', () => {
		const long = makeVariation('long', [step('a', true), step('b', false), step('c', true), step('d', false)]);
		expect(isCeilingReachedAnywhere([long], new Set(), new Map([['long', { taughtPlies: 0, masteredPlies: 0 }]]), 2)).toBe(false);
	});
});

describe('isLockedForTier (GitHub issue #172)', () => {
	it('is true for the original per-variation case (genuinely paused) even when ceilingReached is false', () => {
		const path: VariationStep[] = [
			{ moveId: 'a', san: 'a', fromFen: 'x', toFen: 'y', isPlayerTurn: true },
			{ moveId: 'b', san: 'b', fromFen: 'x', toFen: 'y', isPlayerTurn: false },
			{ moveId: 'c', san: 'c', fromFen: 'x', toFen: 'y', isPlayerTurn: true },
			{ moveId: 'd', san: 'd', fromFen: 'x', toFen: 'y', isPlayerTurn: false }
		];
		const ceilingPly = ceilingPlyFor(path, 1);
		expect(isLockedForTier(path, ceilingPly, 1, false)).toBe(true);
	});

	it('locks a deferred sibling: ceilingReached, would merely pause, and already carries some credit', () => {
		const path: VariationStep[] = [
			{ moveId: 'a', san: 'a', fromFen: 'x', toFen: 'y', isPlayerTurn: true },
			{ moveId: 'b', san: 'b', fromFen: 'x', toFen: 'y', isPlayerTurn: false },
			{ moveId: 'c', san: 'c', fromFen: 'x', toFen: 'y', isPlayerTurn: true },
			{ moveId: 'd', san: 'd', fromFen: 'x', toFen: 'y', isPlayerTurn: false }
		];
		const ceilingPly = ceilingPlyFor(path, 2); // after the 2nd player move -> ply 3
		expect(isLockedForTier(path, ceilingPly - 2, 2, true)).toBe(true); // partial credit (1), short of the ceiling (3), path longer than it (4)
	});

	it('does not lock a sibling that would SOLVE outright at its own true end, even when ceilingReached is true', () => {
		const path: VariationStep[] = [
			{ moveId: 'a', san: 'a', fromFen: 'x', toFen: 'y', isPlayerTurn: true },
			{ moveId: 'b', san: 'b', fromFen: 'x', toFen: 'y', isPlayerTurn: false }
		];
		// Only 1 player-turn ply exists, so a ceiling of 5 player moves can
		// never be reached — ceilingPlyFor falls back to path.length itself,
		// i.e. this variation's own true end IS the "ceiling": would solve.
		expect(isLockedForTier(path, 2, 5, true)).toBe(false);
	});

	it('does not lock an untouched (masteredPlies === 0) sibling even when ceilingReached is true', () => {
		const path: VariationStep[] = [
			{ moveId: 'a', san: 'a', fromFen: 'x', toFen: 'y', isPlayerTurn: true },
			{ moveId: 'b', san: 'b', fromFen: 'x', toFen: 'y', isPlayerTurn: false },
			{ moveId: 'c', san: 'c', fromFen: 'x', toFen: 'y', isPlayerTurn: true },
			{ moveId: 'd', san: 'd', fromFen: 'x', toFen: 'y', isPlayerTurn: false }
		];
		expect(isLockedForTier(path, 0, 1, true)).toBe(false);
	});

	it('does not lock a sibling with only minimal shared credit (e.g. just an opening move) relative to a long remaining path, even when ceilingReached is true', () => {
		// Regression for a real risk: in a same-starting-move repertoire, the
		// very first edge is typically ONE shared row reused by nearly every
		// variation, so `masteredPlies > 0` alone would defer almost the
		// whole repertoire the instant anything paused. This variation has
		// only its first ply credited (a stand-in for "shares just the
		// opening move") and plenty of its OWN, genuinely fresh content
		// beyond it — long enough (40 plies) that it would merely pause at a
		// real Bronze ceiling (9 player moves -> ply 17), but its very next
		// teaching batch (3 player moves from ply 1, landing at ply 7) falls
		// well short of that ceiling, so it must NOT defer yet.
		const path: VariationStep[] = Array.from({ length: 40 }, (_, i) => ({
			moveId: `m${i}`,
			san: `m${i}`,
			fromFen: 'x',
			toFen: 'y',
			isPlayerTurn: i % 2 === 0
		}));
		expect(isLockedForTier(path, 1, 9, true)).toBe(false);
	});

	it('locks a sibling whose next batch WOULD reach the ceiling, even with only a little more credit needed', () => {
		// Same shape as above, but masteredPlies is now one short of the
		// ceiling itself (ply 16 of 17) — the very next batch necessarily
		// reaches/crosses it, so this genuinely is "just the last sliver."
		const path: VariationStep[] = Array.from({ length: 40 }, (_, i) => ({
			moveId: `m${i}`,
			san: `m${i}`,
			fromFen: 'x',
			toFen: 'y',
			isPlayerTurn: i % 2 === 0
		}));
		expect(isLockedForTier(path, 16, 9, true)).toBe(true);
	});
});
