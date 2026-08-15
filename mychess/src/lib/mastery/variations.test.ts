import { describe, it, expect } from 'vitest';
import {
	enumerateVariations,
	filterVariations,
	groupByFirstMoves,
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
	chapterNames: string[] = []
): RawMoveRow {
	return {
		id,
		fromPositionId,
		toPositionId,
		fromFen: `fen:${fromPositionId}`,
		toFen: `fen:${toPositionId}`,
		san,
		isPlayerTurn,
		chapterNames
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

	it('gives two variations the same leafMoveId but different variationKeys when they transpose into a shared tail (no chapters involved)', () => {
		// Two different prefixes (m1a vs m1b) both lead into the same shared node P_SHARED,
		// which then has one single continuation to a shared leaf (m3) — a transposition
		// within a single (un-chaptered) scope, which is legitimate and NOT the bug this
		// feature fixes — see the cross-chapter tests below for that.
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

	it('carries the chapter name onto every variation walked under that chapter\'s own scope', () => {
		// Every move on the line — not just the leaf — must carry the chapter's
		// name, or the scoped walk can't reconstruct the full path (an interior
		// move with no chapter tag is invisible to every chapter's own walk).
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['Ruy Lopez']),
			move('m2', 'P1', 'P2', 'e5', false, ['Ruy Lopez']),
			move('m3', 'P2', 'P3', 'Nf3', true, ['Ruy Lopez'])
		];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterName).toBe('Ruy Lopez');
		expect(variation.path.map((s) => s.moveId)).toEqual(['m1', 'm2', 'm3']);
	});

	it('defaults chapterName to null for moves with no chapter tags at all', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterName).toBeNull();
	});

	it('sums each chapter\'s own variations instead of multiplying when chapters share a prefix then diverge', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['A', 'B']), // shared prefix, used by both chapters
			move('m2a', 'P1', 'P2A', 'Nf3', false, ['A']), // A's own continuation
			move('m2b', 'P1', 'P2B', 'Nc3', false, ['B']) // B's own continuation
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2); // one per chapter
		expect(result.map((v) => v.chapterName).sort()).toEqual(['A', 'B']);
	});

	it('does not multiply a shared continuation across chapters that transpose into it from different openings', () => {
		const moves = [
			// Chapter A reaches the shared node via its own opening move.
			move('a1', 'START_A', 'SHARED', 'e4', true, ['A']),
			// Chapter B reaches the SAME shared node via a different opening move — a transposition.
			move('b1', 'START_B', 'SHARED', 'd4', true, ['B']),
			// From the shared node, two further branches — chapter A's own game explores
			// both; chapter B's own game only explores the first.
			move('c1', 'SHARED', 'C1', 'Nf3', false, ['A', 'B']),
			move('c2', 'SHARED', 'C2', 'Bc4', false, ['A'])
		];
		const result = enumerateVariations(moves);
		// A contributes 2 (a1->c1, a1->c2). B contributes 1 (b1->c1). Total 3 — NOT 2*2=4.
		expect(result).toHaveLength(3);
		expect(result.filter((v) => v.chapterName === 'A')).toHaveLength(2);
		expect(result.filter((v) => v.chapterName === 'B')).toHaveLength(1);
	});

	it('enumerates a fully-shared line once per chapter, not deduplicated away', () => {
		// Two chapters whose entire line is textually identical — matches how a
		// real opening reference cross-references one tabiya under two headings.
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['A', 'B']),
			move('m2', 'P1', 'P2', 'e5', false, ['A', 'B'])
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result.map((v) => v.leafMoveId)).toEqual(['m2', 'm2']);
		expect(result.map((v) => v.chapterName).sort()).toEqual(['A', 'B']);
		// Same underlying path, but each chapter's own enumeration is independent.
		expect(result[0].variationKey).toBe(result[1].variationKey);
	});

	it('stays additive (not exponential) when many chapters repeatedly transpose through the same shared checkpoints', () => {
		// Reproduces the shape that crashed the server on a real 414-chapter PGN
		// import (see the design doc): chapters repeatedly transpose into and
		// back out of a shared sequence of positions. A walk that doesn't
		// distinguish chapters re-explores every downstream path once per
		// incoming way of reaching each shared checkpoint — doubling at every
		// checkpoint here, so 12 checkpoints would enumerate 2^13 (8192) paths
		// instead of the correct 2 (one per chapter). This is the actual
		// regression test for the bug.
		const CHAPTERS = ['A', 'B'];
		const CHECKPOINTS = 12;
		const moves: RawMoveRow[] = [];
		const prevByChapter: Record<string, string> = { A: 'ROOT', B: 'ROOT' };
		for (let d = 0; d < CHECKPOINTS; d++) {
			for (const chapter of CHAPTERS) {
				const to = `checkpoint-${d}`;
				moves.push(move(`m-${chapter}-${d}`, prevByChapter[chapter], to, `move-${d}`, d % 2 === 0, [chapter]));
				prevByChapter[chapter] = to;
			}
		}
		for (const chapter of CHAPTERS) {
			moves.push(move(`leaf-${chapter}`, prevByChapter[chapter], `final-${chapter}`, 'final', true, [chapter]));
		}

		const start = Date.now();
		const result = enumerateVariations(moves);
		expect(Date.now() - start).toBeLessThan(2000);
		expect(result).toHaveLength(2); // one variation per chapter, not 2^13
	});
});

describe('hasChapterTags', () => {
	it('returns false when no variation has a chapterName', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		expect(hasChapterTags(enumerateVariations(moves))).toBe(false);
	});

	it('returns true when at least one variation has a chapterName', () => {
		// Every move on the Sicilian branch's own line carries the tag — not
		// just its leaf — matching the new per-move (not per-leaf) invariant.
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2a', 'P1', 'P2A', 'e5', false),
			move('m2b', 'P1', 'P2B', 'c5', false, ['Sicilian']),
			move('m3a', 'P2A', 'P3A', 'Nf3', true),
			move('m3b', 'P2B', 'P3B', 'Nc3', true, ['Sicilian'])
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
			{ id: 'm1', fromPositionId: 'START', toPositionId: 'P1', fromFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', toFen: 'x', san: 'e4', isPlayerTurn: true, chapterNames: [] },
			{ id: 'm2', fromPositionId: 'P1', toPositionId: 'P2', fromFen: 'x', toFen: 'y', san: 'e5', isPlayerTurn: false, chapterNames: [] },
			{ id: 'm3', fromPositionId: 'P2', toPositionId: 'P3', fromFen: 'y', toFen: 'z', san: 'Nf3', isPlayerTurn: true, chapterNames: [] },
			{ id: 'm4', fromPositionId: 'P3', toPositionId: 'P4', fromFen: 'z', toFen: 'w', san: 'Nc6', isPlayerTurn: false, chapterNames: [] }
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('1.e4 e5 2.Nf3 Nc6');
	});

	it('starts from a custom mid-game FEN where Black is to move first', () => {
		const moves: RawMoveRow[] = [
			{ id: 'm1', fromPositionId: 'START', toPositionId: 'P1', fromFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 5', toFen: 'x', san: 'Nf6', isPlayerTurn: true, chapterNames: [] },
			{ id: 'm2', fromPositionId: 'P1', toPositionId: 'P2', fromFen: 'x', toFen: 'y', san: 'Bc4', isPlayerTurn: false, chapterNames: [] }
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceLabel(variation.path)).toBe('5...Nf6 6.Bc4');
	});
});

describe('groupByFirstMoves', () => {
	function step(san: string, moveId: string): VariationStep {
		return { moveId, san, fromFen: 'f', toFen: 'f2', isPlayerTurn: true };
	}
	function item(id: string, sans: string[]): { id: string; path: VariationStep[] } {
		return { id, path: sans.map((san, i) => step(san, `${id}-${i}`)) };
	}
	function stepsOf(x: { path: VariationStep[] }): VariationStep[] {
		return x.path;
	}
	function labels(groups: ReturnType<typeof groupByFirstMoves>) {
		return groups.map((g) => g.steps.map((s) => s.san));
	}
	function ids(group: ReturnType<typeof groupByFirstMoves>[number]) {
		return group.items.map((v: any) => v.id);
	}

	it('buckets items that share the same first-N-plies key together, distinct keys apart', () => {
		const items = [
			item('a', ['e4', 'e5', 'Nf3']),
			item('b', ['e4', 'e5', 'Nf3']),
			item('c', ['d4', 'd5', 'c4'])
		];
		const groups = groupByFirstMoves(items, stepsOf, 3, 5);
		expect(labels(groups)).toEqual([
			['e4', 'e5', 'Nf3'],
			['d4', 'd5', 'c4']
		]);
		expect(ids(groups[0])).toEqual(['a', 'b']);
		expect(ids(groups[1])).toEqual(['c']);
	});

	it('splits items into different buckets if they diverge on the LAST ply within the window', () => {
		const items = [item('a', ['e4', 'e5', 'Nf3']), item('b', ['e4', 'e5', 'Nc3'])];
		const groups = groupByFirstMoves(items, stepsOf, 3, 5);
		expect(labels(groups)).toEqual([
			['e4', 'e5', 'Nf3'],
			['e4', 'e5', 'Nc3']
		]);
	});

	it('keeps items in the SAME bucket if they only diverge past the window', () => {
		const items = [item('a', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), item('b', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])];
		const groups = groupByFirstMoves(items, stepsOf, 3, 5); // window stops before the Bb5/Bc4 divergence
		expect(groups).toHaveLength(1);
		expect(labels(groups)).toEqual([['e4', 'e5', 'Nf3']]);
		expect(ids(groups[0])).toEqual(['a', 'b']);
	});

	it('uses an item\'s whole line as its key when it is shorter than the window', () => {
		const items = [item('a', ['e4', 'e5']), item('b', ['e4', 'e5', 'Nf3'])];
		const groups = groupByFirstMoves(items, stepsOf, 5, 5);
		// 'a' only has 2 plies, so its key is just those 2 — distinct from
		// 'b's 3-ply key, even though 'a' is a strict prefix of 'b'.
		expect(labels(groups)).toEqual([
			['e4', 'e5'],
			['e4', 'e5', 'Nf3']
		]);
	});

	it('caps at topN buckets, bucketing the rest under "Other" (empty steps)', () => {
		const items = [
			item('a', ['e4']),
			item('b', ['e4']),
			item('c', ['d4']),
			item('d', ['c4']),
			item('e', ['Nf3']),
			item('f', ['g3']),
			item('g', ['b3']) // 7th distinct key — bumped to Other
		];
		const groups = groupByFirstMoves(items, stepsOf, 1, 5);
		expect(groups).toHaveLength(6); // 5 named + Other
		const other = groups[5];
		expect(other.steps).toEqual([]);
		expect(ids(other)).toEqual(['g']);
	});

	it('omits the "Other" group entirely when everything fits in the top N', () => {
		const items = [item('a', ['e4']), item('b', ['d4'])];
		const groups = groupByFirstMoves(items, stepsOf, 1, 5);
		expect(groups.every((g) => g.steps.length > 0)).toBe(true);
	});

	it('breaks ties in frequency by first-appearance order (stable, deterministic)', () => {
		const items = [item('a', ['e4']), item('b', ['d4']), item('c', ['c4'])];
		const groups = groupByFirstMoves(items, stepsOf, 1, 2);
		expect(labels(groups)).toEqual([['e4'], ['d4'], []]);
		expect(ids(groups[2])).toEqual(['c']);
	});

	it('returns an empty array for an empty item list', () => {
		expect(groupByFirstMoves([], stepsOf, 5, 5)).toEqual([]);
	});
});
