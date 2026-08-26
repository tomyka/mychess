//
// Repertoire knowledge levels: a per-chapter Bronze/Silver/Gold/Platinum
// ladder, tiered by `playerMoveCount` (from `enumerateVariations`) and gated
// on `variation_solved`. Retires the `chapter_mastery`/mastery-run mechanic —
// see docs/superpowers/specs/2026-08-26-repertoire-knowledge-levels-design.md.
//
// DERIVED, never stored — same convention as `repertoireStatus.ts`: a coach
// edit changes the inputs (`playerMoveCount`, the solved set) and the level
// recomputes on the next read, with no invalidation job and no staleness
// concept to track.

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

const TIER_ORDER: readonly Tier[] = ['bronze', 'silver', 'gold', 'platinum'];

/** Inclusive upper bound of each tier's `playerMoveCount` bracket. */
const TIER_MAX_PLAYER_MOVES: Record<Tier, number> = {
	bronze: 9,
	silver: 18,
	gold: 27,
	platinum: Infinity
};

const TIER_RANK: Record<Tier, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3 };

/** Which tier a variation belongs to, by its own move count alone. */
export function tierForMoveCount(playerMoveCount: number): Tier {
	for (const tier of TIER_ORDER) {
		if (playerMoveCount <= TIER_MAX_PLAYER_MOVES[tier]) return tier;
	}
	return 'platinum';
}

type ScopedVariation = { variationKey: string; playerMoveCount: number };

/**
 * A chapter's level: the highest tier T such that every variation in tiers
 * <= T (not just tier T alone) has a key in `solvedKeys`. Solving only a
 * chapter's silver-tier lines while a bronze-tier line is unsolved does not
 * grant silver — it's banked progress, credited the moment bronze finishes.
 *
 * An excluded variation is not special-cased here: it simply can never
 * appear in `solvedKeys` while excluded (it's out of the practice pool),
 * which is exactly what should block the ladder past its tier. If it was
 * solved before being excluded, its row persists and does not block —
 * also for free, since this function only ever looks at `solvedKeys`.
 *
 * That "for free" guarantee only holds if the excluded variation is still
 * present in `variationsInChapter` — its bracket has to exist and fail the
 * `every` check below. Every real caller MUST pass the unfiltered variation
 * set here (excluded variations included), never a pre-filtered one, or an
 * excluded-and-unsolved variation's bracket shrinks or vanishes instead of
 * blocking (see the exclusion-blocking amendment in the design doc — this
 * was a real bug, fixed by switching every call site to the unfiltered set).
 *
 * A tier bracket with no variations in it is vacuously cleared — it cannot
 * block a chapter that simply has nothing that deep (or that shallow).
 */
export function deriveChapterLevel(
	variationsInChapter: readonly ScopedVariation[],
	solvedKeys: ReadonlySet<string>
): Tier | null {
	let achieved: Tier | null = null;
	for (const tier of TIER_ORDER) {
		const bracket = variationsInChapter.filter((v) => tierForMoveCount(v.playerMoveCount) === tier);
		// An empty bracket must be skipped outright, not merely allowed to pass
		// the `every` check below. `[].every(...)` is vacuously `true`, so
		// without this `continue`, execution would fall through to
		// `achieved = tier` for an empty tier too — incorrectly crediting a
		// level nothing was solved at, and cascading through every subsequent
		// empty tier all the way to platinum even when only a lower, non-empty
		// tier was ever actually solved.
		if (bracket.length === 0) continue;
		if (!bracket.every((v) => solvedKeys.has(v.variationKey))) break; // A real, unsolved tier blocks further advancement.
		achieved = tier;
	}
	return achieved;
}

/**
 * The highest tier this chapter has ANY variation in — its own ceiling,
 * independent of what's solved. Null for an empty chapter.
 *
 * This is deliberately separate from `deriveChapterLevel`'s cumulative
 * ladder: a chapter capped at Silver (nothing past move 18) has a Silver
 * ceiling, and should be able to count as fully "complete" once it reaches
 * that ceiling — see `isChapterComplete` — without needing to reach Platinum,
 * which it structurally never can.
 */
export function chapterCeiling(variationsInChapter: readonly ScopedVariation[]): Tier | null {
	let ceiling: Tier | null = null;
	let ceilingRank = -1;
	for (const v of variationsInChapter) {
		const rank = TIER_RANK[tierForMoveCount(v.playerMoveCount)];
		if (rank > ceilingRank) {
			ceilingRank = rank;
			ceiling = tierForMoveCount(v.playerMoveCount);
		}
	}
	return ceiling;
}

/**
 * Whether a chapter has reached its own ceiling — the new "mastered"/
 * "completed" bar (replacing an earlier, unreachable-for-short-chapters
 * definition that required literally Platinum). `false` for an empty chapter
 * (a null ceiling can never be "reached").
 *
 * Because `deriveChapterLevel` only ever consults `solvedKeys`, an excluded
 * variation that was never solved blocks completion here exactly the way it
 * blocks the ladder itself — but ONLY if it is still present in
 * `variationsInChapter`. Callers MUST pass the unfiltered variation set
 * (including excluded variations) for this to hold; passing an
 * already-filtered set silently defeats the exclusion-blocks-advancement
 * requirement (see the exclusion-blocking amendment in the design doc).
 */
export function isChapterComplete(
	variationsInChapter: readonly ScopedVariation[],
	solvedKeys: ReadonlySet<string>
): boolean {
	const ceiling = chapterCeiling(variationsInChapter);
	if (ceiling === null) return false;
	return deriveChapterLevel(variationsInChapter, solvedKeys) === ceiling;
}

/** A repertoire's level: the minimum tier across its chapters (null counts as lowest). */
export function deriveRepertoireLevel(chapterLevels: Iterable<Tier | null>): Tier | null {
	let min: Tier | null = null;
	let minRank = Infinity;
	let any = false;
	for (const level of chapterLevels) {
		any = true;
		const rank = level === null ? -1 : TIER_RANK[level];
		if (rank < minRank) {
			minRank = rank;
			min = level;
		}
	}
	return any ? min : null;
}
