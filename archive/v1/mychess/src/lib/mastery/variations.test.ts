import { describe, it, expect } from 'vitest';
import {
	chapterTiers,
	enumerateVariations,
	filterVariations,
	groupByFirstMoves,
	hasChapterTags,
	moveIdsInVariationKey,
	moveSequenceLabel,
	moveSequenceRows,
	rowsInChapterTier,
	UNTAGGED_CHAPTER,
	variationScopes,
	type RawMoveRow,
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

	// A line the player never moves in is unplayable, not a variation: served, it
	// auto-plays and then waits forever for a move that doesn't exist.
	it('drops leaves the player never moves in', () => {
		const moves: RawMoveRow[] = [
			{ id: 'm1', fromPositionId: 'p0', toPositionId: 'p1', fromFen: 'f0', toFen: 'f1', san: 'e4', isPlayerTurn: false },
			{ id: 'm2', fromPositionId: 'p1', toPositionId: 'p2', fromFen: 'f1', toFen: 'f2', san: 'c5', isPlayerTurn: true },
			// A second opponent branch off the root that stops before any reply
			// of the player's own — a chapter that ends on the opponent's move.
			{ id: 'm3', fromPositionId: 'p0', toPositionId: 'p3', fromFen: 'f0', toFen: 'f3', san: 'd4', isPlayerTurn: false }
		];
		const variations = enumerateVariations(moves);
		expect(variations.map((v) => v.variationKey)).toEqual(['m1>m2']);
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
		expect(variation.chapterNames).toEqual(['Ruy Lopez']);
		expect(variation.path.map((s) => s.moveId)).toEqual(['m1', 'm2', 'm3']);
	});

	it('leaves chapterNames empty for moves with no chapter tags at all', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		const [variation] = enumerateVariations(moves);
		expect(variation.chapterNames).toEqual([]);
	});

	it('sums each chapter\'s own variations instead of multiplying when chapters share a prefix then diverge', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['A', 'B']), // shared prefix, used by both chapters
			move('m2a', 'P1', 'P2A', 'Nf3', false, ['A']), // A's own continuation
			move('m2b', 'P1', 'P2B', 'Nc3', false, ['B']) // B's own continuation
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2); // one per chapter
		expect(result.flatMap((v) => v.chapterNames).sort()).toEqual(['A', 'B']);
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
		expect(result.filter((v) => v.chapterNames.includes('A'))).toHaveLength(2);
		expect(result.filter((v) => v.chapterNames.includes('B'))).toHaveLength(1);
	});

	it('emits a fully-shared line ONCE, carrying every chapter it appears in', () => {
		// Two chapters whose entire line is textually identical — matches how a
		// real opening reference cross-references one tabiya under two headings.
		// Both chapters still walk it (that's what bounds the work per chapter),
		// but the results are merged: emitting it twice produced two entries with
		// the SAME variationKey, which hung `advanceIfSolved`, made one progress
		// row stand in for both copies, and double-counted `total_variations`.
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['A', 'B']),
			move('m2', 'P1', 'P2', 'e5', false, ['A', 'B'])
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(1);
		expect(result[0].leafMoveId).toBe('m2');
		expect(result[0].chapterNames).toEqual(['A', 'B']);
	});

	it('merges a line shared by three chapters into one variation listing all three', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['A', 'B', 'C']),
			move('m2', 'P1', 'P2', 'e5', false, ['A', 'B', 'C'])
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(1);
		expect(result[0].chapterNames).toEqual(['A', 'B', 'C']);
	});

	it('does not let a merged variation share its chapterNames array with any other variation', () => {
		// The merge pushes onto the surviving variation's own array; if two
		// variations from one scoped walk shared an array instance, tagging one
		// would silently tag the other too.
		const moves = [
			move('m1', 'START', 'P1', 'e4', true, ['A', 'B']), // shared prefix
			move('m2a', 'P1', 'P2A', 'Nf3', false, ['A', 'B']), // shared line, merged
			move('m2b', 'P1', 'P2B', 'Nc3', false, ['A']) // A-only line, must stay A-only
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		const shared = result.find((v) => v.leafMoveId === 'm2a')!;
		const aOnly = result.find((v) => v.leafMoveId === 'm2b')!;
		expect(shared.chapterNames).toEqual(['A', 'B']);
		expect(aOnly.chapterNames).toEqual(['A']);
		expect(aOnly.chapterNames).not.toBe(shared.chapterNames);
	});

	it('enumerates BOTH tagged and untagged lines in a mixed repertoire', () => {
		// A chaptered PGN import appended onto a repertoire that already held
		// pre-0048 (untagged) moves. The untagged line used to be walked by no
		// scope at all — the chaptered scopes filter it out, and the untagged
		// scope was only walked when NOTHING was tagged — so it silently
		// vanished from practice entirely.
		const moves = [
			move('t1', 'START_T', 'PT1', 'e4', true, ['Sicilian']),
			move('t2', 'PT1', 'PT2', 'c5', false, ['Sicilian']),
			move('u1', 'START_U', 'PU1', 'd4', true), // untagged, pre-0048
			move('u2', 'PU1', 'PU2', 'd5', false)
		];
		const result = enumerateVariations(moves);
		expect(result).toHaveLength(2);
		expect(result.map((v) => v.leafMoveId)).toEqual(['t2', 'u2']); // untagged scope walked LAST
		expect(result.map((v) => v.chapterNames)).toEqual([['Sicilian'], []]);
	});

	it('returns unique variationKeys for every shape of repertoire (the invariant every consumer assumes)', () => {
		const cases: Record<string, RawMoveRow[]> = {
			'fully shared across two chapters': [
				move('m1', 'START', 'P1', 'e4', true, ['A', 'B']),
				move('m2', 'P1', 'P2', 'e5', false, ['A', 'B'])
			],
			'shared prefix then per-chapter divergence': [
				move('m1', 'START', 'P1', 'e4', true, ['A', 'B']),
				move('m2a', 'P1', 'P2A', 'Nf3', false, ['A']),
				move('m2b', 'P1', 'P2B', 'Nc3', false, ['B'])
			],
			'chapters transposing into a shared node': [
				move('a1', 'START_A', 'SHARED', 'e4', true, ['A']),
				move('b1', 'START_B', 'SHARED', 'd4', true, ['B']),
				move('c1', 'SHARED', 'C1', 'Nf3', false, ['A', 'B']),
				move('c2', 'SHARED', 'C2', 'Bc4', false, ['A'])
			],
			mixed: [
				move('t1', 'START_T', 'PT1', 'e4', true, ['Sicilian']),
				move('t2', 'PT1', 'PT2', 'c5', false, ['Sicilian']),
				move('u1', 'START_U', 'PU1', 'd4', true)
			],
			untagged: [move('m1', 'START', 'P1', 'e4', true), move('m2', 'P1', 'P2', 'e5', false)]
		};
		for (const [name, moves] of Object.entries(cases)) {
			const keys = enumerateVariations(moves).map((v) => v.variationKey);
			expect(new Set(keys).size, `duplicate variationKey in the "${name}" case`).toBe(keys.length);
		}
	});

	it('orders variations deterministically: by first chapter of appearance, untagged last', () => {
		const moves = [
			// 'Second' appears on an earlier move row than 'First' does, so the
			// chapter order follows the MOVES' first-appearance order, not the
			// alphabet — and stays identical across repeated runs.
			move('s1', 'START_S', 'PS1', 'c4', true, ['Second']),
			move('f1', 'START_F', 'PF1', 'e4', true, ['First']),
			move('u1', 'START_U', 'PU1', 'd4', true)
		];
		const run = () => enumerateVariations(moves).map((v) => v.leafMoveId);
		expect(run()).toEqual(['s1', 'f1', 'u1']);
		expect(run()).toEqual(run());
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

describe('variationScopes', () => {
	it('lists chapters in first-appearance order across moves', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true, ['Second', 'First']), move('m2', 'P1', 'P2', 'e5', false, ['First'])];
		expect(variationScopes(moves)).toEqual(['Second', 'First']);
	});

	it('walks the untagged scope alongside the chapters when SOME moves are untagged', () => {
		// The bug-4 rule: not "only when nothing is tagged".
		const moves = [move('m1', 'START', 'P1', 'e4', true, ['A']), move('m2', 'START_U', 'PU', 'd4', true)];
		expect(variationScopes(moves)).toEqual(['A', null]);
	});

	it('walks only the untagged scope when nothing is tagged at all', () => {
		expect(variationScopes([move('m1', 'START', 'P1', 'e4', true)])).toEqual([null]);
		expect(variationScopes([])).toEqual([null]);
	});

	it('omits the untagged scope when every move is tagged', () => {
		expect(variationScopes([move('m1', 'START', 'P1', 'e4', true, ['A'])])).toEqual(['A']);
	});
});

describe('hasChapterTags', () => {
	it('returns false when no variation carries any chapter name', () => {
		const moves = [move('m1', 'START', 'P1', 'e4', true)];
		expect(hasChapterTags(enumerateVariations(moves))).toBe(false);
	});

	it('returns true when at least one variation carries a chapter name', () => {
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

describe('chapterTiers / rowsInChapterTier', () => {
	function tierRow(id: string, chapterNames: string[]) {
		return { id, chapterNames };
	}

	it('returns null when no row carries a chapter, so the caller skips the chapter tier', () => {
		expect(chapterTiers([tierRow('a', []), tierRow('b', [])])).toBeNull();
	});

	it('returns an empty-list tier of null for no rows at all', () => {
		expect(chapterTiers([])).toBeNull();
	});

	it('dedupes chapters across rows, preserving first-appearance order', () => {
		const rows = [tierRow('a', ['Sicilian', 'Najdorf']), tierRow('b', ['Najdorf']), tierRow('c', ['Caro-Kann'])];
		expect(chapterTiers(rows)).toEqual(['Sicilian', 'Najdorf', 'Caro-Kann']);
	});

	it('appends the untagged bucket LAST in a mixed set, and only when some row is untagged', () => {
		expect(chapterTiers([tierRow('a', ['Sicilian']), tierRow('b', [])])).toEqual(['Sicilian', UNTAGGED_CHAPTER]);
		expect(chapterTiers([tierRow('a', ['Sicilian'])])).toEqual(['Sicilian']);
	});

	it('matches rows by chapter MEMBERSHIP, so a line shared by two chapters shows under both', () => {
		const shared = tierRow('shared', ['A', 'B']);
		const aOnly = tierRow('aOnly', ['A']);
		expect(rowsInChapterTier([shared, aOnly], 'A')).toEqual([shared, aOnly]);
		expect(rowsInChapterTier([shared, aOnly], 'B')).toEqual([shared]);
	});

	it('collects exactly the untagged rows into the untagged bucket', () => {
		const untagged = tierRow('untagged', []);
		expect(rowsInChapterTier([tierRow('tagged', ['A']), untagged], UNTAGGED_CHAPTER)).toEqual([untagged]);
	});

	it('lists a chapter genuinely named like the untagged bucket only once, merging both into it', () => {
		// Vanishingly unlikely, but it must degrade into one bucket rather than
		// render the same tier twice (a duplicate keyed-each entry).
		const collide = tierRow('collide', [UNTAGGED_CHAPTER]);
		const untagged = tierRow('untagged', []);
		expect(chapterTiers([collide, untagged])).toEqual([UNTAGGED_CHAPTER]);
		expect(rowsInChapterTier([collide, untagged], UNTAGGED_CHAPTER)).toEqual([collide, untagged]);
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

describe('moveIdsInVariationKey', () => {
	it('splits a variationKey back into its constituent move ids, in order', () => {
		expect(moveIdsInVariationKey('m1>m2>m3')).toEqual(['m1', 'm2', 'm3']);
	});

	it('returns a single-element array for a one-move variation', () => {
		expect(moveIdsInVariationKey('m1')).toEqual(['m1']);
	});

	it('round-trips with how enumerateVariations builds a variationKey', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true)
		];
		const [variation] = enumerateVariations(moves);
		expect(moveIdsInVariationKey(variation.variationKey)).toEqual(['m1', 'm2', 'm3']);
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

describe('moveSequenceRows', () => {
	it('returns an empty array for an empty path', () => {
		expect(moveSequenceRows([])).toEqual([]);
	});

	it('pairs an even number of plies into full-move rows', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true),
			move('m4', 'P3', 'P4', 'Nc6', false)
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceRows(variation.path)).toEqual([
			{ number: 1, white: 'e4', black: 'e5' },
			{ number: 2, white: 'Nf3', black: 'Nc6' }
		]);
	});

	it('leaves a trailing row Black-empty for an odd number of plies', () => {
		const moves = [
			move('m1', 'START', 'P1', 'e4', true),
			move('m2', 'P1', 'P2', 'e5', false),
			move('m3', 'P2', 'P3', 'Nf3', true)
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceRows(variation.path)).toEqual([
			{ number: 1, white: 'e4', black: 'e5' },
			{ number: 2, white: 'Nf3', black: null }
		]);
	});

	it('starts from a custom mid-game FEN where Black is to move first', () => {
		const moves: RawMoveRow[] = [
			{ id: 'm1', fromPositionId: 'START', toPositionId: 'P1', fromFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 5', toFen: 'x', san: 'Nf6', isPlayerTurn: true, chapterNames: [] },
			{ id: 'm2', fromPositionId: 'P1', toPositionId: 'P2', fromFen: 'x', toFen: 'y', san: 'Bc4', isPlayerTurn: false, chapterNames: [] }
		];
		const [variation] = enumerateVariations(moves);
		expect(moveSequenceRows(variation.path)).toEqual([
			{ number: 5, white: '', black: 'Nf6' },
			{ number: 6, white: 'Bc4', black: null }
		]);
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
