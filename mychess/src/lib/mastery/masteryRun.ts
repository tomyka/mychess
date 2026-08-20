// mychess/src/lib/mastery/masteryRun.ts
//
// Chapter mastery runs (story #100 of epic #95): one continuous, hint-free,
// mistake-free pass through a chapter's learned variations.
//
// Chapter-level rather than whole-repertoire was a deliberate scoping choice —
// a single run through a 165-variation repertoire would take over an hour, and
// almost nobody would ever finish one.

import { chapterTiers, isInChapterTier } from './variations';
import { isMasteryCurrent, masterableChapters } from './repertoireStatus';

type ScopedVariation = { variationKey: string; chapterNames: string[] };

/** A stored `chapter_mastery` row, reduced to what currency needs. */
export type MasteryRecord = { chapterName: string; movesUpdatedAt: string | null };

export type ChapterMasteryRow = {
	chapter: string;
	/** Variations in this chapter (after exclusions, which the loader applies). */
	total: number;
	learned: number;
	/**
	 * Whether a run can be started. A run drills learned variations, so a chapter
	 * with anything still un-learned can't be attempted — the exam must not quiz
	 * material Learn hasn't finished teaching.
	 */
	canRun: boolean;
	mastered: boolean;
};

/**
 * Chapter membership for mastery purposes.
 *
 * When NO variation carries a chapter tag, `chapterTiers` returns null and the
 * repertoire is treated as one implicit chapter — so every variation belongs to
 * it. Otherwise membership is the same `isInChapterTier` rule the practice
 * picker uses, which means a line cross-referenced by two chapters counts in
 * both and mastering one doesn't quietly master the other.
 */
function membership(variations: readonly ScopedVariation[]) {
	const untaggedOnly = chapterTiers([...variations]) === null;
	return (v: ScopedVariation, chapter: string) => (untaggedOnly ? true : isInChapterTier(v, chapter));
}

/**
 * Per-chapter state for the mastery screen: how much is learned, whether a run
 * can start, and whether mastery is currently held.
 */
export function chapterMasteryView(args: {
	variations: readonly ScopedVariation[];
	learnedKeys: ReadonlySet<string>;
	masteryRecords: readonly MasteryRecord[];
	repertoireMovesUpdatedAt: string | null;
}): ChapterMasteryRow[] {
	const { variations, learnedKeys, masteryRecords, repertoireMovesUpdatedAt } = args;
	if (variations.length === 0) return [];

	const currentByChapter = new Map<string, boolean>();
	for (const record of masteryRecords) {
		currentByChapter.set(record.chapterName, isMasteryCurrent(record.movesUpdatedAt, repertoireMovesUpdatedAt));
	}

	const belongs = membership(variations);

	return masterableChapters(variations).map((chapter) => {
		const inChapter = variations.filter((v) => belongs(v, chapter));
		const learned = inChapter.filter((v) => learnedKeys.has(v.variationKey)).length;
		return {
			chapter,
			total: inChapter.length,
			learned,
			canRun: inChapter.length > 0 && learned === inChapter.length,
			mastered: currentByChapter.get(chapter) === true
		};
	});
}

/**
 * The variations one run serves, in repertoire order.
 *
 * Order is deliberately NOT weakest-first like the Practice pool: a run is an
 * exam over a whole chapter, and a stable, predictable order makes a restart
 * after a failure feel like the same exam rather than a new one.
 */
export function masteryRunQueue<T extends ScopedVariation>(
	variations: readonly T[],
	chapter: string,
	learnedKeys: ReadonlySet<string>
): T[] {
	const belongs = membership(variations);
	return variations.filter((v) => learnedKeys.has(v.variationKey) && belongs(v, chapter));
}
