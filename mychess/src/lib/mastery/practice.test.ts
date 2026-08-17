// mychess/src/lib/mastery/practice.test.ts
import { describe, it, expect } from 'vitest';
import { buildPracticeView, optimisticSolvedAfterAttempt } from './practice';
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

const noTeaching = new Map<string, { taughtPlies: number; masteredPlies: number }>();

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
	it('serves the active variation\'s FULL path as the attempt, unsplit', () => {
		const v = makeVariation(3, 'a-');
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

	it('respects an explicit active key even if it points at an already-solved variation', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]), noTeaching);
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

	it('allSolved is false while ANY variation (including a manually re-picked solved one) still has unsolved siblings', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]), noTeaching);
		expect(view.attempt!.variationKey).toBe(a.variationKey);
		expect(view.allSolved).toBe(false);
	});

	it('forceAttempt serves a manually re-picked variation even when the whole repertoire is already solved', () => {
		const a = makeVariation(2, 'a-');
		const view = buildPracticeView([a], a.variationKey, new Set([a.variationKey]), noTeaching, true);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(a.variationKey);
		expect(view.allSolved).toBe(true);
	});

	it('serves a truncated path and arrow range for an unsolved variation still being taught, ending on the player\'s own move', () => {
		const v = makeVariation(15, 'a-'); // 30 plies, player moves first
		const view = buildPracticeView([v], null, new Set(), noTeaching);
		// The batch ends right after the player's 5th move (ply 8), not a flat
		// 10-ply offset — see teaching.ts's plyAfterPlayerMoves.
		expect(view.attempt!.path).toHaveLength(9);
		expect(view.attempt!.arrowPlies).toEqual({ from: 0, to: 9 });
		expect(view.attempt!.isFinalPass).toBe(false);
		expect(view.attempt!.path[view.attempt!.path.length - 1].isPlayerTurn).toBe(true);
	});

	it('flags a teach pass that reaches the end of the path as the final pass, so a clean run of it solves', () => {
		const v = makeVariation(8, 'a-'); // 16 plies: batch 1 is plies 0-8, batch 2 is the rest
		const progress = new Map([[v.variationKey, { taughtPlies: 9, masteredPlies: 9 }]]);
		const view = buildPracticeView([v], null, new Set(), progress);
		expect(view.attempt!.path).toEqual(v.path);
		expect(view.attempt!.arrowPlies).toEqual({ from: 9, to: 16 });
		// isFinalPass is what gates the client's optimistic solved bump — a
		// final teach pass has to set it, or the sidebar count would lag a
		// solve by a whole round trip.
		expect(view.attempt!.isFinalPass).toBe(true);
		expect(view.attempt!.autoPlayThrough).toBe(9);
	});

	it('does not flag a fresh single-batch variation\'s first teach pass as final (it still owes one blind retest)', () => {
		const v = makeVariation(3, 'a-'); // 6 plies — one batch covers all of it
		const view = buildPracticeView([v], null, new Set(), noTeaching);
		expect(view.attempt!.arrowPlies).toEqual({ from: 0, to: 6 });
		expect(view.attempt!.isFinalPass).toBe(false);
	});

	it('ignores stale teaching-progress data for an already-solved variation and serves it at full depth with no arrow', () => {
		const v = makeVariation(15, 'a-'); // 30 plies
		const progress = new Map([[v.variationKey, { taughtPlies: 20, masteredPlies: 10 }]]);
		const view = buildPracticeView([v], v.variationKey, new Set([v.variationKey]), progress, true);
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
		const progress = new Map([[b.variationKey, { taughtPlies: 12, masteredPlies: 0 }]]);
		const view = buildPracticeView([a, b], b.variationKey, new Set([a.variationKey]), progress);
		expect(view.attempt!.path).toEqual(b.path);
		expect(view.attempt!.arrowPlies).toBeNull();
		expect(view.attempt!.isFinalPass).toBe(true);
		expect(view.attempt!.autoPlayThrough).toBe(10);
	});

	it('does not auto-play anything for an already-solved variation\'s own re-drill', () => {
		const v = makeVariation(3, 'a-');
		const view = buildPracticeView([v], v.variationKey, new Set([v.variationKey]), noTeaching, true);
		expect(view.attempt!.autoPlayThrough).toBe(0);
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
