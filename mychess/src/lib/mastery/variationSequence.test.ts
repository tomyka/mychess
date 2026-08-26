import { describe, it, expect } from 'vitest';
import { pickActiveVariation, nextVariation, advanceIfSolved, solvedProgress } from './variationSequence';
import { enumerateVariations, type RawMoveRow, type Variation } from './variations';

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

describe('pickActiveVariation with blockedKeys', () => {
	it('behaves exactly as without blockedKeys when nothing is blocked', () => {
		const a = variation('a');
		const b = variation('b');
		expect(pickActiveVariation([a, b], null, new Set(['a']), new Set())).toBe(b);
		expect(pickActiveVariation([a, b], null, new Set(['a']))).toBe(
			pickActiveVariation([a, b], null, new Set(['a']), new Set())
		);
	});

	it('a stored active pointer to a BLOCKED (unsolved, paused) variation does NOT win outright — falls through', () => {
		const variations = [variation('a'), variation('b'), variation('c')];
		const picked = pickActiveVariation(variations, 'b', new Set(), new Set(['b']));
		expect(picked?.variationKey).not.toBe('b');
	});

	it('a stored active pointer to an already-SOLVED variation still wins outright, even if it happens to be in blockedKeys', () => {
		const variations = [variation('a'), variation('b')];
		const picked = pickActiveVariation(variations, 'a', new Set(['a']), new Set(['a']));
		expect(picked?.variationKey).toBe('a');
	});

	it('skips blocked candidates when falling back to the first unsolved variation', () => {
		const variations = [variation('a'), variation('b'), variation('c')];
		const picked = pickActiveVariation(variations, null, new Set(), new Set(['a']));
		expect(picked?.variationKey).toBe('b');
	});

	it('falls back to the first variation overall when every candidate is solved or blocked', () => {
		const variations = [variation('a'), variation('b')];
		const picked = pickActiveVariation(variations, null, new Set(), new Set(['a', 'b']));
		expect(picked?.variationKey).toBe('a');
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

	// `enumerateVariations` guarantees unique keys, so these can't arise from
	// real data any more — they're the defence-in-depth guard's own tests. A
	// duplicate key used to make this loop alternate between the two copies
	// forever (verified past 10,000 iterations), spinning a serverless function
	// until it was killed and losing the player's attempt entirely.
	//
	// That loop is synchronous, so a plain call on the unguarded code would hang
	// the whole test worker rather than time out — vitest's per-test timeout
	// can't interrupt a busy loop. `boundedList` supplies the bound instead: it
	// throws once the list has been scanned more times than any terminating
	// implementation could need, so removing the guard fails these tests
	// immediately instead of wedging the suite.
	function boundedList(variations: Variation[], maxScans: number): Variation[] {
		let scans = 0;
		return new Proxy(variations, {
			get(target, prop, receiver) {
				// One `findIndex` per `nextVariation` call — i.e. per loop step.
				if (prop === 'findIndex' && ++scans > maxScans) {
					throw new Error(`advanceIfSolved scanned the list ${scans} times — it is not terminating`);
				}
				return Reflect.get(target, prop, receiver);
			}
		});
	}

	it('terminates instead of looping forever when two ADJACENT entries share a key', () => {
		const a = variation('a');
		const duplicate = variation('a'); // same variationKey — the old cross-chapter shape
		expect(advanceIfSolved('a', boundedList([a, duplicate], 8), new Set(['a']))).toBeNull();
	});

	it('terminates instead of looping forever when a duplicate key appears further down the list', () => {
		const list = [variation('a'), variation('b'), variation('a'), variation('c')];
		// 'a' and 'b' solved: the walk steps a -> b -> (the 'a' duplicate), which
		// resolves back to index 0 and would then revisit 'b' forever unguarded.
		expect(advanceIfSolved('a', boundedList(list, 8), new Set(['a', 'b']))).toBeNull();
	});

	it('never advances backwards for a line shared by two chapters, since it is now a single entry', () => {
		// The verified non-adjacent symptom: the shared line was emitted once
		// per chapter, so solving the LATER copy resolved (via findIndex) to the
		// earlier one and advanced to the entry after IT — teleporting the player
		// back into the middle of the first chapter. Merged enumeration removes
		// the second copy entirely, so "the entry after the shared line" is
		// unambiguous and always forward.
		const moves: RawMoveRow[] = [
			{ id: 'a1', fromPositionId: 'START', toPositionId: 'PA', fromFen: 'f', toFen: 'f2', san: 'e4', isPlayerTurn: true, chapterNames: ['A'] },
			{ id: 'a2', fromPositionId: 'PA', toPositionId: 'PA2', fromFen: 'f2', toFen: 'f3', san: 'Nf3', isPlayerTurn: false, chapterNames: ['A'] },
			// The shared tabiya: its own root-to-leaf line belongs to both chapters.
			{ id: 's1', fromPositionId: 'START_S', toPositionId: 'PS', fromFen: 'f', toFen: 'f2', san: 'd4', isPlayerTurn: true, chapterNames: ['A', 'B'] },
			{ id: 'b1', fromPositionId: 'START_B', toPositionId: 'PB', fromFen: 'f', toFen: 'f2', san: 'c4', isPlayerTurn: true, chapterNames: ['B'] }
		];
		const variations = enumerateVariations(moves);
		const keys = variations.map((v) => v.variationKey);
		expect(new Set(keys).size).toBe(keys.length); // no duplicate to teleport back from

		const sharedKey = variations.find((v) => v.chapterNames.length === 2)!.variationKey;
		const next = advanceIfSolved(sharedKey, variations, new Set([sharedKey]));
		expect(keys.indexOf(next!)).toBeGreaterThan(keys.indexOf(sharedKey));
	});
});

describe('advanceIfSolved with blockedKeys', () => {
	it('skips a blocked candidate the same way it already skips a solved one', () => {
		const variations = [variation('a'), variation('b'), variation('c')];
		const next = advanceIfSolved('a', variations, new Set(), new Set(['b']));
		expect(next).toBe('c');
	});

	it('returns null, without hanging, when every remaining candidate is solved or blocked', () => {
		const variations = [variation('a'), variation('b'), variation('c')];
		const next = advanceIfSolved('a', variations, new Set(['b']), new Set(['c']));
		expect(next).toBeNull();
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
