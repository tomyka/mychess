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
		playerMoveCount
	};
}

describe('buildPracticeView', () => {
	it('serves the active variation\'s FULL path as the attempt, unsplit', () => {
		const v = makeVariation(3, 'a-');
		const view = buildPracticeView([v], null, new Set());
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(v.variationKey);
		expect(view.attempt!.path).toEqual(v.path); // whole path, no auto-play split
	});

	it('defaults to the first unsolved variation when no active key is set', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], null, new Set([a.variationKey]));
		expect(view.attempt!.variationKey).toBe(b.variationKey);
	});

	it('respects an explicit active key even if it points at an already-solved variation', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]));
		expect(view.attempt!.variationKey).toBe(a.variationKey);
	});

	it('reports solved/total across the whole repertoire', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		const c = makeVariation(2, 'c-');
		const view = buildPracticeView([a, b, c], null, new Set([a.variationKey]));
		expect(view.solved).toBe(1);
		expect(view.total).toBe(3);
	});

	it('returns a null attempt and allSolved=true once every variation is solved', () => {
		const a = makeVariation(2, 'a-');
		const view = buildPracticeView([a], null, new Set([a.variationKey]));
		expect(view.attempt).toBeNull();
		expect(view.allSolved).toBe(true);
		expect(view.solved).toBe(1);
		expect(view.total).toBe(1);
	});

	it('returns the vacuous empty-repertoire shape for no variations at all', () => {
		const view = buildPracticeView([], null, new Set());
		expect(view.attempt).toBeNull();
		expect(view.allSolved).toBe(true);
		expect(view.solved).toBe(0);
		expect(view.total).toBe(0);
	});

	it('allSolved is false while ANY variation (including a manually re-picked solved one) still has unsolved siblings', () => {
		const a = makeVariation(2, 'a-');
		const b = makeVariation(2, 'b-');
		// a is solved and explicitly re-picked, but b isn't solved yet.
		const view = buildPracticeView([a, b], a.variationKey, new Set([a.variationKey]));
		expect(view.attempt!.variationKey).toBe(a.variationKey); // respects the manual pick
		expect(view.allSolved).toBe(false); // but the repertoire as a whole isn't done
	});

	it('forceAttempt serves a manually re-picked variation even when the whole repertoire is already solved', () => {
		const a = makeVariation(2, 'a-');
		const view = buildPracticeView([a], a.variationKey, new Set([a.variationKey]), true);
		expect(view.attempt).not.toBeNull();
		expect(view.attempt!.variationKey).toBe(a.variationKey);
		expect(view.allSolved).toBe(true);
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
