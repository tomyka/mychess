import { describe, it, expect } from 'vitest';
import {
	enumerateVariations,
	filterVariations,
	groupVariationsByFirstMove,
	hasChapterTags,
	moveSequenceLabel,
	type RawMoveRow,
	type Variation
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

describe('groupVariationsByFirstMove', () => {
	function withFirstMove(san: string, key: string): Variation {
		return {
			leafMoveId: key,
			variationKey: key,
			path: [{ moveId: key, san, fromFen: 'f', toFen: 'f2', isPlayerTurn: true }],
			playerMoveCount: 1
		};
	}

	it('groups variations by their first move, most frequent first', () => {
		const variations = [withFirstMove('e4', 'a'), withFirstMove('e4', 'b'), withFirstMove('d4', 'c')];
		const groups = groupVariationsByFirstMove(variations, 5);
		expect(groups.map((g) => g.move)).toEqual(['e4', 'd4']);
		expect(groups[0].items.map((v) => v.variationKey)).toEqual(['a', 'b']);
		expect(groups[1].items.map((v) => v.variationKey)).toEqual(['c']);
	});

	it('caps at topN groups, bucketing everything else under "Other" (move: null)', () => {
		const variations = [
			withFirstMove('e4', 'a'),
			withFirstMove('e4', 'b'),
			withFirstMove('d4', 'c'),
			withFirstMove('c4', 'd'),
			withFirstMove('Nf3', 'e'),
			withFirstMove('g3', 'f'),
			withFirstMove('b3', 'g') // 6th distinct first move — bumped to Other
		];
		const groups = groupVariationsByFirstMove(variations, 5);
		expect(groups).toHaveLength(6); // 5 named + Other
		expect(groups[5].move).toBeNull();
		expect(groups[5].items.map((v) => v.variationKey)).toEqual(['g']);
	});

	it('omits the "Other" group entirely when every variation fits in the top N', () => {
		const variations = [withFirstMove('e4', 'a'), withFirstMove('d4', 'b')];
		const groups = groupVariationsByFirstMove(variations, 5);
		expect(groups.every((g) => g.move !== null)).toBe(true);
	});

	it('breaks ties in frequency by first-appearance order (stable, deterministic)', () => {
		// e4, d4, c4 all appear exactly once each — with topN 2, only e4 and d4
		// (the first two distinct moves to appear) should make the cut, not c4.
		const variations = [withFirstMove('e4', 'a'), withFirstMove('d4', 'b'), withFirstMove('c4', 'c')];
		const groups = groupVariationsByFirstMove(variations, 2);
		expect(groups.map((g) => g.move)).toEqual(['e4', 'd4', null]);
		expect(groups[groups.length - 1].move).toBeNull(); // c4 bucketed to Other
		expect(groups[groups.length - 1].items.map((v) => v.variationKey)).toEqual(['c']);
	});

	it('returns an empty array for an empty variation list', () => {
		expect(groupVariationsByFirstMove([], 5)).toEqual([]);
	});
});
