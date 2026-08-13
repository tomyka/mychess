import { describe, it, expect } from 'vitest';
import {
	enumerateVariations,
	filterVariations,
	groupByBranchPoint,
	hasChapterTags,
	moveSequenceLabel,
	type RawMoveRow,
	type Variation,
	type VariationStep
} from './variations';

function move(
	id: string,
	fromPositionId: string,
	toPositionId: string,
	san: string,
	isPlayerTurn: boolean,
	chapterName: string | null = null
): RawMoveRow {
	return {
		id,
		fromPositionId,
		toPositionId,
		fromFen: `fen:${fromPositionId}`,
		toFen: `fen:${toPositionId}`,
		san,
		isPlayerTurn,
		chapterName
	};
}

describe('enumerateVariations', () => {
	it('returns a single variation for a linear repertoire', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(1);
		expect(result[0].leafMoveId).toBe('m3');
		expect(result[0].path.map((s) => s.moveId)).toEqual(['m1', 'm2', 'm3']);
		expect(result[0].playerMoveCount).toBe(2);
	});

	it('splits into two variations when the opponent has two replies', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2a', 'P1', 'P2A', 'e5', false),
			move('m2b', 'P1', 'P2B', 'c5', false),
			move('m3a', 'P2A', 'P3A', 'Nf3', true),
			move('m3b', 'P2B', 'P3B', 'Nc3', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		const leafIds = result.map((v) => v.leafMoveId).sort();
		expect(leafIds).toEqual(['m3a', 'm3b']);
		for (const v of result) {
			expect(v.playerMoveCount).toBe(2);
			expect(v.path[0].moveId).toBe('m1'); // shared prefix
		}
	});

	it('splits into two variations when the player has two prepared responses at the same node', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3a', 'P2', 'P3A', 'Nf3', true),
			move('m3b', 'P2', 'P3B', 'Bc4', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result.map((v) => v.leafMoveId).sort()).toEqual(['m3a', 'm3b']);
	});

	it('handles multiple independent roots in the same repertoire', () => {
		const moves = [
			move('m1', 'START_A', 'P1', 'e4', true),
			move('m2', 'START_B', 'P2', 'd4', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result.map((v) => v.leafMoveId).sort()).toEqual(['m1', 'm2']);
	});

	it('counts only is_player_turn steps toward playerMoveCount', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true),
			move('m4', 'P3', 'P4', 'Nc6', false),
			move('m5', 'P4', 'P5', 'Bb5', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(1);
		expect(result[0].playerMoveCount).toBe(3);
		expect(result[0].path).toHaveLength(5);
	});

	it('returns an empty array for no moves', () => {
		expect(enumerateVariations([])).toEqual([]);
	});

	it('gives two variations the same leafMoveId but different variationKeys when they transpose into a shared tail', () => {
		// Two different prefixes (m1a vs m1b) both lead into the same shared node P_SHARED,
		// which then has one single continuation to a shared leaf (m3) — a transposition.
		const moves = [
			move('m1a', 'START_A', 'P_SHARED', 'e4', true),
			move('m1b', 'START_B', 'P_SHARED', 'd4', true),
			move('m2', 'P_SHARED', 'P2', 'Nf3', false),
			move('m3', 'P2', 'P3', 'Bb5', true)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result[0].leafMoveId).toBe('m3');
		expect(result[1].leafMoveId).toBe('m3');
		expect(result[0].variationKey).not.toBe(result[1].variationKey);
	});

	it('carries the leaf move\'s chapterName onto its Variation', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, null),
			move('m2', 'P1', 'P2', 'e5', false, null),
			move('m3', 'P2', 'P3', 'Nf3', true, 'Ruy Lopez')
		];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterName).toBe('Ruy Lopez');
	});

	it('defaults chapterName to null when the leaf move has none', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterName).toBeNull();
	});
});

describe('hasChapterTags', () => {
	it('returns false when no variation has a chapterName', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		expect(hasChapterTags(enumerateVariations(moves))).toBe(false);
	});

	it('returns true when at least one variation has a chapterName', () => {
		// The tag must be on a LEAF move — Variation.chapterName comes from the
		// leaf step only, so tagging a mid-path move (m2b) wouldn't propagate.
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2a', 'P1', 'P2A', 'e5', false, null),
			move('m2b', 'P1', 'P2B', 'c5', false, null),
			move('m3a', 'P2A', 'P3A', 'Nf3', true, null),
			move('m3b', 'P2B', 'P3B', 'Nc3', true, 'Sicilian')
		];
		expect(hasChapterTags(enumerateVariations(moves))).toBe(true);
	});

	it('returns false for an empty variation list', () => {
		expect(hasChapterTags([])).toBe(false);
	});
});

describe('filterVariations', () => {
	it('returns everything unchanged when the excluded set is empty', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		const variations = enumerateVariations(moves);
		expect(filterVariations(variations, new Set())).toEqual(variations);
	});

	it('drops variations whose variationKey is in the excluded set', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2a', 'P1', 'P2A', 'e5', false),
			move('m2b', 'P1', 'P2B', 'c5', false),
			move('m3a', 'P2A', 'P3A', 'Nf3', true),
			move('m3b', 'P2B', 'P3B', 'Nc3', true)
		];
		const variations = enumerateVariations(moves);
		const [keep, drop] = variations;
		const result = filterVariations(variations, new Set([drop.variationKey]));
		expect(result).toEqual([keep]);
	});
});

describe('moveSequenceLabel', () => {
	it('numbers full moves starting at 1, White unlabeled-space, Black no number', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true),
			move('m4', 'P3', 'P4', 'Nc6', false),
			move('m5', 'P4', 'P5', 'Bb5', true)
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('1.e4 e5 2.Nf3 Nc6 3.Bb5');
	});

	it('handles a single-move path', () => {
		const moves = [move('m1', 'START', 'P1', 'd4', true)];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('1.d4');
	});

	it('ends on Black to move without a trailing extra number', () => {
		const moves: RawMoveRow[] = [
			{ id: 'm1', fromPositionId: 'START', toPositionId: 'P1', fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', toFen: 'x', san: 'e4', isPlayerTurn: true, chapterName: null },
			{ id: 'm2', fromPositionId: 'P1', toPositionId: 'P2', fromFen: 'x', toFen: 'y', san: 'e5', isPlayerTurn: false, chapterName: null },
			{ id: 'm3', fromPositionId: 'P2', toPositionId: 'P3', fromFen: 'y', toFen: 'z', san: 'Nf3', isPlayerTurn: true, chapterName: null },
			{ id: 'm4', fromPositionId: 'P3', toPositionId: 'P4', fromFen: 'z', toFen: 'w', san: 'Nc6', isPlayerTurn: false, chapterName: null }
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('1.e4 e5 2.Nf3 Nc6');
	});

	it('starts from a custom mid-game FEN where Black is to move first', () => {
		const moves: RawMoveRow[] = [
			{ id: 'm1', fromPositionId: 'START', toPositionId: 'P1', fromFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 5', toFen: 'x', san: 'Nf6', isPlayerTurn: true, chapterName: null },
			{ id: 'm2', fromPositionId: 'P1', toPositionId: 'P2', fromFen: 'x', toFen: 'y', san: 'Bc4', isPlayerTurn: false, chapterName: null }
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('5...Nf6 6.Bc4');
	});
});

describe('groupByBranchPoint', () => {
	function step(san: string, moveId: string): VariationStep {
		return { moveId, san, fromFen: 'f', toFen: 'f2', isPlayerTurn: true };
	}
	function item(id: string, sans: string[]): { id: string; path: VariationStep[] } {
		return { id, path: sans.map((san, i) => step(san, `${id}-${i}`)) };
	}
	function stepsOf(x: { path: VariationStep[] }): VariationStep[] {
		return x.path;
	}
	function labels(groups: ReturnType<typeof groupByBranchPoint>) {
		return groups.map((g) => g.steps.map((s) => s.san));
	}
	function ids(group: ReturnType<typeof groupByBranchPoint>[number]) {
		return group.items.map((v: any) => v.id);
	}

	it('groups items by their first move when they diverge immediately, most frequent first', () => {
		const items = [item('a', ['e4']), item('b', ['e4']), item('c', ['d4'])];
		const groups = groupByBranchPoint(items, stepsOf, 0, 5);
		expect(labels(groups)).toEqual([['e4'], ['d4']]);
		expect(ids(groups[0])).toEqual(['a', 'b']);
		expect(ids(groups[1])).toEqual(['c']);
		expect(groups[0].depth).toBe(1);
	});

	it('collapses a long shared prefix into one group, stopping right before the point it actually forks', () => {
		const items = [item('a', ['e4', 'c6', 'd4', 'd5', 'Qb6']), item('b', ['e4', 'c6', 'd4', 'd5', 'e6'])];
		const groups = groupByBranchPoint(items, stepsOf, 0, 5);
		expect(groups).toHaveLength(1);
		expect(labels(groups)).toEqual([['e4', 'c6', 'd4', 'd5']]);
		expect(ids(groups[0])).toEqual(['a', 'b']);
		expect(groups[0].depth).toBe(4);
	});

	it('drilling into a collapsed prefix reveals the real fork as its own tier, each branch extended as far as its own items still agree', () => {
		const items = [
			item('a', ['e4', 'c6', 'd4', 'd5', 'Qb6', 'Nbd2', 'Qxb2']),
			item('b', ['e4', 'c6', 'd4', 'd5', 'Qb6', 'Nbd2', 'Rb1']),
			item('c', ['e4', 'c6', 'd4', 'd5', 'e6'])
		];
		const [prefixGroup] = groupByBranchPoint(items, stepsOf, 0, 5);
		expect(prefixGroup.depth).toBe(4);

		const forked = groupByBranchPoint(prefixGroup.items, stepsOf, prefixGroup.depth, 5);
		expect(labels(forked)).toEqual([
			['Qb6', 'Nbd2'], // a and b both continue with the forced "Nbd2" reply — folded into this tier's own label
			['e6']
		]);
		expect(ids(forked[0])).toEqual(['a', 'b']);
		expect(forked[0].depth).toBe(6); // e4 c6 d4 d5 Qb6 Nbd2 = 6 plies consumed
		expect(ids(forked[1])).toEqual(['c']);
	});

	it('caps at topN branches at the real fork, bucketing the rest under "Other" (empty steps)', () => {
		const items = [
			item('a', ['e4']),
			item('b', ['e4']),
			item('c', ['d4']),
			item('d', ['c4']),
			item('e', ['Nf3']),
			item('f', ['g3']),
			item('g', ['b3']) // 7th distinct first move — bumped to Other
		];
		const groups = groupByBranchPoint(items, stepsOf, 0, 5);
		expect(groups).toHaveLength(6); // 5 named + Other
		const other = groups[5];
		expect(other.steps).toEqual([]);
		expect(ids(other)).toEqual(['g']);
	});

	it('omits the "Other" group entirely when everything fits in the top N', () => {
		const items = [item('a', ['e4']), item('b', ['d4'])];
		const groups = groupByBranchPoint(items, stepsOf, 0, 5);
		expect(groups.every((g) => g.steps.length > 0)).toBe(true);
	});

	it('breaks ties in frequency by first-appearance order (stable, deterministic)', () => {
		const items = [item('a', ['e4']), item('b', ['d4']), item('c', ['c4'])];
		const groups = groupByBranchPoint(items, stepsOf, 0, 2);
		expect(labels(groups)).toEqual([['e4'], ['d4'], []]);
		expect(ids(groups[2])).toEqual(['c']);
	});

	it('collapses a single item with no siblings into one group spanning its entire remaining path', () => {
		const items = [item('a', ['e4', 'e5', 'Nf3'])];
		const groups = groupByBranchPoint(items, stepsOf, 0, 5);
		expect(groups).toHaveLength(1);
		expect(labels(groups)).toEqual([['e4', 'e5', 'Nf3']]);
		expect(ids(groups[0])).toEqual(['a']);
		expect(groups[0].depth).toBe(3);
	});

	it('keeps a variation that ends earlier than a sibling grouped with it up to the point it actually ends, then splits it into its own leaf on the next drill-down', () => {
		const items = [item('a', ['e4', 'e5']), item('b', ['e4', 'e5', 'Nf3'])];
		const [prefixGroup] = groupByBranchPoint(items, stepsOf, 0, 5);
		expect(labels([prefixGroup])).toEqual([['e4', 'e5']]);
		expect(ids(prefixGroup)).toEqual(['a', 'b']);
		expect(prefixGroup.depth).toBe(2);

		const split = groupByBranchPoint(prefixGroup.items, stepsOf, prefixGroup.depth, 5);
		expect(split).toHaveLength(2);
		const leaf = split.find((g) => ids(g)[0] === 'a')!;
		const continuing = split.find((g) => ids(g)[0] === 'b')!;
		expect(leaf.steps).toEqual([]);
		expect(leaf.depth).toBe(2);
		expect(labels([continuing])).toEqual([['Nf3']]);
		expect(continuing.depth).toBe(3);
	});

	it('returns an empty array for an empty item list', () => {
		expect(groupByBranchPoint([], stepsOf, 0, 5)).toEqual([]);
	});
});
