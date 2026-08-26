import { describe, it, expect } from 'vitest';
import { tierForMoveCount, deriveChapterLevel, deriveRepertoireLevel, chapterCeiling, isChapterComplete } from './chapterLevels';

const v = (variationKey: string, playerMoveCount: number) => ({ variationKey, playerMoveCount });

describe('tierForMoveCount', () => {
	it('is bronze for 1-9 player moves', () => {
		expect(tierForMoveCount(1)).toBe('bronze');
		expect(tierForMoveCount(9)).toBe('bronze');
	});

	it('is silver for 10-18 player moves', () => {
		expect(tierForMoveCount(10)).toBe('silver');
		expect(tierForMoveCount(18)).toBe('silver');
	});

	it('is gold for 19-27 player moves', () => {
		expect(tierForMoveCount(19)).toBe('gold');
		expect(tierForMoveCount(27)).toBe('gold');
	});

	it('is platinum for 28+ player moves', () => {
		expect(tierForMoveCount(28)).toBe('platinum');
		expect(tierForMoveCount(500)).toBe('platinum');
	});
});

describe('deriveChapterLevel', () => {
	it('is null when even the bronze bracket is not fully solved', () => {
		const rows = [v('a', 3), v('b', 5)];
		expect(deriveChapterLevel(rows, new Set(['a']))).toBeNull();
	});

	it('reaches bronze once the bronze bracket is fully solved and there is nothing higher', () => {
		const rows = [v('a', 3), v('b', 5)];
		expect(deriveChapterLevel(rows, new Set(['a', 'b']))).toBe('bronze');
	});

	// The cumulative-ladder rule: solving only the silver-tier line while a
	// bronze-tier line in the same chapter is unsolved must NOT grant silver.
	it('does not grant silver while a lower, bronze-tier variation is unsolved', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 12)];
		expect(deriveChapterLevel(rows, new Set(['silverLine']))).toBeNull();
	});

	it('grants silver once both bronze- and silver-tier variations are solved', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 12)];
		expect(deriveChapterLevel(rows, new Set(['bronzeLine', 'silverLine']))).toBe('silver');
	});

	// Vacuous tiers: a chapter with nothing past move 18 can still reach the
	// ceiling tier it has content for, rather than being blocked on emptiness.
	it('treats an empty tier bracket as vacuously cleared', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 15)]; // nothing in gold or platinum
		expect(deriveChapterLevel(rows, new Set(['bronzeLine', 'silverLine']))).toBe('silver');
	});

	it('reaches platinum once every bracket that has content is fully solved', () => {
		const rows = [v('a', 5), v('b', 15), v('c', 22), v('d', 30)];
		expect(deriveChapterLevel(rows, new Set(['a', 'b', 'c', 'd']))).toBe('platinum');
	});

	it('is null for a chapter with no variations at all', () => {
		expect(deriveChapterLevel([], new Set())).toBeNull();
	});
});

describe('chapterCeiling', () => {
	it('is the highest tier the chapter has any content in', () => {
		const rows = [v('a', 5), v('b', 15)]; // bronze + silver, nothing gold or platinum
		expect(chapterCeiling(rows)).toBe('silver');
	});

	it('is platinum when the chapter has content that deep', () => {
		const rows = [v('a', 5), v('b', 30)];
		expect(chapterCeiling(rows)).toBe('platinum');
	});

	it('is null for a chapter with no variations at all', () => {
		expect(chapterCeiling([])).toBeNull();
	});
});

describe('isChapterComplete', () => {
	// The whole point of this predicate: a short chapter's own ceiling (not
	// literally Platinum) is what "complete" means.
	it('is complete once a short chapter (ceiling: silver) is fully solved', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(isChapterComplete(rows, new Set(['a', 'b']))).toBe(true);
	});

	it('is not complete while any content at or below its own ceiling is unsolved', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(isChapterComplete(rows, new Set(['a']))).toBe(false);
	});

	it('is not complete for an empty chapter', () => {
		expect(isChapterComplete([], new Set())).toBe(false);
	});

	// Regression test for the exclusion-blocking bug: an excluded, never-solved
	// variation must remain present in the array passed in here (never
	// pre-filtered out upstream) for this to hold — its absence from
	// `solvedKeys` alone is what should keep the chapter below its own ceiling,
	// with no exclusion special-casing needed inside this function itself.
	it('is not complete when an excluded, never-solved variation is still present in the (unfiltered) array, even if everything else is solved', () => {
		const rows = [v('a', 5), v('excludedLine', 15)]; // ceiling: silver
		expect(isChapterComplete(rows, new Set(['a']))).toBe(false);
	});
});

describe('deriveRepertoireLevel', () => {
	it('is the minimum tier across chapters', () => {
		expect(deriveRepertoireLevel(['gold', 'bronze', 'platinum'])).toBe('bronze');
	});

	// A chapter with no medal yet (null) caps the whole repertoire below Bronze.
	it('is null when any chapter has no medal at all', () => {
		expect(deriveRepertoireLevel(['gold', null])).toBeNull();
	});

	it('is platinum when every chapter is platinum', () => {
		expect(deriveRepertoireLevel(['platinum', 'platinum'])).toBe('platinum');
	});

	it('is null for a repertoire with no chapters', () => {
		expect(deriveRepertoireLevel([])).toBeNull();
	});
});
