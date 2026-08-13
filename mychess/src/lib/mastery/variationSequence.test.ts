import { describe, it, expect } from 'vitest';
import { pickActiveVariation, nextVariation, advanceIfSolved, solvedProgress } from './variationSequence';
import type { Variation } from './variations';

function variation(key: string): Variation {
	return {
		leafMoveId: key,
		variationKey: key,
		path: [{ moveId: key, san: 'e4', fromFen: 'f', toFen: 'f2', isPlayerTurn: true }],
		playerMoveCount: 1
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

describe('nextVariation', () => {
	it('returns the variation right after the given key', () => {
		const a = variation('a');
		const b = variation('b');
		const c = variation('c');
		expect(nextVariation([a, b, c], 'a')).toBe(b);
	});

	it('returns null when the given key is the last variation', () => {
		const a = variation('a');
		const b = variation('b');
		expect(nextVariation([a, b], 'b')).toBeNull();
	});

	it('returns null when the given key is not found', () => {
		const a = variation('a');
		expect(nextVariation([a], 'no-such-key')).toBeNull();
	});
});

describe('advanceIfSolved', () => {
	it('returns the next UNSOLVED variation\'s key after the given one', () => {
		const a = variation('a');
		const b = variation('b');
		const c = variation('c');
		expect(advanceIfSolved('a', [a, b, c], new Set(['a']))).toBe('b');
	});

	it('skips over variations that are ALSO already solved (e.g. solved earlier via manual re-drill)', () => {
		const a = variation('a');
		const b = variation('b');
		const c = variation('c');
		expect(advanceIfSolved('a', [a, b, c], new Set(['a', 'b']))).toBe('c');
	});

	it('returns null when every remaining variation is already solved (whole repertoire done)', () => {
		const a = variation('a');
		const b = variation('b');
		expect(advanceIfSolved('a', [a, b], new Set(['a', 'b']))).toBeNull();
	});

	it('returns null when the given key is the last variation in sequence', () => {
		const a = variation('a');
		const b = variation('b');
		expect(advanceIfSolved('b', [a, b], new Set(['a', 'b']))).toBeNull();
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
