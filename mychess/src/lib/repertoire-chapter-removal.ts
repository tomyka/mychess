// mychess/src/lib/repertoire-chapter-removal.ts
//
// What removing one or more chapters does to a repertoire (GitHub issue #184).
// Pure — no Supabase. The route that applies this lives at
// `(coach)/coach/repertoires/[repertoire_id]/chapters/+page.server.ts`, and the
// atomic write itself is `apply_repertoire_update`'s job (migration 0074).

import {
	UNTAGGED_CHAPTER,
	chapterTiers,
	enumerateVariations,
	hasChapterTags,
	rowsInChapterTier,
	type RawMoveRow,
	type Variation
} from '$lib/mastery/variations';
// Reused deliberately, not incidentally: `masterableChapters` owns the rule
// that an untagged repertoire still counts as ONE chapter (the implicit
// UNTAGGED_CHAPTER bucket), and `repertoires.chapter_count` is defined as
// `masterableChapters(variations).length` — see migration 0069's own comment.
// Computing chapter_count any other way here would let a removal write a
// count that disagrees with what every other reader of that column expects.
import { masterableChapters } from '$lib/mastery/repertoireStatus';

/** One chapter, as the manager page needs to describe it before a removal. */
export type ChapterImpact = {
	name: string;
	/** Lines belonging to this chapter, shared ones included. */
	lineCount: number;
	/**
	 * How many of those lines ANOTHER chapter also claims. Those lines survive
	 * this chapter's removal — the count exists so the confirm dialog can say
	 * so instead of overstating what is about to disappear.
	 */
	sharedLineCount: number;
	/**
	 * The keys of the lines only this chapter claims — the ones that genuinely
	 * go away. Used to count how many carry student progress.
	 */
	exclusiveVariationKeys: string[];
};

/**
 * Per-chapter impact for every tier of a repertoire, in `chapterTiers`' order
 * (first appearance, untagged bucket last). Empty for a repertoire with no
 * chapter tags anywhere — there is nothing to remove chapter-wise, and the
 * caller renders the repertoire as one indivisible unit.
 */
export function summarizeChapters(variations: Variation[]): ChapterImpact[] {
	const tiers = chapterTiers(variations);
	if (tiers === null) return [];

	return tiers.map((name) => {
		const rows = rowsInChapterTier(variations, name);
		// The untagged bucket's rows belong to no chapter by definition, so
		// they can never be shared — `chapterNames.length === 1` would read
		// false for every one of them.
		const exclusive =
			name === UNTAGGED_CHAPTER ? rows : rows.filter((row) => row.chapterNames.length === 1);
		return {
			name,
			lineCount: rows.length,
			sharedLineCount: rows.length - exclusive.length,
			exclusiveVariationKeys: exclusive.map((row) => row.variationKey)
		};
	});
}

export type ChapterRemovalPlan = {
	/** `p_retire_move_ids` for `apply_repertoire_update`. */
	retireMoveIds: string[];
	totalVariations: number;
	hasChapters: boolean;
	chapterCount: number;
};

/**
 * Which moves a chapter removal retires, and the repertoire's shape once it
 * has happened.
 *
 * A move is retired IFF **every** chapter it belongs to is being removed. A
 * move that keeps at least one chapter is kept and merely loses the removed
 * names — this is the same intersection-not-union subtlety the per-chapter
 * exclusions work had to get right (see
 * `docs/superpowers/specs/2026-08-19-per-chapter-practice-exclusions-design.md`),
 * and getting it backwards here would silently retire prefix edges a surviving
 * chapter still needs to walk its own paths. On a transposition-heavy
 * repertoire that is most of the file.
 *
 * An untagged move belongs to the implicit `UNTAGGED_CHAPTER` bucket, so it is
 * removable by that sentinel name and by nothing else. A move that survives
 * keeps its `chapterNames` empty rather than gaining the sentinel — the
 * sentinel is a UI tier, never a stored value.
 *
 * The three shape values are recomputed by re-enumerating the surviving move
 * set, so they account for lines that lose their only path as a side effect of
 * a retire rather than by being tagged themselves.
 *
 * Removing every chapter is representable (`totalVariations: 0`) but is
 * refused by the caller — an empty repertoire is a repertoire delete, not a
 * chapter removal.
 */
export function planChapterRemoval(
	moves: RawMoveRow[],
	namesToRemove: readonly string[]
): ChapterRemovalPlan {
	const removing = new Set(namesToRemove);
	const retireMoveIds: string[] = [];
	const survivors: RawMoveRow[] = [];

	for (const move of moves) {
		const names = move.chapterNames ?? [];
		const untagged = names.length === 0;
		const own = untagged ? [UNTAGGED_CHAPTER] : names;
		const kept = own.filter((name) => !removing.has(name));

		if (kept.length === 0) {
			retireMoveIds.push(move.id);
			continue;
		}
		survivors.push({ ...move, chapterNames: untagged ? [] : kept });
	}

	const variations = enumerateVariations(survivors);
	return {
		retireMoveIds,
		totalVariations: variations.length,
		hasChapters: hasChapterTags(variations),
		chapterCount: masterableChapters(variations).length
	};
}

/**
 * The keys of every line that genuinely disappears when `namesToRemove` go —
 * the union of those chapters' exclusive lines, minus any line another chapter
 * in the removal set does not also claim exclusively. Used for the confirm
 * dialog's aggregate counts, so a bulk removal reports one honest total rather
 * than the sum of per-chapter numbers (which double-counts a line two removed
 * chapters share).
 */
export function removedVariationKeys(
	variations: Variation[],
	namesToRemove: readonly string[]
): string[] {
	const removing = new Set(namesToRemove);
	return variations
		.filter((variation) => {
			const own = variation.chapterNames.length === 0 ? [UNTAGGED_CHAPTER] : variation.chapterNames;
			return own.every((name) => removing.has(name));
		})
		.map((variation) => variation.variationKey);
}

/**
 * Whether `namesToRemove` covers every tier the repertoire has — the caller
 * refuses such a removal, because emptying a repertoire is a repertoire
 * delete, not a chapter removal.
 */
export function removesEveryChapter(
	variations: Variation[],
	namesToRemove: readonly string[]
): boolean {
	const tiers = chapterTiers(variations);
	// No tiers at all — an entirely untagged repertoire — vacuously "removes
	// everything", so the caller refuses. That is the safe default rather than
	// an oversight: there is no chapter here to remove in the first place, and
	// `summarizeChapters` returns nothing for this repertoire either, so the
	// UI never offers a selectable row. A forged request therefore fails
	// closed instead of committing a write that looks like a no-op.
	if (tiers === null) return true;
	const removing = new Set(namesToRemove);
	return tiers.every((tier) => removing.has(tier));
}

/**
 * Re-declared rather than `export { UNTAGGED_CHAPTER } from …` so the route
 * and the page need one import for everything chapter-removal-shaped. Matches
 * how `RepertoireDiffReview.svelte` re-declares its own re-exports.
 */
export { UNTAGGED_CHAPTER };
