import { describe, it, expect } from 'vitest';
import {
	tierForMoveCount,
	deriveChapterLevel,
	deriveRepertoireLevel,
	chapterCeiling,
	isChapterComplete,
	teachingCeilingMoveCount,
	currentLevelProgress
} from './chapterLevels';
import { ceilingPlyFor } from './teaching';
import type { VariationStep } from './variations';

/**
 * A path of `playerMoveCount` player moves, alternating turns starting with
 * the player (ply 0), ending on the player's own move — mirrors
 * `teaching.test.ts`'s own `path` helper, since `hasReachedCeiling`'s
 * ceiling-ply math only cares about player-turn parity, not real chess
 * content.
 */
function pathOfMoves(variationKey: string, playerMoveCount: number): VariationStep[] {
	const plies = playerMoveCount * 2 - 1;
	const path: VariationStep[] = [];
	for (let i = 0; i < plies; i++) {
		path.push({ moveId: `${variationKey}-${i}`, san: `m${i}`, fromFen: 'x', toFen: 'y', isPlayerTurn: i % 2 === 0 });
	}
	return path;
}

const v = (variationKey: string, playerMoveCount: number) => ({
	variationKey,
	playerMoveCount,
	path: pathOfMoves(variationKey, playerMoveCount)
});

/**
 * The new equivalent of the old `new Set([...])` "solved keys" fixture: every
 * row not named in `solvedKeys` gets `masteredPlies: 0` (untouched); every
 * row named gets full credit (its own path length, i.e. genuinely solved).
 */
function masteredFrom(rows: ReturnType<typeof v>[], solvedKeys: string[]): Map<string, number> {
	const solved = new Set(solvedKeys);
	return new Map(rows.map((r) => [r.variationKey, solved.has(r.variationKey) ? r.path.length : 0]));
}

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
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['a']))).toBeNull();
	});

	it('reaches bronze once the bronze bracket is fully solved and there is nothing higher', () => {
		const rows = [v('a', 3), v('b', 5)];
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['a', 'b']))).toBe('bronze');
	});

	// The cumulative-ladder rule: solving only the silver-tier line while a
	// bronze-tier line in the same chapter is unsolved must NOT grant silver.
	it('does not grant silver while a lower, bronze-tier variation is unsolved', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 12)];
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['silverLine']))).toBeNull();
	});

	it('grants silver once both bronze- and silver-tier variations are solved', () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 12)];
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['bronzeLine', 'silverLine']))).toBe('silver');
	});

	// "Vacuous bracket" is retired as its own mechanism (GitHub issue #181) —
	// this now exercises the terminal ceiling clamp instead: without it, a
	// chapter whose tallest content is Silver-length would be reported as
	// Gold or Platinum too, since higher-tier checks are trivially satisfied
	// once nothing in the chapter extends that far.
	it("clamps to the chapter's own ceiling even once every check is otherwise trivially satisfied", () => {
		const rows = [v('bronzeLine', 5), v('silverLine', 15)]; // nothing gold or platinum
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['bronzeLine', 'silverLine']))).toBe('silver');
	});

	it('reaches platinum once every bracket that has content is fully solved', () => {
		const rows = [v('a', 5), v('b', 15), v('c', 22), v('d', 30)];
		expect(deriveChapterLevel(rows, masteredFrom(rows, ['a', 'b', 'c', 'd']))).toBe('platinum');
	});

	it('is null for a chapter with no variations at all', () => {
		expect(deriveChapterLevel([], new Map())).toBeNull();
	});

	// The deliberate, larger behavior change GitHub issue #181 introduces:
	// reaching a tier's cap is real progress now, so an untouched long
	// variation blocks even Bronze — not just its own, higher tier.
	it('blocks even bronze while a longer variation has not yet been taught up to the bronze ceiling, even though it is not in the bronze bracket', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length]
			// 'long' has no entry -> defaults to masteredPlies 0, untouched
		]);
		expect(deriveChapterLevel(rows, masteredPlies)).toBeNull();
	});

	it('grants bronze once a longer variation has at least REACHED the bronze ceiling, without needing to be fully solved', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const longRow = rows[2];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length],
			['long', ceilingPlyFor(longRow.path, 9)] // paused at the bronze ceiling, not solved
		]);
		expect(deriveChapterLevel(rows, masteredPlies)).toBe('bronze');
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
		expect(isChapterComplete(rows, masteredFrom(rows, ['a', 'b']))).toBe(true);
	});

	it('is not complete while any content at or below its own ceiling is unsolved', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(isChapterComplete(rows, masteredFrom(rows, ['a']))).toBe(false);
	});

	it('is not complete for an empty chapter', () => {
		expect(isChapterComplete([], new Map())).toBe(false);
	});

	// Regression test for the exclusion-blocking bug: an excluded, never-solved
	// variation must remain present in the array passed in here (never
	// pre-filtered out upstream) for this to hold — its masteredPlies staying
	// at 0 is what should keep the chapter below its own ceiling, with no
	// exclusion special-casing needed inside this function itself.
	it('is not complete when an excluded, never-solved variation is still present in the (unfiltered) array, even if everything else is solved', () => {
		const rows = [v('a', 5), v('excludedLine', 15)]; // ceiling: silver
		expect(isChapterComplete(rows, masteredFrom(rows, ['a']))).toBe(false);
	});
});

describe('teachingCeilingMoveCount', () => {
	it('is 9 (bronze) when nothing has been reached yet', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(teachingCeilingMoveCount(rows, masteredFrom(rows, []))).toBe(9);
	});

	it('is 9 while any <=9-move variation anywhere is unsolved, even if a longer one is solved', () => {
		const rows = [v('short', 5), v('long', 15)];
		expect(teachingCeilingMoveCount(rows, masteredFrom(rows, ['long']))).toBe(9);
	});

	it('rises to 18 once every <=9-move variation is solved AND every longer variation has at least reached the 9-move ceiling', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const longRow = rows[2];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length],
			['long', ceilingPlyFor(longRow.path, 9)] // reached, not solved
		]);
		expect(teachingCeilingMoveCount(rows, masteredPlies)).toBe(18);
	});

	it('stays at 9 while a longer variation has not yet been taught up to the bronze ceiling, even once every <=9-move variation is solved (GitHub issue #181 — the deliberate behavior change)', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length]
			// 'long' untouched
		]);
		expect(teachingCeilingMoveCount(rows, masteredPlies)).toBe(9);
	});

	it('rises to 27 once every <=18-move variation is solved and every longer variation has reached the 18-move ceiling', () => {
		const rows = [v('short', 5), v('mid', 15), v('gold', 22)];
		const goldRow = rows[2];
		const masteredPlies = new Map([
			['short', rows[0].path.length],
			['mid', rows[1].path.length],
			['gold', ceilingPlyFor(goldRow.path, 18)]
		]);
		expect(teachingCeilingMoveCount(rows, masteredPlies)).toBe(27);
	});

	it('is Infinity once every <=27-move variation is solved', () => {
		const rows = [v('a', 5), v('b', 27)];
		expect(teachingCeilingMoveCount(rows, masteredFrom(rows, ['a', 'b']))).toBe(Infinity);
	});

	// The deadlock case §3 of the tier-gated Learn design doc exists to rule
	// out: a repertoire (or pool) with NO bronze-length content at all must
	// not stay capped at 9 forever just because nothing can ever satisfy that
	// bracket.
	it('does not deadlock when nothing in the pool is bronze-length at all', () => {
		const rows = [v('a', 15), v('b', 15)];
		expect(teachingCeilingMoveCount(rows, masteredFrom(rows, ['a', 'b']))).toBe(27);
	});

	it('is 9 for an empty pool', () => {
		expect(teachingCeilingMoveCount([], new Map())).toBe(9);
	});
});

describe('currentLevelProgress', () => {
	it('is 0/total at bronze when nothing has been touched yet', () => {
		const rows = [v('a', 5), v('b', 15)];
		expect(currentLevelProgress(rows, new Map())).toEqual({ tier: 'bronze', ready: 0, total: 2 });
	});

	it('counts a variation as ready once it reaches the current ceiling, solved or merely paused', () => {
		// A third, untouched variation keeps bronze from fully clearing —
		// otherwise reaching 100% at a tier and moving the ceiling to the NEXT
		// tier happen in the exact same computation (see teachingCeilingMoveCount:
		// the moment a tier is fully achieved, it stops being "current" and the
		// next tier's cap is reported instead), so "ready === total" at a tier
		// that has actually cleared is a structural impossibility below platinum.
		const rows = [v('short', 5), v('long', 15), v('untouched', 9)];
		const masteredPlies = new Map([
			['short', rows[0].path.length], // solved
			['long', ceilingPlyFor(rows[1].path, 9)] // paused at the bronze ceiling
			// 'untouched' has no entry -> masteredPlies 0, keeps bronze from clearing
		]);
		expect(currentLevelProgress(rows, masteredPlies)).toEqual({ tier: 'bronze', ready: 2, total: 3 });
	});

	it('reflects the risen ceiling once bronze fully clears', () => {
		const rows = [v('short1', 5), v('short2', 9), v('long', 15)];
		const masteredPlies = new Map([
			['short1', rows[0].path.length],
			['short2', rows[1].path.length],
			['long', ceilingPlyFor(rows[2].path, 9)] // reached bronze -> ceiling rises to 18
		]);
		// At the NEW ceiling (18), 'long' (15 moves) has only reached its
		// bronze-cap ply so far, not the (later) silver-cap ply -> not ready yet.
		expect(currentLevelProgress(rows, masteredPlies)).toEqual({ tier: 'silver', ready: 2, total: 3 });
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
