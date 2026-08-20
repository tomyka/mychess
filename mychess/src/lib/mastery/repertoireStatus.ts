// mychess/src/lib/mastery/repertoireStatus.ts
//
// A repertoire's status, DERIVED — never stored as a mutable flag.
// Story #99 of epic #95.
//
// Deriving it is what makes the growth rule work by itself: a coach adding
// chapters changes the inputs, so the status recomputes downward on the next
// read. There is no invalidation job, no cron, and no flag that can drift out of
// step with the rows it claims to summarise.

import { chapterTiers, rowsInChapterTier, UNTAGGED_CHAPTER } from './variations';

export type RepertoireStatus = 'learning' | 'learned' | 'mastered';

/** The subset of a variation this module needs. */
type ScopedVariation = { variationKey: string; chapterNames: string[] };

/**
 * Whether a mastery record earned when the repertoire's moves last changed at
 * `recordMovesUpdatedAt` still describes the repertoire as it is now.
 *
 * `repertoires.moves_updated_at` is maintained by a database trigger on every
 * insert/update/delete against `moves` (migration 0055), so this is the one
 * signal application code cannot forget to update — which is exactly why it is
 * used here instead of hashing the variation-key set. A hash would be finer
 * grained (it could tell an untouched chapter from a changed one), but it puts a
 * second answer to "has this material changed?" in the codebase, and the rule
 * this epic actually asked for is repertoire-wide: new chapters revoke Mastered.
 *
 * A record stamped LATER than the repertoire is treated as current: that can
 * only come from clock skew, and revoking mastery nobody invalidated is the
 * worse failure.
 */
export function isMasteryCurrent(
	recordMovesUpdatedAt: string | null,
	repertoireMovesUpdatedAt: string | null
): boolean {
	if (!recordMovesUpdatedAt || !repertoireMovesUpdatedAt) return false;
	return new Date(recordMovesUpdatedAt).getTime() >= new Date(repertoireMovesUpdatedAt).getTime();
}

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
 * `mastered` once every chapter holds mastery that is still current.
 *
 * `variations` is the repertoire's scope as the caller sees it: excluded lines
 * are already filtered out upstream (`loadFilteredRepertoireVariations` /
 * `filterVariations`), so a line a coach excluded cannot hold a repertoire at
 * `learning` forever. `currentlyMasteredChapters` is likewise pre-filtered by
 * `isMasteryCurrent`, keeping the staleness comparison in one place.
 *
 * An empty repertoire is vacuously `learned`, matching the existing
 * `allSolved = solved === total` convention, but never `mastered` — there are no
 * chapters to master.
 */
export function deriveRepertoireStatus(args: {
	variations: readonly ScopedVariation[];
	learnedKeys: ReadonlySet<string>;
	currentlyMasteredChapters: ReadonlySet<string>;
}): RepertoireStatus {
	const { variations, learnedKeys, currentlyMasteredChapters } = args;

	if (variations.some((v) => !learnedKeys.has(v.variationKey))) return 'learning';

	const chapters = masterableChapters(variations);
	if (chapters.length === 0) return 'learned';
	return chapters.every((chapter) => currentlyMasteredChapters.has(chapter)) ? 'mastered' : 'learned';
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

/** Display label for a status, used by the repertoire cards. */
export const STATUS_LABEL: Record<RepertoireStatus, string> = {
	learning: 'Learning',
	learned: 'Learned',
	mastered: 'Mastered'
};
