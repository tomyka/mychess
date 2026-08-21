/**
 * Pure carry-forward arithmetic for a repertoire whose shape a coach changed.
 *
 * Reconciliation is LAZY — it runs on the student's next load, after the new
 * moves are already written — so it never sees the coach's diff. The caller
 * reconstructs the mapping from the repertoire's live shape versus this
 * student's own stale progress keys and hands it over as `CarryForward[]` plus
 * `SeedNew[]`. That is why this module defines its own input types rather than
 * consuming `VariationDiff` from `./repertoire-diff`.
 *
 * The rule: depth is kept, the learned badge is not. Progress stores ply
 * DEPTHS, so a line whose end moved keeps every ply the student already had.
 * But `learned` means "replayed this whole line cleanly twice", and a line
 * whose length changed is no longer that line.
 */

/** One existing line, mapped to what it became. `toKey` is null only for `removed`. */
export type CarryForward = {
	kind: 'unchanged' | 'extended' | 'truncated' | 'diverged' | 'removed';
	fromKey: string;
	toKey: string | null;
	/** Plies the old and new versions share. 0 for `removed`. */
	commonPlies: number;
};

/** A line that did not exist before, with the depth it inherits from a known prefix. */
export type SeedNew = {
	toKey: string;
	inheritedPlies: number;
};

export type TeachingRow = {
	variationKey: string;
	taughtPlies: number;
	masteredPlies: number;
	cleanPassCount: number;
};

export type PlayerProgress = {
	teaching: TeachingRow[];
	/** Variation keys with a `variation_solved` row — i.e. learned. */
	solved: string[];
	/** Variation keys with a `variation_practice_exclusions` row. */
	excluded: string[];
	activeVariationKey: string | null;
};

export type ReconciliationPlan = {
	teachingUpdates: Array<{
		fromKey: string;
		toKey: string;
		taughtPlies: number;
		masteredPlies: number;
		cleanPassCount: number;
	}>;
	teachingInserts: Array<{ variationKey: string; taughtPlies: number; masteredPlies: number }>;
	/** Learned status carried onto the new key, unchanged. */
	solvedMoves: Array<{ fromKey: string; toKey: string }>;
	solvedDeletes: string[];
	demotions: Array<{ variationKey: string; cause: 'coach_update' }>;
	exclusionMoves: Array<{ fromKey: string; toKey: string }>;
	clearActiveVariation: boolean;
};

/**
 * The kinds where `learned` survives: the new line sits entirely inside what
 * the student had already learned. Exported so the coach-facing projection
 * counts demotions by the same rule this applies — the number shown before the
 * apply and the change made after it cannot drift apart.
 */
export const KEEPS_LEARNED: ReadonlySet<CarryForward['kind']> = new Set(['unchanged', 'truncated']);

export function planReconciliation(
	carries: CarryForward[],
	seeds: SeedNew[],
	progress: PlayerProgress
): ReconciliationPlan {
	const plan: ReconciliationPlan = {
		teachingUpdates: [],
		teachingInserts: [],
		solvedMoves: [],
		solvedDeletes: [],
		demotions: [],
		exclusionMoves: [],
		clearActiveVariation: false
	};

	const teachingByKey = new Map(progress.teaching.map((t) => [t.variationKey, t]));
	const solved = new Set(progress.solved);
	const excluded = new Set(progress.excluded);

	for (const c of carries) {
		if (c.kind === 'removed') {
			// Rows are deliberately KEPT — the line's moves are retired, not
			// deleted, so restoring the line later restores its progress too.
			// Only the pointer at it has to go.
			if (progress.activeVariationKey === c.fromKey) plan.clearActiveVariation = true;
			continue;
		}

		// An unchanged line keeps its key, so there is nothing to rewrite. Not
		// merely an optimisation: emitting a no-op update here would touch every
		// row in the repertoire on every reconcile.
		if (c.kind === 'unchanged' || c.toKey === null || c.toKey === c.fromKey) continue;

		const toKey = c.toKey;
		const keepsLearned = KEEPS_LEARNED.has(c.kind);

		const row = teachingByKey.get(c.fromKey);
		if (row) {
			plan.teachingUpdates.push({
				fromKey: c.fromKey,
				toKey,
				// Math.min in both directions: a truncated line clamps DOWN to the
				// shorter length, and an extended line's depth is already at or
				// below the common prefix so the min leaves it alone. One
				// expression covers both, and neither can ever RAISE a depth.
				taughtPlies: Math.min(row.taughtPlies, c.commonPlies),
				masteredPlies: Math.min(row.masteredPlies, c.commonPlies),
				// A clean-pass streak is over the line's FINAL batch. A line whose
				// end moved has no surviving streak, so it restarts — while the
				// depth above is kept.
				cleanPassCount: keepsLearned ? row.cleanPassCount : 0
			});
		}

		if (solved.has(c.fromKey)) {
			if (keepsLearned) {
				plan.solvedMoves.push({ fromKey: c.fromKey, toKey });
			} else {
				plan.solvedDeletes.push(c.fromKey);
				plan.demotions.push({ variationKey: toKey, cause: 'coach_update' });
			}
		}

		if (excluded.has(c.fromKey)) {
			plan.exclusionMoves.push({ fromKey: c.fromKey, toKey });
		}
	}

	for (const seed of seeds) {
		// Nothing to inherit, or the student has already practised this line —
		// seeding over real progress would reset them, and reconciliation can run
		// more than once.
		if (seed.inheritedPlies <= 0) continue;
		if (teachingByKey.has(seed.toKey)) continue;
		plan.teachingInserts.push({
			variationKey: seed.toKey,
			taughtPlies: seed.inheritedPlies,
			masteredPlies: seed.inheritedPlies
		});
	}

	return plan;
}
