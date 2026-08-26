import { describe, it, expect } from 'vitest';
import {
	deriveRepertoireStatus,
	deriveRepertoireStatusFromCounts,
	fullyLearnedChapters,
	isMasteryCurrent,
	masterableChapters,
	type RepertoireStatus
} from './repertoireStatus';
import { UNTAGGED_CHAPTER } from './variations';

/** Minimal shape the status derivation needs — not a full Variation. */
const v = (variationKey: string, chapterNames: string[] = []) => ({ variationKey, chapterNames });

const status = (args: Parameters<typeof deriveRepertoireStatus>[0]): RepertoireStatus =>
	deriveRepertoireStatus(args);

describe('isMasteryCurrent', () => {
	const EARNED = '2026-08-20T10:00:00.000Z';

	it('is current when the repertoire has not changed since mastery was earned', () => {
		expect(isMasteryCurrent(EARNED, EARNED)).toBe(true);
	});

	it('is stale once the repertoire\'s moves change', () => {
		expect(isMasteryCurrent(EARNED, '2026-08-21T09:00:00.000Z')).toBe(false);
	});

	// Defensive: a record stamped after the repertoire's own timestamp can only
	// come from clock skew or a re-read, and treating it as stale would revoke
	// mastery nobody invalidated.
	it('is current when the record is somehow newer than the repertoire', () => {
		expect(isMasteryCurrent('2026-08-22T00:00:00.000Z', EARNED)).toBe(true);
	});

	it('is never current when either timestamp is missing', () => {
		expect(isMasteryCurrent(null, EARNED)).toBe(false);
		expect(isMasteryCurrent(EARNED, null)).toBe(false);
	});
});

describe('masterableChapters', () => {
	it('lists each chapter once, in first-appearance order', () => {
		expect(masterableChapters([v('a', ['Open']), v('b', ['Closed']), v('c', ['Open'])])).toEqual([
			'Open',
			'Closed'
		]);
	});

	it('adds the untagged bucket last when some lines carry no chapter', () => {
		expect(masterableChapters([v('a', ['Open']), v('b')])).toEqual(['Open', UNTAGGED_CHAPTER]);
	});

	// A repertoire imported from a PGN with no chapter headers still has to be
	// masterable, so it becomes one implicit chapter rather than none.
	it('treats a wholly untagged repertoire as a single implicit chapter', () => {
		expect(masterableChapters([v('a'), v('b')])).toEqual([UNTAGGED_CHAPTER]);
	});

	it('has no chapters for an empty repertoire', () => {
		expect(masterableChapters([])).toEqual([]);
	});
});

describe('deriveRepertoireStatus', () => {
	const three = [v('a', ['Open']), v('b', ['Open']), v('c', ['Closed'])];

	it('is learning while any variation is un-learned', () => {
		expect(status({ variations: three, learnedKeys: new Set(['a']), currentlyMasteredChapters: new Set() })).toBe(
			'learning'
		);
	});

	it('is learned once every variation is learned but no chapter is mastered', () => {
		expect(
			status({ variations: three, learnedKeys: new Set(['a', 'b', 'c']), currentlyMasteredChapters: new Set() })
		).toBe('learned');
	});

	it('is still learned when only some chapters are mastered', () => {
		expect(
			status({
				variations: three,
				learnedKeys: new Set(['a', 'b', 'c']),
				currentlyMasteredChapters: new Set(['Open'])
			})
		).toBe('learned');
	});

	it('is mastered once every chapter holds current mastery', () => {
		expect(
			status({
				variations: three,
				learnedKeys: new Set(['a', 'b', 'c']),
				currentlyMasteredChapters: new Set(['Open', 'Closed'])
			})
		).toBe('mastered');
	});

	// The growth rule: new material drops the status, and the caller has already
	// filtered stale mastery out of `currentlyMasteredChapters`.
	it('drops back to learning when new un-learned material arrives, even with chapter mastery held', () => {
		expect(
			status({
				variations: [...three, v('d', ['Sharp'])],
				learnedKeys: new Set(['a', 'b', 'c']),
				currentlyMasteredChapters: new Set(['Open', 'Closed'])
			})
		).toBe('learning');
	});

	it('drops from mastered to learned when a chapter\'s mastery goes stale', () => {
		const learned = new Set(['a', 'b', 'c']);
		expect(status({ variations: three, learnedKeys: learned, currentlyMasteredChapters: new Set(['Open', 'Closed']) })).toBe(
			'mastered'
		);
		expect(status({ variations: three, learnedKeys: learned, currentlyMasteredChapters: new Set(['Open']) })).toBe(
			'learned'
		);
	});

	// Excluded lines are dropped before this function is called (the loader
	// already filters them), so the contract is simply: whatever you pass in is
	// the repertoire's scope. This pins that an excluded-away un-learned line
	// cannot hold a repertoire at 'learning'.
	it('ignores variations the caller has excluded from scope', () => {
		const inScope = three.filter((x) => x.variationKey !== 'c');
		expect(status({ variations: inScope, learnedKeys: new Set(['a', 'b']), currentlyMasteredChapters: new Set(['Open']) })).toBe(
			'mastered'
		);
	});

	// Matches the existing `allSolved = solved === total` convention, which is
	// already vacuously true for an empty repertoire.
	it('treats an empty repertoire as vacuously learned, never mastered', () => {
		expect(status({ variations: [], learnedKeys: new Set(), currentlyMasteredChapters: new Set() })).toBe('learned');
	});

	it('masters a wholly untagged repertoire through its implicit chapter', () => {
		expect(
			status({
				variations: [v('a'), v('b')],
				learnedKeys: new Set(['a', 'b']),
				currentlyMasteredChapters: new Set([UNTAGGED_CHAPTER])
			})
		).toBe('mastered');
	});

	// A line cross-referenced by two chapters belongs to both, so both must be
	// mastered before the repertoire is.
	it('requires every chapter of a shared line to be mastered', () => {
		const shared = [v('a', ['Open', 'Closed'])];
		expect(
			status({ variations: shared, learnedKeys: new Set(['a']), currentlyMasteredChapters: new Set(['Open']) })
		).toBe('learned');
		expect(
			status({
				variations: shared,
				learnedKeys: new Set(['a']),
				currentlyMasteredChapters: new Set(['Open', 'Closed'])
			})
		).toBe('mastered');
	});
});

describe('deriveRepertoireStatusFromCounts', () => {
	it('is learning when not everything is learned, regardless of counts', () => {
		expect(
			deriveRepertoireStatusFromCounts({ allLearned: false, chapterCount: 2, currentlyMasteredChapterCount: 2 })
		).toBe('learning');
	});

	it('is learned when everything is learned but the chapter count is not cached yet', () => {
		expect(
			deriveRepertoireStatusFromCounts({ allLearned: true, chapterCount: null, currentlyMasteredChapterCount: 0 })
		).toBe('learned');
	});

	it('is learned for an empty repertoire (chapterCount 0), never mastered', () => {
		expect(
			deriveRepertoireStatusFromCounts({ allLearned: true, chapterCount: 0, currentlyMasteredChapterCount: 0 })
		).toBe('learned');
	});

	it('is learned when everything is learned but only some chapters are currently mastered', () => {
		expect(
			deriveRepertoireStatusFromCounts({ allLearned: true, chapterCount: 3, currentlyMasteredChapterCount: 2 })
		).toBe('learned');
	});

	it('is mastered once the current mastery count matches the cached chapter count', () => {
		expect(
			deriveRepertoireStatusFromCounts({ allLearned: true, chapterCount: 3, currentlyMasteredChapterCount: 3 })
		).toBe('mastered');
	});
});

describe('fullyLearnedChapters', () => {
	const three = [v('a', ['Open']), v('b', ['Open']), v('c', ['Closed'])];

	it('is empty when nothing is learned', () => {
		expect(fullyLearnedChapters(three, new Set())).toEqual(new Set());
	});

	it('excludes a chapter with only some of its lines learned', () => {
		expect(fullyLearnedChapters(three, new Set(['a']))).toEqual(new Set());
	});

	it('includes a chapter the moment every one of its lines is learned, independent of other chapters', () => {
		expect(fullyLearnedChapters(three, new Set(['a', 'b']))).toEqual(new Set(['Open']));
	});

	it('includes every fully-learned chapter once the whole repertoire is learned', () => {
		expect(fullyLearnedChapters(three, new Set(['a', 'b', 'c']))).toEqual(new Set(['Open', 'Closed']));
	});

	// A shared line belongs to both its chapters, so both need it learned —
	// but the OTHER lines in each chapter still gate that chapter independently.
	it('requires a shared line\'s chapters to each have their own lines fully learned too', () => {
		const withShared = [v('a', ['Open', 'Closed']), v('b', ['Open']), v('c', ['Closed'])];
		expect(fullyLearnedChapters(withShared, new Set(['a', 'b']))).toEqual(new Set(['Open']));
		expect(fullyLearnedChapters(withShared, new Set(['a', 'b', 'c']))).toEqual(new Set(['Open', 'Closed']));
	});

	it('treats the untagged bucket as its own chapter', () => {
		const mixed = [v('a', ['Open']), v('b'), v('c')];
		expect(fullyLearnedChapters(mixed, new Set(['b']))).toEqual(new Set());
		expect(fullyLearnedChapters(mixed, new Set(['b', 'c']))).toEqual(new Set([UNTAGGED_CHAPTER]));
	});

	it('has no fully-learned chapters for an empty repertoire', () => {
		expect(fullyLearnedChapters([], new Set())).toEqual(new Set());
	});
});
