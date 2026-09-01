// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { buildPracticeView, optimisticSolvedAfterAttempt } from './practice';
import { ceilingPlyFor } from './teaching';
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
		playerMoveCount,
		chapterNames: []
	};
}

const noTeaching = new Map<string, { taughtPlies: number; masteredPlies: number; updatedAt: string | null }>();

/**
 * Two variations sharing the SAME leading `sharedPlayerMoves` player-move
 * pairs (identical moveIds, like transposing/shared repertoire lines),
 * each then branching off with its own additional player moves.
 */
function makeSharedPrefixVariations(sharedPlayerMoves: number, ownPlayerMovesA: number, ownPlayerMovesB: number) {
	const shared: VariationStep[] = [];
	for (let i = 1; i <= sharedPlayerMoves; i++) {
		shared.push({ moveId: `shared-p${i}`, san: `P${i}`, fromFen: `f${i}a`, toFen: `f${i}b`, isPlayerTurn: true });
		shared.push({ moveId: `shared-o${i}`, san: `O${i}`, fromFen: `f${i}b`, toFen: `f${i + 1}a`, isPlayerTurn: false });
	}
	function extend(prefix: string, ownPlayerMoves: number): VariationStep[] {
		const path = [...shared];
		for (let i = sharedPlayerMoves + 1; i <= sharedPlayerMoves + ownPlayerMoves; i++) {
			path.push({ moveId: `${prefix}p${i}`, san: `P${i}`, fromFen: `f${i}a`, toFen: `f${i}b`, isPlayerTurn: true });
			path.push({ moveId: `${prefix}o${i}`, san: `O${i}`, fromFen: `f${i}b`, toFen: `f${i + 1}a`, isPlayerTurn: false });
		}
		return path;
	}
	function toVariation(variationKey: string, path: VariationStep[], playerMoveCount: number): Variation {
		return { leafMoveId: path[path.length - 1].moveId, variationKey, path, playerMoveCount, chapterNames: [] };
	}
	const pathA = extend('a-', ownPlayerMovesA);
	const pathB = extend('b-', ownPlayerMovesB);
	return {
		a: toVariation('a', pathA, sharedPlayerMoves + ownPlayerMovesA),
		b: toVariation('b', pathB, sharedPlayerMoves + ownPlayerMovesB)
	};
}

describe('buildPracticeView', () => {
	// The hang reported on "Atidėtas alapinas baltais": variation A's moves are
	// all covered by an already-solved sibling B (A is a strict prefix of it), so
	// the shared-prefix credit made masteredPlies reach A's own path length. The
	// whole attempt then auto-played — including A's last player move — and the
	// board sat there in 'playing' with nothing left to ask for, rejecting every
	// move the player tried, forever. The player must always be left at least
	// their own final move to make.
	it('never auto-plays past the last player move of the served path', () => {
		const { a, b } = makeSharedPrefixVariations(2, 0, 1);
		const view = buildPracticeView([a, b], a.variationKey, new Set([b.variationKey]), noTeaching);
		expect(view.attempt).not.toBeNull();
		const path = view.attempt!.path;
		const lastPlayerPly = path.reduce((last, step, i) => (step.isPlayerTurn ? i : last), -1);
		expect(view.attempt!.autoPlayThrough).toBeLessThanOrEqual(lastPlayerPly);
		expect(path.slice(view.attempt!.autoPlayThrough).some((s) => s.isPlayerTurn)).toBe(true);
	});

	it('serves the active variation\'s FULL path as the attempt, unsplit', () => {
		const v = makeVariation(2, 'a-'); // 2 player moves — strictly under one batch
		const view = buildPracticeView([v], null, new Set(), noTeaching);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(v.variationKey);
		expect(view.attempt!.path).toEqual(v.path); // whole path, no auto-play split
	});

	it('defaults to the first unsolved variation when no active key is set', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], null, new Set([a.variationKey]), noTeaching);
		expect(view.attempt!.variationKey).toBe(b.variationKey);
	});

	// Contract change from epic #95: a stored active key pointing at a LEARNED
	// variation no longer re-serves it in Learn. Learned lines belong to Practice,
	// and honouring a stale key here would also strand Learn on a line that has
	// already graduated. The picker is unaffected — it passes forceAttempt (see
	// api/practice/select-variation), which is the case below.
	it('moves past a stale active key that points at an already-learned variation', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]), noTeaching);
		expect(view.attempt!.variationKey).toBe(b.variationKey);
	});

	it('serves a learned variation when the picker forces it', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]), noTeaching, Infinity, true);
		expect(view.attempt!.variationKey).toBe(a.variationKey);
	});

	it('reports solved/total across the whole repertoire', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const c = makeVariation(2, 'c-');
		const view = buildPracticeView([a, b, c], null, new Set([a.variationKey]), noTeaching);
		expect(view.solved).toBe(1);
		expect(view.total).toBe(3);
	});

	it('returns a null attempt and allSolved=true once every variation is solved', () => {
		const a = makeVariation(2, 'a-');
		const view = buildPracticeView([a], null, new Set([a.variationKey]), noTeaching);
		expect(view.attempt).toBeNull();
		expect(view.allSolved).toBe(true);
		expect(view.solved).toBe(1);
		expect(view.total).toBe(1);
	});

	it('returns the vacuous empty-repertoire shape for no variations at all', () => {
		const view = buildPracticeView([], null, new Set(), noTeaching);
		expect(view.attempt).toBeNull();
		expect(view.allSolved).toBe(true);
		expect(view.solved).toBe(0);
		expect(view.total).toBe(0);
	});

	it('allSolved is false while any variation still has unlearned siblings, re-pick or not', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const forced = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]), noTeaching, Infinity, true);
		expect(forced.attempt!.variationKey).toBe(a.variationKey);
		expect(forced.allSolved).toBe(false);
	});

	it('forceAttempt serves a manually re-picked variation even when the whole repertoire is already solved', () => {
		const a = makeVariation(2, 'a-');
		const view = buildPracticeView([a], a.variationKey, new Set([a.variationKey]), noTeaching, Infinity, true);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(a.variationKey);
		expect(view.allSolved).toBe(true);
	});

	it('serves a truncated path and arrow range for an unsolved variation still being taught, ending on the player\'s own move', () => {
		const v = makeVariation(15, 'a-'); // 30 plies, player moves first
		const view = buildPracticeView([v], null, new Set(), noTeaching);
		// The batch ends right after the player's 3rd move (ply 4), not a flat
		// 6-ply offset — see teaching.ts's plyAfterPlayerMoves.
		expect(view.attempt!.path).toHaveLength(5);
		expect(view.attempt!.arrowPlies).toEqual({ from: 0, to: 5 });
		expect(view.attempt!.isFinalPass).toBe(false);
		expect(view.attempt!.path[view.attempt!.path.length - 1].isPlayerTurn).toBe(true);
	});

	it('does not flag the LAST teach pass as final — its blind retest is what solves', () => {
		const v = makeVariation(4, 'a-'); // 8 plies: batch 1 is plies 0-4, batch 2 is the rest
		const progress = new Map([[v.variationKey, { taughtPlies: 5, masteredPlies: 5, updatedAt: null }]]);
		const view = buildPracticeView([v], null, new Set(), progress);
		expect(view.attempt!.path).toEqual(v.path);
		expect(view.attempt!.arrowPlies).toEqual({ from: 5, to: 8 });
		// Arrows up means the moves are being shown, not recalled — so this pass
		// cannot be the one that learns the line, no matter that it reaches the
		// path's end.
		expect(view.attempt!.isFinalPass).toBe(false);
		expect(view.attempt!.autoPlayThrough).toBe(5);

		// The pass that follows it: same path, no arrows, and THAT one is final.
		const taught = new Map([[v.variationKey, { taughtPlies: 8, masteredPlies: 5, updatedAt: null }]]);
		const retest = buildPracticeView([v], null, new Set(), taught);
		expect(retest.attempt!.arrowPlies).toBeNull();
		expect(retest.attempt!.isFinalPass).toBe(true);
	});

	it('does not flag a fresh single-batch variation\'s first teach pass as final (it still owes one blind retest)', () => {
		const v = makeVariation(2, 'a-'); // 4 plies — one batch covers all of it
		const view = buildPracticeView([v], null, new Set(), noTeaching);
		expect(view.attempt!.arrowPlies).toEqual({ from: 0, to: 4 });
		expect(view.attempt!.isFinalPass).toBe(false);
	});

	it('ignores stale teaching-progress data for an already-solved variation and serves it at full depth with no arrow', () => {
		const v = makeVariation(15, 'a-'); // 30 plies
		const progress = new Map([[v.variationKey, { taughtPlies: 20, masteredPlies: 10, updatedAt: null }]]);
		const view = buildPracticeView([v], v.variationKey, new Set([v.variationKey]), progress, Infinity, true);
		expect(view.attempt!.path).toHaveLength(30);
		expect(view.attempt!.arrowPlies).toBeNull();
		expect(view.attempt!.isFinalPass).toBe(true);
	});

	it('credits a fresh sibling variation for a shared prefix already solved via another variation, teaching only its own new content', () => {
		const { a, b } = makeSharedPrefixVariations(5, 5, 1); // 5 shared moves, a has 5 more of its own, b has 1
		const view = buildPracticeView([a, b], null, new Set([a.variationKey]), new Map());
		expect(view.attempt!.variationKey).toBe(b.variationKey);
		// b's own content is only 1 player move past the shared 10-ply prefix —
		// shorter than one full batch, so the whole thing is taught at once.
		expect(view.attempt!.path).toEqual(b.path);
		expect(view.attempt!.arrowPlies).toEqual({ from: 10, to: 12 });
		expect(view.attempt!.autoPlayThrough).toBe(10);
	});

	it('keeps crediting the shared prefix during a sibling\'s own blind retest, so only its own new content needs manual replay', () => {
		const { a, b } = makeSharedPrefixVariations(5, 5, 1);
		const progress = new Map([[b.variationKey, { taughtPlies: 12, masteredPlies: 0, updatedAt: null }]]);
		const view = buildPracticeView([a, b], b.variationKey, new Set([a.variationKey]), progress);
		expect(view.attempt!.path).toEqual(b.path);
		expect(view.attempt!.arrowPlies).toBeNull();
		expect(view.attempt!.isFinalPass).toBe(true);
		expect(view.attempt!.autoPlayThrough).toBe(10);
	});

	it('does not auto-play anything for an already-solved variation\'s own re-drill', () => {
		const v = makeVariation(3, 'a-');
		const view = buildPracticeView([v], v.variationKey, new Set([v.variationKey]), noTeaching, Infinity, true);
		expect(view.attempt!.autoPlayThrough).toBe(0);
	});

	it('keeps normal auto-play when the variation was attempted recently', () => {
		const v = makeVariation(15, 'a-'); // 30 plies
		const now = new Date('2026-08-17T12:00:00Z');
		const progress = new Map([
			[v.variationKey, { taughtPlies: 20, masteredPlies: 10, updatedAt: '2026-08-17T11:55:00Z' }] // 5 min ago
		]);
		const view = buildPracticeView([v], v.variationKey, new Set(), progress, Infinity, false, now);
		expect(view.attempt!.autoPlayThrough).toBe(10);
	});

	it('resets to no auto-play and restarts teaching from the beginning after a 10+ minute gap', () => {
		const v = makeVariation(15, 'a-'); // 30 plies
		const now = new Date('2026-08-17T12:00:00Z');
		const progress = new Map([
			[v.variationKey, { taughtPlies: 20, masteredPlies: 10, updatedAt: '2026-08-17T11:49:00Z' }] // 11 min ago
		]);
		const view = buildPracticeView([v], v.variationKey, new Set(), progress, Infinity, false, now);
		expect(view.attempt!.autoPlayThrough).toBe(0);
		// Teaching restarts from ply 0 too, not just auto-play — same truncated
		// batch/arrow a genuinely fresh variation gets (see the existing
		// 'serves a truncated path and arrow range...' test above for the same
		// 15-player-move fixture with zero progress).
		expect(view.attempt!.path).toHaveLength(5);
		expect(view.attempt!.arrowPlies).toEqual({ from: 0, to: 5 });
	});

	it('discards a freshly-earned sibling\'s shared-prefix credit when THIS variation is resumed after a break', () => {
		// The two freshness signals disagree: the shared opening was mastered
		// via sibling b moments ago, but variation a itself hasn't been touched
		// in 11 minutes. a's own break wins and the shared credit is dropped —
		// the break check is per-variation, not per-moveId (see the comment on
		// knownProgressFor). Locking this down because the alternative reading
		// (keep credit the sibling just re-earned) is defensible enough that a
		// future refactor could silently flip to it.
		const { a, b } = makeSharedPrefixVariations(5, 5, 1); // 10 shared plies
		const now = new Date('2026-08-17T12:00:00Z');
		const progress = new Map([
			[a.variationKey, { taughtPlies: 0, masteredPlies: 0, updatedAt: '2026-08-17T11:49:00Z' }], // 11 min ago
			[b.variationKey, { taughtPlies: 10, masteredPlies: 10, updatedAt: '2026-08-17T11:59:00Z' }] // 1 min ago
		]);
		const view = buildPracticeView([a, b], a.variationKey, new Set(), progress, Infinity, false, now);
		expect(view.attempt!.variationKey).toBe(a.variationKey);
		expect(view.attempt!.autoPlayThrough).toBe(0); // not 10, despite b's fresh mastery of the shared prefix
		// And teaching restarts from ply 0 rather than resuming past the shared
		// prefix — a's first batch, exactly as if nothing were known.
		expect(view.attempt!.path).toHaveLength(5);
		expect(view.attempt!.arrowPlies).toEqual({ from: 0, to: 5 });
	});

	it('does not treat a never-attempted variation (no updatedAt yet) as a resume-after-break', () => {
		const v = makeVariation(15, 'a-');
		const now = new Date('2026-08-17T12:00:00Z');
		const progress = new Map([[v.variationKey, { taughtPlies: 0, masteredPlies: 0, updatedAt: null }]]);
		const view = buildPracticeView([v], v.variationKey, new Set(), progress, Infinity, false, now);
		expect(view.attempt!.autoPlayThrough).toBe(0);
		expect(view.attempt!.path).toHaveLength(5);
	});
});

describe('buildPracticeView with a ceilingMoveCount', () => {
	it("is unaffected when ceilingMoveCount is Infinity (the default), matching every existing test in this file", () => {
		// Spot-check two of the scenarios above: a plain untaught long
		// variation, and one mid-batch via teachingProgress. Both must produce
		// identical output whether ceilingMoveCount is omitted or passed
		// explicitly as Infinity.
		const v = makeVariation(15, 'a-'); // 30 plies
		const withDefault = buildPracticeView([v], null, new Set(), noTeaching);
		const withExplicitInfinity = buildPracticeView([v], null, new Set(), noTeaching, Infinity);
		expect(withExplicitInfinity).toEqual(withDefault);

		const progress = new Map([[v.variationKey, { taughtPlies: 20, masteredPlies: 10, updatedAt: null }]]);
		const withDefault2 = buildPracticeView([v], null, new Set(), progress);
		const withExplicitInfinity2 = buildPracticeView([v], null, new Set(), progress, Infinity);
		expect(withExplicitInfinity2).toEqual(withDefault2);
	});

	it("truncates a long unsolved variation's served attempt to the ceiling", () => {
		const v = makeVariation(5, 'a-'); // 5 player moves, 10 plies
		const ceilingMoveCount = 2;
		const ceilingPly = ceilingPlyFor(v.path, ceilingMoveCount);
		// Already mastered right up to the ceiling — the next resolveTeachingStep
		// call pauses there rather than teaching further.
		const progress = new Map([[v.variationKey, { taughtPlies: ceilingPly, masteredPlies: ceilingPly, updatedAt: null }]]);
		const view = buildPracticeView([v], null, new Set(), progress, ceilingMoveCount);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.path).toHaveLength(ceilingPly);
		expect(view.attempt!.path.length).not.toBe(v.path.length);
	});

	it('never applies the ceiling to a deliberate re-drill of an already-solved variation', () => {
		const v = makeVariation(5, 'a-'); // 10 plies — well past a ceiling of 2 player moves
		const ceilingMoveCount = 2;
		const view = buildPracticeView([v], v.variationKey, new Set([v.variationKey]), noTeaching, ceilingMoveCount, true);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.path).toEqual(v.path);
	});

	it('skips a blocked (paused) variation when auto-picking the next one to serve', () => {
		const a = makeVariation(5, 'a-');
		const b = makeVariation(5, 'b-');
		const ceilingMoveCount = 2;
		const ceilingPly = ceilingPlyFor(a.path, ceilingMoveCount);
		const progress = new Map([
			// a is already paused at the ceiling; b is untouched.
			[a.variationKey, { taughtPlies: ceilingPly, masteredPlies: ceilingPly, updatedAt: null }]
		]);
		const view = buildPracticeView([a, b], null, new Set(), progress, ceilingMoveCount);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(b.variationKey);
	});

	it("never teaches a DEFERRED sibling's own new content even when pickActiveVariation's last-resort fallback selects it (GitHub issue #172)", () => {
		// `a` is genuinely paused at the ceiling (the shared prefix plus its
		// own one extra move) — that alone makes `ceilingReached` true. `b`
		// shares only the common prefix with `a` (masteredPlies stops right
		// where they diverge) and would ALSO merely pause at the same
		// ceiling, so it's DEFERRED, not independently paused. With both `a`
		// and `b` now blocked and nothing else in the pool, pickActiveVariation's
		// fallback ("serve the first unsolved one anyway, ignoring blocked
		// status") lands on `b` (array order puts it first) — without the
		// fallback-safety clamp, buildPracticeView would happily teach `b`'s
		// own never-before-seen move here, reopening the exact loophole #172
		// closes the moment it's reached via this path.
		const shared: VariationStep[] = [
			{ moveId: 'shared-p1', san: 'P1', fromFen: 'f1a', toFen: 'f1b', isPlayerTurn: true },
			{ moveId: 'shared-o1', san: 'O1', fromFen: 'f1b', toFen: 'f2a', isPlayerTurn: false }
		];
		const a: Variation = {
			leafMoveId: 'a-o2',
			variationKey: 'a',
			path: [...shared, { moveId: 'a-p2', san: 'P2', fromFen: 'f2a', toFen: 'f2b', isPlayerTurn: true }, { moveId: 'a-o2', san: 'O2', fromFen: 'f2b', toFen: 'f3a', isPlayerTurn: false }],
			playerMoveCount: 2,
			chapterNames: []
		};
		const b: Variation = {
			leafMoveId: 'b-o2',
			variationKey: 'b',
			path: [...shared, { moveId: 'b-p2', san: 'P2', fromFen: 'f2a', toFen: 'f2b', isPlayerTurn: true }, { moveId: 'b-o2', san: 'O2', fromFen: 'f2b', toFen: 'f3a', isPlayerTurn: false }],
			playerMoveCount: 2,
			chapterNames: []
		};
		const ceilingMoveCount = 2; // ceilingPly = 3 for both (they share plies 0-1, diverge at ply 2)
		const progress = new Map([['a', { taughtPlies: 3, masteredPlies: 3, updatedAt: null }]]);

		// `b` first in array order, so the "everything blocked" fallback lands on it.
		const view = buildPracticeView([b, a], null, new Set(), progress, ceilingMoveCount);

		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe('b');
		// Only the shared prefix (2 plies) — b's own divergent move ('b-p2')
		// must NOT be taught, and there must be no arrow inviting one.
		expect(view.attempt!.path).toHaveLength(2);
		expect(view.attempt!.arrowPlies).toBeNull();
		expect(view.attempt!.isFinalPass).toBe(true);
	});
});

describe('optimisticSolvedAfterAttempt', () => {
	it('bumps solved by one on a clean attempt', () => {
		expect(optimisticSolvedAfterAttempt({ solved: 3, total: 10 }, false)).toBe(4);
	});

	it('leaves solved unchanged on a mistaken attempt', () => {
		expect(optimisticSolvedAfterAttempt({ solved: 3, total: 10 }, true)).toBe(3);
	});

	it('never exceeds total, even if solved was already at (or somehow past) it', () => {
		expect(optimisticSolvedAfterAttempt({ solved: 10, total: 10 }, false)).toBe(10);
	});
});

describe('buildPracticeView — queue membership comes from splitQueues', () => {
	// Self-review finding: the Practice route used splitQueues while Learn filtered
	// independently. They agreed, but two implementations of "which queue is this
	// in" is the drift the invariant exists to prevent. These pin both halves.
	it('never serves a learned variation in Learn', () => {
		const a = makeVariation(2, 'a');
		const b = makeVariation(2, 'b');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]), noTeaching);
		expect(view.attempt?.variationKey).toBe(b.variationKey);
	});

	// The re-drill path, which must keep working: the picker deliberately targets
	// an already-learned variation, and filtering learned lines out of the
	// candidates would make it silently do nothing (the bug fixed in 02bb6d6).
	it('still serves an already-learned variation when a re-drill is forced', () => {
		const a = makeVariation(2, 'a');
		const view = buildPracticeView([a], a.variationKey, new Set([a.variationKey]), noTeaching, Infinity, true);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(a.variationKey);
	});
});
