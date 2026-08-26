// mychess/src/lib/mastery/repertoireStatus.ts
//
// A repertoire's status, DERIVED — never stored as a mutable flag.
// Story #99 of epic #95; `mastered` redefined per the knowledge-levels
// feature (see docs/superpowers/specs/2026-08-26-repertoire-knowledge-levels-design.md).
//
// Deriving it is what makes the growth rule work by itself: a coach adding
// chapters, or a variation crossing a tier boundary, changes the inputs, so
// the status recomputes downward on the next read. There is no invalidation
// job, no cron, and no flag that can drift out of step with the rows it
// claims to summarise.

import { chapterTiers, rowsInChapterTier, UNTAGGED_CHAPTER } from './variations';

export type RepertoireStatus = 'learning' | 'learned' | 'mastered';

/** The subset of a variation this module needs. */
type ScopedVariation = { variationKey: string; chapterNames: string[] };

/**
 * Every chapter that has to be mastered before the repertoire is.
 *
 * A repertoire with no chapter tags at all still gets one implicit chapter (the
 * untagged bucket) rather than none — otherwise "every chapter is mastered"
 * would be vacuously true and such a repertoire could reach Mastered without a
 * single run.
 */
export function masterableChapters(variations: readonly ScopedVariation[]): string[] {
	if (variations.length === 0) return [];
	return chapterTiers([...variations]) ?? [UNTAGGED_CHAPTER];
}

/**
 * `learning` while anything is un-learned → `learned` once everything is →
 * `mastered` once every chapter has reached its own ceiling on the
 * knowledge-level ladder (see `isChapterComplete` in
 * `$lib/mastery/chapterLevels`) — not necessarily literally Platinum, since a
 * short chapter can never structurally reach Platinum by design.
 *
 * `variations` is the repertoire's scope as the caller sees it: excluded lines
 * are already filtered out upstream (`loadFilteredRepertoireVariations` /
 * `filterVariations`), so a line a coach excluded cannot hold a repertoire at
 * `learning` forever. `completedChapters` is the set of chapter names for
 * which `isChapterComplete` is currently `true` — computed by the caller (who
 * needs the full, UNFILTERED `playerMoveCount`-bearing variation set to do
 * so, which this module intentionally does not depend on).
 *
 * An empty repertoire is vacuously `learned`, matching the existing
 * `allSolved = solved === total` convention, but never `mastered` — there are no
 * chapters to master.
 */
export function deriveRepertoireStatus(args: {
	variations: readonly ScopedVariation[];
	learnedKeys: ReadonlySet<string>;
	completedChapters: ReadonlySet<string>;
}): RepertoireStatus {
	const { variations, learnedKeys, completedChapters } = args;

	if (variations.some((v) => !learnedKeys.has(v.variationKey))) return 'learning';

	const chapters = masterableChapters(variations);
	if (chapters.length === 0) return 'learned';
	return chapters.every((chapter) => completedChapters.has(chapter)) ? 'mastered' : 'learned';
}

/**
 * Every chapter tier (see `masterableChapters`) all of whose variations are
 * learned.
 *
 * This is Practice's own visibility rule, distinct from #99's mastery status
 * above: a chapter becomes practiceable once every one of its lines has
 * graduated out of Learn, full stop — no mastery run required. A lone
 * learned line sitting inside an otherwise-unfinished chapter doesn't count;
 * the player finishes what they started in Learn before Practice starts
 * drilling any of it.
 */
export function fullyLearnedChapters(
	variations: readonly ScopedVariation[],
	learnedKeys: ReadonlySet<string>
): Set<string> {
	const fully = new Set<string>();
	for (const chapter of masterableChapters(variations)) {
		const rows = rowsInChapterTier([...variations], chapter);
		if (rows.length > 0 && rows.every((v) => learnedKeys.has(v.variationKey))) fully.add(chapter);
	}
	return fully;
}

/**
 * The repertoire list's cheap approximation of `deriveRepertoireStatus`,
 * using cached counts (`repertoires.chapter_count`, this player's current
 * `chapter_mastery` row count) instead of a full variation enumeration —
 * the list loads far more often than a repertoire's own detail page, so it
 * can't afford `deriveRepertoireStatus`'s move fetch on every load.
 *
 * `chapterCount` null means the cache hasn't been backfilled for this
 * repertoire yet (see `loadRepertoireProgressSummaries`); that repertoire
 * simply can't read as `mastered` until it has, the same way an unset
 * `total_variations` falls back through that same lazy backfill elsewhere.
 */
export function deriveRepertoireStatusFromCounts(args: {
	allLearned: boolean;
	chapterCount: number | null;
	currentlyMasteredChapterCount: number;
}): RepertoireStatus {
	const { allLearned, chapterCount, currentlyMasteredChapterCount } = args;
	if (!allLearned) return 'learning';
	if (!chapterCount) return 'learned';
	return currentlyMasteredChapterCount >= chapterCount ? 'mastered' : 'learned';
}

/** Display label for a status, used by the repertoire cards. */
export const STATUS_LABEL: Record<RepertoireStatus, string> = {
	learning: 'Learning',
	learned: 'Learned',
	mastered: 'Mastered'
};
