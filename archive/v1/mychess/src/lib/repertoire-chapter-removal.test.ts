import { describe, it, expect } from 'vitest';
import { UNTAGGED_CHAPTER, enumerateVariations, type RawMoveRow } from './mastery/variations';
import {
	planChapterRemoval,
	summarizeChapters,
	removedVariationKeys,
	removesEveryChapter
} from './repertoire-chapter-removal';

/**
 * One move edge. Synthetic position ids — nothing here validates chess
 * legality, only how the graph is walked and how chapter names are carried.
 */
function move(id: string, from: string, to: string, chapterNames: string[], isPlayerTurn = true): RawMoveRow {
	return {
		id,
		fromPositionId: from,
		toPositionId: to,
		fromFen: from,
		toFen: to,
		san: `s${id}`,
		isPlayerTurn,
		chapterNames
	};
}

/**
 * Two chapters that share their first edge:
 *   m1 (A,B) → m2 (A)  = chapter A's line
 *              m3 (B)  = chapter B's line
 * A's line and B's line are distinct; m1 is shared by both.
 */
const SHARED_PREFIX: RawMoveRow[] = [
	move('m1', 'p0', 'p1', ['A', 'B']),
	move('m2', 'p1', 'p2', ['A'], false),
	move('m3', 'p1', 'p3', ['B'], false)
];

describe('planChapterRemoval', () => {
	it('retires a move whose only chapter is removed', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, ['A']);
		expect(plan.retireMoveIds).toEqual(['m2']);
	});

	it('never retires a move a surviving chapter still claims', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, ['A']);
		// m1 carries A and B; B survives, so the edge must stay walkable.
		expect(plan.retireMoveIds).not.toContain('m1');
	});

	it('retires a move shared only between chapters that are both removed', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, ['A', 'B']);
		expect(plan.retireMoveIds.sort()).toEqual(['m1', 'm2', 'm3']);
		expect(plan.totalVariations).toBe(0);
	});

	it('recomputes the shape from the surviving moves', () => {
		const before = enumerateVariations(SHARED_PREFIX);
		expect(before).toHaveLength(2);

		const plan = planChapterRemoval(SHARED_PREFIX, ['A']);
		expect(plan.totalVariations).toBe(1);
		expect(plan.hasChapters).toBe(true);
		expect(plan.chapterCount).toBe(1);
	});

	it('leaves has_chapters false and one implicit chapter when every named chapter goes', () => {
		// A tagged chapter alongside genuinely untagged lines: removing the
		// tagged one leaves an untagged remainder, which is not "chaptered".
		const mixed: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A']),
			move('m2', 'p1', 'p2', ['A'], false),
			move('m3', 'p0', 'q1', []),
			move('m4', 'q1', 'q2', [], false)
		];
		const plan = planChapterRemoval(mixed, ['A']);
		expect(plan.retireMoveIds.sort()).toEqual(['m1', 'm2']);
		expect(plan.totalVariations).toBe(1);
		expect(plan.hasChapters).toBe(false);
		expect(plan.chapterCount).toBe(1); // the implicit UNTAGGED bucket
	});

	it('removes the untagged bucket by its sentinel name', () => {
		const mixed: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A']),
			move('m2', 'p1', 'p2', ['A'], false),
			move('m3', 'p0', 'q1', []),
			move('m4', 'q1', 'q2', [], false)
		];
		const plan = planChapterRemoval(mixed, [UNTAGGED_CHAPTER]);
		expect(plan.retireMoveIds.sort()).toEqual(['m3', 'm4']);
		expect(plan.totalVariations).toBe(1);
		expect(plan.hasChapters).toBe(true);
	});

	it('is a no-op for an empty removal list', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, []);
		expect(plan.retireMoveIds).toEqual([]);
		expect(plan.totalVariations).toBe(2);
	});

	it('ignores a chapter name the repertoire does not have', () => {
		const plan = planChapterRemoval(SHARED_PREFIX, ['Nope']);
		expect(plan.retireMoveIds).toEqual([]);
		expect(plan.totalVariations).toBe(2);
	});
});

describe('summarizeChapters', () => {
	it('reports each chapter with its line count and how many are shared', () => {
		// Both chapters' lines are distinct here, so nothing is shared at the
		// LINE level even though m1 is a shared edge.
		const impacts = summarizeChapters(enumerateVariations(SHARED_PREFIX));
		expect(impacts.map((i) => i.name)).toEqual(['A', 'B']);
		expect(impacts[0].lineCount).toBe(1);
		expect(impacts[0].sharedLineCount).toBe(0);
		expect(impacts[0].exclusiveVariationKeys).toEqual(['m1>m2']);
	});

	it('counts a line belonging to two chapters as shared under both', () => {
		// One single line tagged by both chapters — a cross-referenced tabiya.
		const both: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A', 'B']),
			move('m2', 'p1', 'p2', ['A', 'B'], false)
		];
		const impacts = summarizeChapters(enumerateVariations(both));
		expect(impacts.map((i) => i.name)).toEqual(['A', 'B']);
		for (const impact of impacts) {
			expect(impact.lineCount).toBe(1);
			expect(impact.sharedLineCount).toBe(1);
			expect(impact.exclusiveVariationKeys).toEqual([]);
		}
	});

	it('includes the untagged bucket for a mixed repertoire', () => {
		const mixed: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A']),
			move('m2', 'p1', 'p2', ['A'], false),
			move('m3', 'p0', 'q1', []),
			move('m4', 'q1', 'q2', [], false)
		];
		const impacts = summarizeChapters(enumerateVariations(mixed));
		expect(impacts.map((i) => i.name)).toEqual(['A', UNTAGGED_CHAPTER]);
		const untagged = impacts[1];
		expect(untagged.lineCount).toBe(1);
		expect(untagged.sharedLineCount).toBe(0);
		expect(untagged.exclusiveVariationKeys).toEqual(['m3>m4']);
	});

	it('returns nothing for a repertoire with no chapter tags at all', () => {
		const untagged: RawMoveRow[] = [move('m1', 'p0', 'p1', []), move('m2', 'p1', 'p2', [], false)];
		expect(summarizeChapters(enumerateVariations(untagged))).toEqual([]);
	});
});

describe('removedVariationKeys', () => {
	it('lists only the lines every one of whose chapters is being removed', () => {
		const variations = enumerateVariations(SHARED_PREFIX);
		expect(removedVariationKeys(variations, ['A'])).toEqual(['m1>m2']);
	});

	it('counts a line shared by two removed chapters exactly once', () => {
		const both: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A', 'B']),
			move('m2', 'p1', 'p2', ['A', 'B'], false)
		];
		expect(removedVariationKeys(enumerateVariations(both), ['A', 'B'])).toEqual(['m1>m2']);
	});

	it('spares a line one of whose chapters survives', () => {
		const both: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A', 'B']),
			move('m2', 'p1', 'p2', ['A', 'B'], false)
		];
		expect(removedVariationKeys(enumerateVariations(both), ['A'])).toEqual([]);
	});
});

describe('removesEveryChapter', () => {
	it('is true when the selection covers every tier', () => {
		expect(removesEveryChapter(enumerateVariations(SHARED_PREFIX), ['A', 'B'])).toBe(true);
	});

	it('is false when a tier survives', () => {
		expect(removesEveryChapter(enumerateVariations(SHARED_PREFIX), ['A'])).toBe(false);
	});

	it('counts the untagged bucket as a tier that must be covered', () => {
		const mixed: RawMoveRow[] = [
			move('m1', 'p0', 'p1', ['A']),
			move('m2', 'p1', 'p2', ['A'], false),
			move('m3', 'p0', 'q1', []),
			move('m4', 'q1', 'q2', [], false)
		];
		expect(removesEveryChapter(enumerateVariations(mixed), ['A'])).toBe(false);
		expect(removesEveryChapter(enumerateVariations(mixed), ['A', UNTAGGED_CHAPTER])).toBe(true);
	});
});
