// mychess/src/lib/repertoire-diff-review.test.ts
import { describe, it, expect } from 'vitest';
import { segmentsOf, consequenceOf, verdictOf, moveLabel, type ReviewDiff, type ReviewPreview } from './repertoire-diff-review';

/** A minimal `ReviewDiff`, filled in per test. */
function diff(overrides: Partial<ReviewDiff>): ReviewDiff {
	return {
		kind: 'unchanged',
		existingKey: 'k',
		sans: null,
		previousSans: null,
		commonPlies: 0,
		chapterNames: [],
		...overrides
	};
}

describe('moveLabel', () => {
	it('labels only even plies, one-indexed by move number', () => {
		expect(moveLabel(0)).toBe('1.');
		expect(moveLabel(1)).toBe('');
		expect(moveLabel(2)).toBe('2.');
		expect(moveLabel(3)).toBe('');
		expect(moveLabel(10)).toBe('6.');
	});
});

describe('segmentsOf', () => {
	it('renders an unchanged line as one unstruck context segment', () => {
		const d = diff({ kind: 'unchanged', sans: ['e4', 'e5'], previousSans: ['e4', 'e5'], commonPlies: 2 });
		const segments = segmentsOf(d, false);
		expect(segments).toEqual([{ sans: ['e4', 'e5'], startPly: 0, styleKind: 'context', struck: false }]);
	});

	it('renders a pure append as a context prefix plus an extended tail', () => {
		const d = diff({
			kind: 'extended',
			previousSans: ['e4', 'e5'],
			sans: ['e4', 'e5', 'Nf3', 'Nc6'],
			commonPlies: 2
		});
		const segments = segmentsOf(d, false);
		expect(segments).toEqual([
			{ sans: ['e4', 'e5'], startPly: 0, styleKind: 'context', struck: false },
			{ sans: ['Nf3', 'Nc6'], startPly: 2, styleKind: 'extended', struck: false }
		]);
	});

	it('renders a pure truncation as a context prefix plus the dropped tail struck out', () => {
		const d = diff({
			kind: 'truncated',
			previousSans: ['e4', 'e5', 'Nf3', 'Nc6'],
			sans: ['e4', 'e5'],
			commonPlies: 2
		});
		const segments = segmentsOf(d, false);
		expect(segments).toEqual([
			{ sans: ['e4', 'e5'], startPly: 0, styleKind: 'context', struck: false },
			{ sans: ['Nf3', 'Nc6'], startPly: 2, styleKind: 'removed', struck: true }
		]);
	});

	it('renders a replacement (diverged, same length) as context, struck-removed, then diverged', () => {
		// 7...Qc7 8.a4 -> 8.Bd3, same length: diverges at ply 14.
		const d = diff({
			kind: 'diverged',
			previousSans: ['a4'],
			sans: ['Bd3'],
			commonPlies: 0
		});
		const segments = segmentsOf(d, false);
		expect(segments).toEqual([
			{ sans: ['a4'], startPly: 0, styleKind: 'removed', struck: true },
			{ sans: ['Bd3'], startPly: 0, styleKind: 'diverged', struck: false }
		]);
	});

	it('renders a replacement that also grows as context, struck-removed, diverged first ply, extended tail', () => {
		const d = diff({
			kind: 'diverged',
			previousSans: ['e4', 'e5', 'a4'],
			sans: ['e4', 'e5', 'Bd3', 'Be7', 'Qd2'],
			commonPlies: 2
		});
		const segments = segmentsOf(d, false);
		expect(segments).toEqual([
			{ sans: ['e4', 'e5'], startPly: 0, styleKind: 'context', struck: false },
			{ sans: ['a4'], startPly: 2, styleKind: 'removed', struck: true },
			{ sans: ['Bd3'], startPly: 2, styleKind: 'diverged', struck: false },
			{ sans: ['Be7', 'Qd2'], startPly: 3, styleKind: 'extended', struck: false }
		]);
	});

	it('renders a new line entirely as one unstruck new segment', () => {
		const d = diff({ kind: 'new', previousSans: null, sans: ['d4', 'd5'], commonPlies: 0 });
		expect(segmentsOf(d, false)).toEqual([{ sans: ['d4', 'd5'], startPly: 0, styleKind: 'new', struck: false }]);
	});

	it('renders a removed, unspared line struck in the removed colour', () => {
		const d = diff({ kind: 'removed', previousSans: ['e4', 'e5'], sans: null, commonPlies: 0 });
		expect(segmentsOf(d, false)).toEqual([{ sans: ['e4', 'e5'], startPly: 0, styleKind: 'removed', struck: true }]);
	});

	it('renders a removed, SPARED line unstruck in the unchanged colour', () => {
		const d = diff({ kind: 'removed', previousSans: ['e4', 'e5'], sans: null, commonPlies: 0 });
		expect(segmentsOf(d, true)).toEqual([{ sans: ['e4', 'e5'], startPly: 0, styleKind: 'unchanged', struck: false }]);
	});

	it('returns nothing for a degenerate diff with neither sans nor previousSans', () => {
		const d = diff({ kind: 'removed', previousSans: null, sans: null });
		expect(segmentsOf(d, false)).toEqual([]);
	});
});

describe('consequenceOf', () => {
	it('has a spared-aware message for removed, and ignores `spared` for every other kind', () => {
		expect(consequenceOf(diff({ kind: 'removed' }), true)).not.toBe(consequenceOf(diff({ kind: 'removed' }), false));
		// Sanity: the two branches actually resolve to real (non-empty) strings.
		expect(consequenceOf(diff({ kind: 'removed' }), true).length).toBeGreaterThan(0);
		expect(consequenceOf(diff({ kind: 'removed' }), false).length).toBeGreaterThan(0);
	});

	it('reports the count of new plies added past the common prefix for extended', () => {
		const d = diff({ kind: 'extended', sans: ['e4', 'e5', 'Nf3', 'Nc6'], commonPlies: 2 });
		expect(consequenceOf(d, false)).toContain('2');
	});

	it('reports the count of plies dropped past the common prefix for truncated', () => {
		const d = diff({ kind: 'truncated', previousSans: ['e4', 'e5', 'Nf3', 'Nc6'], commonPlies: 2 });
		expect(consequenceOf(d, false)).toContain('2');
	});

	it('distinguishes a fresh new line from one continuing shared inheritance', () => {
		const fresh = consequenceOf(diff({ kind: 'new', commonPlies: 0 }), false);
		const continued = consequenceOf(diff({ kind: 'new', commonPlies: 6 }), false);
		expect(fresh).not.toBe(continued);
	});
});

describe('verdictOf', () => {
	function preview(overrides: Partial<ReviewPreview>): Pick<ReviewPreview, 'diffs' | 'impact'> {
		return {
			diffs: [],
			impact: {
				counts: { unchanged: 0, extended: 0, truncated: 0, diverged: 0, new: 0, removed: 0 },
				demotedLineCount: 0,
				removedLearnedCount: 0,
				affectedPlayerCount: 0
			},
			...overrides
		};
	}

	it('reports no changes when nothing in the upload differs', () => {
		const result = verdictOf(preview({}), new Set(), 5);
		expect(result).toMatch(/matches the repertoire exactly/i);
	});

	it('mentions additions when new lines are present', () => {
		const p = preview({ impact: { ...preview({}).impact, counts: { ...preview({}).impact.counts, new: 3 } } });
		expect(verdictOf(p, new Set(), 5)).toContain('3');
	});

	it('counts a removed-but-kept line as spared, not retired, and the two counts are disjoint', () => {
		const diffs: ReviewDiff[] = [
			diff({ kind: 'removed', chapterNames: ['Kept'] }),
			diff({ kind: 'removed', chapterNames: ['Gone'] })
		];
		const p = preview({
			diffs,
			impact: { ...preview({}).impact, counts: { ...preview({}).impact.counts, removed: 2 } }
		});
		const result = verdictOf(p, new Set(['Kept']), 5);
		// One retired (the unkept chapter), one spared (the kept chapter) — not
		// two retired and not two spared.
		expect(result.toLowerCase()).toContain('retire 1 line');
		expect(result.toLowerCase()).toContain('leave 1 line');
	});

	it('reports no student cost when nothing is demoted', () => {
		const p = preview({ impact: { ...preview({}).impact, counts: { ...preview({}).impact.counts, new: 1 } } });
		const result = verdictOf(p, new Set(), 5);
		expect(result.toLowerCase()).toMatch(/no student/);
	});

	it('reports the demoted-line and affected-player counts when something is demoted', () => {
		const p = preview({
			impact: {
				counts: { unchanged: 0, extended: 1, truncated: 0, diverged: 0, new: 0, removed: 0 },
				demotedLineCount: 4,
				removedLearnedCount: 0,
				affectedPlayerCount: 2
			}
		});
		const result = verdictOf(p, new Set(), 9);
		expect(result).toContain('4');
		expect(result).toContain('2');
		expect(result).toContain('9');
	});
});
