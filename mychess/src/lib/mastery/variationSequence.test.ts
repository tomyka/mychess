import { describe, it, expect } from 'vitest';
import { pickActiveVariation, solvedProgress } from './variationSequence';
import { type Variation } from './variations';

function variation(key: string): Variation {
	return {
		leafMoveId: key,
		variationKey: key,
		path: [{ moveId: key, san: 'e4', fromFen: 'f', toFen: 'f2', isPlayerTurn: true }],
		playerMoveCount: 1,
		chapterNames: []
	};
}

describe('pickActiveVariation', () => {
	it('returns null for an empty variation list', () => {
		expect(pickActiveVariation([], null, new Set())).toBeNull();
	});

	it('defaults to the first UNSOLVED variation when no key is given', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], null, new Set(['a']))).toBe(b);
	});

	it('defaults to the very first variation when everything is already solved', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], null, new Set(['a', 'b']))).toBe(a);
	});

	it('returns the variation matching a given key, even if it is already solved (manual re-drill)', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], 'b', new Set(['b']))).toBe(b);
	});

	it('falls back to the first unsolved variation when the key no longer matches anything', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], 'stale-key', new Set(['a']))).toBe(b);
	});
});

describe('pickActiveVariation with a servable list', () => {
	it('omitting the list means NO gating, not "everything is servable"', () => {
		// The distinction matters: a defaulted "every key" list would make the
		// plan-ordered walk return variations[0] and quietly override the
		// first-unsolved fallback a caller without a plan relies on.
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], null, new Set(['a']))).toBe(b);
		expect(pickActiveVariation([a, b], null, new Set(['a']), ['a', 'b'])).toBe(a);
	});

	it('a stored pointer at a variation that is NO LONGER servable does not win outright — it falls through', () => {
		const variations = [variation('a'), variation('b'), variation('c')];
		const picked = pickActiveVariation(variations, 'b', new Set(), ['a', 'c']);
		expect(picked?.variationKey).toBe('a');
	});

	it('a stored pointer at an already-SOLVED variation still wins outright, servable or not (manual re-drill)', () => {
		const variations = [variation('a'), variation('b')];
		const picked = pickActiveVariation(variations, 'a', new Set(['a']), ['b']);
		expect(picked?.variationKey).toBe('a');
	});

	it("follows the PLAN's order, not the variation list's — the plan walks chapter by chapter", () => {
		const variations = [variation('a'), variation('b'), variation('c')];
		const picked = pickActiveVariation(variations, null, new Set(), ['c', 'a']);
		expect(picked?.variationKey).toBe('c');
	});

	it('falls back to the first UNSOLVED variation when nothing at all is servable, rather than showing a dead end', () => {
		const variations = [variation('a'), variation('b')];
		const picked = pickActiveVariation(variations, null, new Set(['a']), []);
		expect(picked?.variationKey).toBe('b');
	});

	it('falls back to the very first variation once everything is solved and nothing is servable', () => {
		const variations = [variation('a'), variation('b')];
		const picked = pickActiveVariation(variations, null, new Set(['a', 'b']), []);
		expect(picked?.variationKey).toBe('a');
	});

	it('ignores a servable key that no longer matches any variation (stale, e.g. repertoire edited)', () => {
		const variations = [variation('a'), variation('b')];
		const picked = pickActiveVariation(variations, null, new Set(), ['gone', 'b']);
		expect(picked?.variationKey).toBe('b');
	});
});

describe('solvedProgress', () => {
	it('counts solved vs total across the whole variation list', () => {
		const a = variation('a');
		const b = variation('b');
		const c = variation('c');
		expect(solvedProgress([a, b, c], new Set(['a', 'c']))).toEqual({ solved: 2, total: 3 });
	});

	it('is zero of zero for an empty variation list', () => {
		expect(solvedProgress([], new Set())).toEqual({ solved: 0, total: 0 });
	});

	it('does not count a solved key that no longer matches any variation (stale, e.g. repertoire edited)', () => {
		const a = variation('a');
		expect(solvedProgress([a], new Set(['a', 'stale-key']))).toEqual({ solved: 1, total: 1 });
	});
});
