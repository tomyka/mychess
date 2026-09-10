/**
 * Pure carry-forward arithmetic for a repertoire whose shape a coach changed.
 *
 * Reconciliation is LAZY — it runs on the student's next load, after the new
 * moves are already written — so it never sees what the coach changed. The caller
 * reconstructs the mapping from the repertoire's live shape versus this
 * student's own stale progress keys and hands it over as `CarryForward[]` plus
 * `SeedNew[]`, which is why this module defines its own input types.
 *
 * The rule: depth is kept, the learned badge is not. Progress stores ply
 * DEPTHS, so a line whose end moved keeps every ply the student already had.
 * But `learned` means "replayed this whole line cleanly twice", and a line
 * whose length changed is no longer that line.
 *
 * `planReconciliation` still handles the full set of `CarryForward` kinds, but
 * since #215 `buildCarryForwardPlan` only ever emits `truncated` and `removed`
 * — retiring moves is the only reshape the product can perform, and it can
 * only shorten a line or delete it. The planner is left general because it is
 * the tested arithmetic, not the policy; the policy is in the builder.
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
 * the student had already learned.
 *
 * Was `ReadonlySet<string>` while a second, wider set of classification kinds
 * also read it; #211 removed that caller, so it is narrowed to the one
 * vocabulary left.
 */
const KEEPS_LEARNED: ReadonlySet<CarryForward['kind']> = new Set(['unchanged', 'truncated']);

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

	// Several old lines can land on the SAME new one: a coach deletes 3.Bb5 and
	// 3.Bc4 and adds 3.d4, and both old lines best-match the new line at four
	// plies. So carries are grouped by destination and resolved per GROUP, never
	// per carry. `variation_teaching` and `variation_solved` are both
	// unique(player_id, variation_key), so a second write to the same key fails;
	// the caller treats a failed write as fatal and returns WITHOUT stamping
	// reconciliation as done, which makes it run again on every subsequent page
	// load, forever. One emitted write per key is therefore not tidiness, it is
	// the correctness condition.
	const groups = new Map<string, CarryForward[]>();

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

		const group = groups.get(c.toKey);
		if (group) group.push(c);
		else groups.set(c.toKey, [c]);
	}

	for (const [toKey, group] of groups) {
		// The student ALREADY holds progress under `toKey` — it is a live line they
		// have been learning in its own right, and a different, now-removed line
		// merely happens to best-match it by shared prefix. Rekeying onto it would
		// be a second row at the same key, i.e. the same
		// unique(player_id, variation_key) violation the grouping above exists to
		// prevent, by a third route: the caller treats a failed write as fatal and
		// returns WITHOUT stamping reconciliation as done, so it retries on every
		// subsequent page load, forever.
		//
		// So the whole carry is a no-op. Not just to dodge the constraint: their
		// existing progress on that live line is DIRECT evidence about that line,
		// which is strictly better than progress carried over from a different line
		// that only shared a prefix. Overwriting the better record with the worse
		// one would be wrong even if the write succeeded.
		//
		// The stale rows are left where they are — harmless, since nothing reads a
		// key no live variation has, and consistent with the "retire, don't delete"
		// stance taken for a removed line above. Only a pointer AT a stale key has
		// to go, since that one is read.
		if (teachingByKey.has(toKey) || solved.has(toKey) || excluded.has(toKey)) {
			for (const c of group) {
				if (progress.activeVariationKey === c.fromKey) plan.clearActiveVariation = true;
			}
			continue;
		}

		// --- Teaching: the merged line inherits the DEEPEST of the collapsing
		// lines. The student genuinely knew that much of it, so keeping the best
		// is the honest merge; the losers' rows are simply left under their now
		// dead keys, which is harmless because nothing reads a key no live
		// variation has, and is the same "retire, don't delete" stance taken for
		// a removed line above.
		let best: ReconciliationPlan['teachingUpdates'][number] | null = null;
		for (const c of group) {
			const row = teachingByKey.get(c.fromKey);
			// A carry with no teaching row has nothing to contribute to the merge.
			if (!row) continue;
			const candidate = {
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
				cleanPassCount: KEEPS_LEARNED.has(c.kind) ? row.cleanPassCount : 0
			};
			// Compare the CLAMPED depths, not the raw row values: a deep row whose
			// carry only shares one ply is worth less to the merged line than a
			// shallower row that survives whole. Ties fall to the greater clamped
			// taughtPlies, then to input order, so the choice is deterministic.
			if (
				best === null ||
				candidate.masteredPlies > best.masteredPlies ||
				(candidate.masteredPlies === best.masteredPlies && candidate.taughtPlies > best.taughtPlies)
			) {
				best = candidate;
			}
		}
		if (best) plan.teachingUpdates.push(best);

		// --- Learned: if ANY of the collapsing lines both keeps learned and has a
		// solved row, the merged line stays learned — the student has replayed
		// something that contains it cleanly. Every other solved row in the group
		// is deleted rather than moved, so no second write hits `toKey`.
		const solvedInGroup = group.filter((c) => solved.has(c.fromKey));
		if (solvedInGroup.length > 0) {
			const keeper = solvedInGroup.find((c) => KEEPS_LEARNED.has(c.kind));
			if (keeper) {
				plan.solvedMoves.push({ fromKey: keeper.fromKey, toKey });
				for (const c of solvedInGroup) if (c !== keeper) plan.solvedDeletes.push(c.fromKey);
			} else {
				for (const c of solvedInGroup) plan.solvedDeletes.push(c.fromKey);
				// Exactly one demotion per merged line: the student lost the badge on
				// one line, not on however many lines happened to collapse into it.
				plan.demotions.push({ variationKey: toKey, cause: 'coach_update' });
			}
		}

		// --- Exclusions: one move, from the first excluded line in input order.
		// The rest are left where they are — `reverifyExclusions` prunes exclusion
		// rows with stale keys on its own, so the redundant ones self-clean.
		const firstExcluded = group.find((c) => excluded.has(c.fromKey));
		if (firstExcluded) plan.exclusionMoves.push({ fromKey: firstExcluded.fromKey, toKey });
	}

	// A seed targeting a key an update is already rekeying a row onto is the same
	// collision by another route, and the check below cannot see it: the student's
	// teaching rows are still under their STALE keys at this point.
	const updateTargets = new Set(plan.teachingUpdates.map((u) => u.toKey));
	const seeded = new Set<string>();

	for (const seed of seeds) {
		// Nothing to inherit, or the student has already practised this line —
		// seeding over real progress would reset them, and reconciliation can run
		// more than once.
		if (seed.inheritedPlies <= 0) continue;
		if (teachingByKey.has(seed.toKey)) continue;
		if (updateTargets.has(seed.toKey)) continue;
		if (seeded.has(seed.toKey)) continue;
		seeded.add(seed.toKey);
		plan.teachingInserts.push({
			variationKey: seed.toKey,
			taughtPlies: seed.inheritedPlies,
			masteredPlies: seed.inheritedPlies
		});
	}

	return plan;
}

/** Leading move ids two ply chains agree on — how much of the line still means the same thing. */
function sharedPrefixLength(a: readonly string[], b: readonly string[]): number {
	const limit = Math.min(a.length, b.length);
	let shared = 0;
	while (shared < limit && a[shared] === b[shared]) shared++;
	return shared;
}

/**
 * Rebuild the carry-forward mapping `planReconciliation` consumes from the only
 * two things lazy reconciliation can still observe: the repertoire's LIVE line
 * set, and this student's own progress keys.
 *
 * Reconstruction is possible at all because move ids survive a reshape. Moves
 * are upserted on `(repertoire_id, from_position, san)`, so a modified line's
 * unchanged head keeps its original ids — a stale key and the line it became
 * therefore share a real move-id prefix, and the length of that prefix is
 * exactly how many plies still mean the same thing. Guessing is not involved.
 *
 * A key that is still live gets no carry: it means that line did not change,
 * and `planReconciliation` writes nothing for `unchanged` anyway.
 *
 * Two stale keys legitimately matching the SAME live key is expected, not a bug
 * to break — a coach dropping 3.Bb5 and 3.Bc4 and adding 3.d4 produces exactly
 * that. Both carries are emitted; `planReconciliation` groups by destination and
 * merges the collapsing lines into one write per key.
 *
 * `inheritedPlies` is clamped by `masteredPlies`, not left at the raw shared
 * prefix. The prefix says how much of the new line is structurally identical to
 * a line the student holds; `masteredPlies` says how much of that line they
 * actually demonstrated. Seeding the raw prefix would credit a student with
 * knowledge they never showed — e.g. 11 shared plies on a line they had only
 * mastered 5 of.
 */
export function buildCarryForwardPlan(
	liveKeys: string[],
	progress: PlayerProgress
): { carries: CarryForward[]; seeds: SeedNew[] } {
	const liveSet = new Set(liveKeys);
	// Split once, in the caller's order: every match below iterates `liveKeys` as
	// given, so ties resolve to the earliest live key and the output is stable.
	const live = liveKeys.map((key) => ({ key, plies: key.split('>') }));

	// Insertion order teaching → solved → excluded → active, so the same student
	// state always yields the same carry order.
	const staleKeys = new Set<string>();
	const collectStale = (key: string | null) => {
		if (key !== null && !liveSet.has(key)) staleKeys.add(key);
	};
	for (const row of progress.teaching) collectStale(row.variationKey);
	for (const key of progress.solved) collectStale(key);
	for (const key of progress.excluded) collectStale(key);
	collectStale(progress.activeVariationKey);

	const carries: CarryForward[] = [];
	const carryTargets = new Set<string>();

	for (const fromKey of staleKeys) {
		const fromPlies = fromKey.split('>');

		// The ONLY live line that is this stale line is one that is a strict
		// PREFIX of it: the sole reshape the product can still perform is
		// retiring moves, which shortens a line from its end and never bends it
		// sideways or lengthens it.
		//
		// Matching on longest shared prefix instead — what this did until #215 —
		// is actively wrong here. Chapters share their opening moves (one move
		// row carries several `chapter_names`), so a line removed with its
		// chapter ALWAYS shares a prefix with lines in the chapters that
		// survived. The old rule therefore reached past the removal and handed
		// the student's progress to a line the coach never touched, either
		// carrying a learned badge onto a line they had never seen, or deleting
		// their `variation_solved` row and demoting them on it.
		//
		// A stale key with no live prefix is simply gone. `planReconciliation`
		// leaves its rows parked under the dead key rather than deleting them,
		// so restoring the line restores the progress with it.
		let toKey: string | null = null;
		let commonPlies = 0;
		for (const candidate of live) {
			if (candidate.plies.length >= fromPlies.length) continue;
			const shared = sharedPrefixLength(fromPlies, candidate.plies);
			// A prefix, and the longest one — the deepest surviving head of this
			// line is the one that still means the most.
			if (shared === candidate.plies.length && shared > commonPlies) {
				commonPlies = shared;
				toKey = candidate.key;
			}
		}

		if (toKey === null) {
			carries.push({ kind: 'removed', fromKey, toKey: null, commonPlies: 0 });
			continue;
		}

		carries.push({ kind: 'truncated', fromKey, toKey, commonPlies });
		carryTargets.add(toKey);
	}

	// Known lines include the STALE ones — inheriting from a line the coach just
	// reshaped is the common case, not the exception.
	const taughtKeys = new Set(progress.teaching.map((row) => row.variationKey));
	const known = progress.teaching.map((row) => ({
		plies: row.variationKey.split('>'),
		masteredPlies: row.masteredPlies
	}));

	const seeds: SeedNew[] = [];
	for (const candidate of live) {
		// Real progress already exists here, or a carry is about to move a row onto
		// this key — either way a seed would collide with it.
		if (taughtKeys.has(candidate.key)) continue;
		if (carryTargets.has(candidate.key)) continue;

		let inheritedPlies = 0;
		for (const row of known) {
			const inherited = Math.min(sharedPrefixLength(row.plies, candidate.plies), row.masteredPlies);
			if (inherited > inheritedPlies) inheritedPlies = inherited;
		}
		if (inheritedPlies > 0) seeds.push({ toKey: candidate.key, inheritedPlies });
	}

	return { carries, seeds };
}
