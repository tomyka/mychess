// mychess/src/lib/mastery/exclusionFreshness.ts
//
// Decides whether a player's exclusion rows for one repertoire can be trusted
// as naming live variations — and therefore whether that repertoire's filtered
// variation total can be computed by subtraction instead of by fetching every
// move row and re-walking the variation tree. See migration 0055 for the
// schema side and GitHub issue #52 for the cost this exists to remove.

/** One `variation_practice_exclusions` row, reduced to what freshness needs. */
export type ExclusionRow = {
	variationKey: string;
	/** `verified_at` — when this row was last checked against the live shape ('epoch' if never). */
	verifiedAt: string;
};

type ExclusionShape = {
	/**
	 * The player's filtered variation count, or null when it can't be known
	 * without a live move fetch — the caller must then enumerate and filter,
	 * then re-verify the rows (see `staleExclusionKeys`).
	 */
	total: number | null;
	/**
	 * How many of this player's exclusions name a live variation. Only
	 * meaningful alongside a non-null `total`; the enumerating caller computes
	 * its own from the filtered result.
	 */
	excludedVariationCount: number;
};

/**
 * Whether every one of `rows` was verified against the repertoire's current
 * move set. A row verified at or after the last move change is known to name
 * a live variation; anything older predates a shape change that may have
 * invalidated its key.
 *
 * No rows at all is vacuously fresh — there is nothing to subtract, so the
 * unfiltered count already is the answer.
 */
export function exclusionsAreVerified(rows: ExclusionRow[], movesUpdatedAt: string | null): boolean {
	// A repertoire with no `moves_updated_at` can't establish freshness for
	// anything. Not reachable through the schema (the column is NOT NULL), but
	// it IS reachable through a select that forgets to ask for it, and treating
	// that as "everything is fresh" would silently subtract stale keys — so the
	// unknown case takes the slow, always-correct path.
	if (movesUpdatedAt == null) return rows.length === 0;
	const changedAt = new Date(movesUpdatedAt).getTime();
	return rows.every((row) => new Date(row.verifiedAt).getTime() >= changedAt);
}

/**
 * This repertoire's shape for one player, from cached values alone.
 *
 * `total` comes out null when the exclusions aren't verified — deliberately
 * not a best guess, since subtracting an unverified row set under-counts (a
 * stale key names a line that no longer exists, so it isn't excluding
 * anything) and the caller has a correct-but-expensive path available.
 *
 * The clamp on the subtraction guards the inverse mistake: `total_variations`
 * is itself a cache, and if it were ever behind the exclusion set, an
 * unclamped subtraction would produce a negative total and a nonsense
 * solved/total display. Verified rows make that unreachable in practice;
 * the clamp is there so a cache bug degrades to 0 rather than to garbage.
 */
export function exclusionShape(args: {
	fullVariationCount: number;
	rows: ExclusionRow[];
	movesUpdatedAt: string | null;
}): ExclusionShape {
	if (!exclusionsAreVerified(args.rows, args.movesUpdatedAt)) {
		return { total: null, excludedVariationCount: args.rows.length };
	}
	return {
		total: Math.max(0, args.fullVariationCount - args.rows.length),
		excludedVariationCount: args.rows.length
	};
}

/**
 * Splits rows into the ones to delete and the ones to stamp as verified, given
 * the repertoire's live variation keys. Called after the enumerating path has
 * done the work anyway, so the next load for this player can subtract instead:
 * stale rows are pruned outright (their line is gone — nothing to exclude) and
 * survivors are marked as checked against this shape.
 */
export function partitionByLiveness<T extends ExclusionRow>(
	rows: T[],
	liveKeys: ReadonlySet<string>
): { stale: T[]; live: T[] } {
	const stale: T[] = [];
	const live: T[] = [];
	for (const row of rows) (liveKeys.has(row.variationKey) ? live : stale).push(row);
	return { stale, live };
}
