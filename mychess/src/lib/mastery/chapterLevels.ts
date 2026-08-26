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
