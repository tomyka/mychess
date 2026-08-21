// mychess/src/lib/server/repertoire-reconcile.ts
//
// The Supabase I/O for LAZY reconciliation after a coach re-upload (GitHub
// issue #118): one student, one repertoire, caught up to the repertoire's
// current shape on their next load. It reads the live shape and this student's
// own progress, hands both to the pure planner in `$lib/repertoire-reconcile`,
// and writes back exactly what the plan says. Every decision — what carries,
// what is clamped, what loses its learned badge — lives in that pure module;
// per CLAUDE.md's pure-logic/I-O split this file stays a thin, deliberately
// boring wrapper and is not unit-tested directly.

import type { SupabaseClient } from '@supabase/supabase-js';
import { enumerateVariations } from '$lib/mastery/variations';
import { buildCarryForwardPlan, planReconciliation, type PlayerProgress } from '$lib/repertoire-reconcile';
import { fetchAllMoves, toRawMoveRows } from './practice-repertoire';
import { fetchAllPages, MAX_ROWS_PAGE_SIZE } from './paginate';
import { UPDATE_FLAG_STALE_MS } from './repertoire-update';

/**
 * The three timestamps that decide whether this student is behind the
 * repertoire's current shape. `moves_updated_at` and `update_in_progress_at`
 * come from `repertoires`; `reconciled_at` from this student's own
 * `repertoire_reconciliation` row, and is null when they have no row yet.
 */
export type ReconciliationFreshness = {
	moves_updated_at: string;
	update_in_progress_at: string | null;
	reconciled_at: string | null;
};

/**
 * Whether a repertoire's move set may currently be HALF-APPLIED, i.e. whether
 * a coach's apply is still in flight for it.
 *
 * The apply is NOT one transaction and cannot be: the move upsert chunks around
 * PostgREST's URL-length and `max_rows` limits, so it runs in its own
 * transaction BEFORE `apply_repertoire_update` — and migration 0055's trigger
 * bumps `moves_updated_at` at the START of that window, while the new moves are
 * already live but the pruned ones are not yet retired. Enumerating inside the
 * window therefore yields a shape that is neither the old one nor the new one,
 * and every reader that acts DESTRUCTIVELY on an enumerated shape has to
 * decline until it closes — reconciliation here, and the exclusion prune in
 * `./repertoire-progress.ts`, which DELETES rows whose key is absent from the
 * shape it sees and so would permanently discard a student's "skip this line"
 * choice on a line the finished shape still contains.
 *
 * "In flight" is `update_in_progress_at` set AND newer than
 * `UPDATE_FLAG_STALE_MS` ago. Both halves of that live HERE, in one place, and
 * `UPDATE_FLAG_STALE_MS` itself is imported from `./repertoire-update` rather
 * than re-declared, because two sides deciding "stale" differently is how a
 * repertoire wedges (or gets acted on mid-apply, which is worse). The flag is a
 * TIMESTAMP rather than a boolean precisely so a crashed apply goes stale and
 * lets the declining readers resume, instead of wedging the repertoire forever
 * behind a flag nobody will ever clear.
 *
 * Takes the raw column value, which is null when no apply has ever run. A
 * caller reading it off a select that FORGOT the column gets undefined, so
 * callers coalesce to null at the call site rather than widening the parameter
 * here — an absent column reading as "not in flight" is a select bug to fix,
 * not a case to normalise away.
 */
export function isApplyInFlight(updateInProgressAt: string | null): boolean {
	if (updateInProgressAt === null) return false;
	return Date.parse(updateInProgressAt) > Date.now() - UPDATE_FLAG_STALE_MS;
}

/**
 * Whether this student's progress has to be reconciled against the
 * repertoire's current shape before anything is read from it.
 *
 * Pure, so the caller can decide without a write and skip the whole path in
 * the overwhelmingly common case (nothing changed since their last load).
 *
 * Two conditions, and BOTH must hold.
 *
 * 1. The student is behind: `reconciled_at` is null (no row — nothing is
 *    assumed reconciled, see migration 0062) or strictly older than
 *    `moves_updated_at`. Equality means already caught up: the stamp is a copy
 *    of the exact `moves_updated_at` value it is compared against (see
 *    `reconcilePlayerProgress`), so `>=` is the freshness test and only `<`
 *    means work to do.
 *
 * 2. No apply is in flight — see `isApplyInFlight`, which owns that window so
 *    this function and the exclusion prune in `./repertoire-progress.ts` cannot
 *    drift apart on what "in flight" means. Reconciliation is destructive in a
 *    way that does not self-heal inside it: the counts would recover on the
 *    next reconcile, but a `variation_solved` row deleted on a phantom
 *    `diverged` classification does not come back, and the demotion log keeps
 *    a spurious `coach_update` row forever.
 */
export function needsReconciliation(repertoire: ReconciliationFreshness): boolean {
	if (isApplyInFlight(repertoire.update_in_progress_at)) return false;
	if (repertoire.reconciled_at === null) return true;
	return Date.parse(repertoire.reconciled_at) < Date.parse(repertoire.moves_updated_at);
}

/** Logs a failed write and reports it, so the caller can return without stamping. */
function writeFailed(label: string, error: { message: string } | null): boolean {
	if (!error) return false;
	console.error(`reconcilePlayerProgress: ${label} failed:`, error.message);
	return true;
}

/**
 * Catches one student's progress up to the repertoire's current shape, then
 * stamps `repertoire_reconciliation` so it does not run again until the shape
 * moves.
 *
 * MUST run BEFORE `reverifyExclusions` in `./repertoire-progress.ts`. That
 * function DELETES every exclusion row whose `variation_key` no longer names a
 * live variation — and a line the coach merely EXTENDED produces exactly such a
 * key, so running the prune first would silently discard the student's "skip
 * this line" choice on a line that still exists. Reconciliation rewrites the
 * key first; the prune then sees it as live and only genuinely-removed lines
 * are dropped. Stamping `verified_at` on the rewritten row here is what keeps
 * that same load from re-verifying it for nothing.
 *
 * Best-effort throughout: every write logs and returns early on error WITHOUT
 * stamping, so the next load retries from the top. That is safe because every
 * write is idempotent — a partial run repeated simply re-does what it already
 * did (a rekey whose target key the student already holds is a no-op in the
 * planner, an upsert conflicts onto the existing row, a demotion is an
 * append-only audit row). Only the caller's own rows are touched, so this needs
 * no privileges beyond the per-player RLS each table already has.
 */
export async function reconcilePlayerProgress(
	supabase: SupabaseClient,
	{ playerId, repertoireId, movesUpdatedAt }: { playerId: string; repertoireId: string; movesUpdatedAt: string }
): Promise<void> {
	// The three progress reads all PAGE: PostgREST caps an unbounded select at
	// `max_rows` (1000) and truncates SILENTLY, and a student working through a
	// large repertoire (1,000+ variations, which exists in production) holds more
	// than that on their own. Truncation here would read back as "this line has
	// no progress", so those lines would get no carry at all — their progress
	// would be stranded under a dead key rather than moved. Each count query
	// repeats its page query's filters exactly, since the pager derives its
	// remaining ranges from that count.
	let liveKeys: string[];
	let progress: PlayerProgress;
	try {
		const [rawMoves, teachingRows, solvedRows, exclusionRows, active] = await Promise.all([
			fetchAllMoves(supabase, repertoireId),
			fetchAllPages<{
				variation_key: string;
				taught_plies: number;
				mastered_plies: number;
				clean_pass_count: number;
			}>(
				() =>
					supabase
						.from('variation_teaching_progress')
						.select('variation_key, taught_plies, mastered_plies, clean_pass_count')
						.eq('player_id', playerId)
						.eq('repertoire_id', repertoireId)
						.order('variation_key', { ascending: true }),
				() =>
					supabase
						.from('variation_teaching_progress')
						.select('id', { count: 'exact', head: true })
						.eq('player_id', playerId)
						.eq('repertoire_id', repertoireId),
				MAX_ROWS_PAGE_SIZE
			),
			fetchAllPages<{ variation_key: string }>(
				() =>
					supabase
						.from('variation_solved')
						.select('variation_key')
						.eq('player_id', playerId)
						.eq('repertoire_id', repertoireId)
						.order('variation_key', { ascending: true }),
				() =>
					supabase
						.from('variation_solved')
						.select('id', { count: 'exact', head: true })
						.eq('player_id', playerId)
						.eq('repertoire_id', repertoireId),
				MAX_ROWS_PAGE_SIZE
			),
			fetchAllPages<{ variation_key: string }>(
				() =>
					supabase
						.from('variation_practice_exclusions')
						.select('variation_key')
						.eq('player_id', playerId)
						.eq('repertoire_id', repertoireId)
						.order('variation_key', { ascending: true }),
				() =>
					supabase
						.from('variation_practice_exclusions')
						.select('id', { count: 'exact', head: true })
						.eq('player_id', playerId)
						.eq('repertoire_id', repertoireId),
				MAX_ROWS_PAGE_SIZE
			),
			supabase
				.from('practice_active_variation')
				.select('active_variation_key')
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId)
				.maybeSingle()
		]);

		// `fetchAllMoves` already filters `retired_at is null`, so this is the
		// repertoire's LIVE shape — the only thing lazy reconciliation can still
		// observe of what the coach did.
		liveKeys = enumerateVariations(toRawMoveRows(rawMoves)).map((v) => v.variationKey);
		progress = {
			teaching: teachingRows.map((row) => ({
				variationKey: row.variation_key,
				taughtPlies: row.taught_plies,
				masteredPlies: row.mastered_plies,
				cleanPassCount: row.clean_pass_count
			})),
			solved: solvedRows.map((row) => row.variation_key),
			excluded: exclusionRows.map((row) => row.variation_key),
			activeVariationKey: active.data?.active_variation_key ?? null
		};
	} catch (err) {
		// Read failures must NOT be swallowed into empty arrays: an empty progress
		// set is indistinguishable from "this student has no progress", which the
		// planner would happily reconcile by writing nothing and stamping done.
		console.error('reconcilePlayerProgress: read failed:', err instanceof Error ? err.message : err);
		return;
	}

	const { carries, seeds } = buildCarryForwardPlan(liveKeys, progress);
	const plan = planReconciliation(carries, seeds, progress);

	// Teaching rows are REKEYED in place (update, not delete-and-insert), so the
	// row keeps its identity and anything hanging off it stays attached.
	for (const update of plan.teachingUpdates) {
		const payload: Record<string, unknown> = {
			variation_key: update.toKey,
			taught_plies: update.taughtPlies,
			mastered_plies: update.masteredPlies,
			clean_pass_count: update.cleanPassCount
		};
		// A restarted streak must not keep the old timestamp: `last_clean_pass_at`
		// is what the 20-hour gap rule measures from (migration 0057), so leaving
		// it would have the next clean pass measured against a pass that no longer
		// counts — and graduate the line off a single surviving pass.
		if (update.cleanPassCount === 0) payload.last_clean_pass_at = null;

		const { error } = await supabase
			.from('variation_teaching_progress')
			.update(payload)
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.eq('variation_key', update.fromKey);
		if (writeFailed(`teaching rekey ${update.fromKey} -> ${update.toKey}`, error)) return;
	}

	if (plan.teachingInserts.length > 0) {
		// `onConflict: 'player_id,variation_key_hash'` is the REAL unique
		// constraint: migration 0049 moved uniqueness onto a generated sha256
		// column because a deep line's raw key overflows Postgres's btree index
		// row-size limit. Passing the wrong conflict target (or none) resolves to
		// the primary key instead, which never conflicts on a generated uuid — so
		// a re-run would silently insert a DUPLICATE row instead of updating the
		// existing one. See CLAUDE.md's note on explicit `onConflict`.
		const { error } = await supabase.from('variation_teaching_progress').upsert(
			plan.teachingInserts.map((insert) => ({
				player_id: playerId,
				repertoire_id: repertoireId,
				variation_key: insert.variationKey,
				taught_plies: insert.taughtPlies,
				mastered_plies: insert.masteredPlies
			})),
			{ onConflict: 'player_id,variation_key_hash' }
		);
		if (writeFailed('teaching seed insert', error)) return;
	}

	// Learned markers: moves before deletes, so a key is vacated only after the
	// row that keeps the badge has already claimed its new one.
	for (const move of plan.solvedMoves) {
		const { error } = await supabase
			.from('variation_solved')
			.update({ variation_key: move.toKey })
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.eq('variation_key', move.fromKey);
		if (writeFailed(`solved rekey ${move.fromKey} -> ${move.toKey}`, error)) return;
	}

	// Deleted one key at a time rather than batched into an `.in()` filter: a
	// `.in()` is URL query text regardless of verb (PostgREST convention), and a
	// variation key is an unbounded `>`-joined chain of UUIDs — a handful of deep
	// keys would blow the URL length on their own.
	for (const key of plan.solvedDeletes) {
		const { error } = await supabase
			.from('variation_solved')
			.delete()
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.eq('variation_key', key);
		if (writeFailed(`solved delete ${key}`, error)) return;
	}

	if (plan.demotions.length > 0) {
		// Append-only audit trail (migration 0057, widened to allow
		// 'coach_update' by 0062). The student did nothing wrong here — the
		// material moved under them — which is exactly why this cause exists
		// rather than reusing 'mistake' or 'hint'.
		const { error } = await supabase.from('variation_demotions').insert(
			plan.demotions.map((demotion) => ({
				player_id: playerId,
				repertoire_id: repertoireId,
				variation_key: demotion.variationKey,
				cause: demotion.cause
			}))
		);
		if (writeFailed('demotion log', error)) return;
	}

	for (const move of plan.exclusionMoves) {
		// `verified_at` is stamped with the same `movesUpdatedAt` the reconciliation
		// stamp uses, for the same reason `reverifyExclusions` does: the freshness
		// test is `verified_at >= moves_updated_at`, so copying the value satisfies
		// it outright and keeps this load's prune from re-verifying a row it has
		// just rewritten.
		const { error } = await supabase
			.from('variation_practice_exclusions')
			.update({ variation_key: move.toKey, verified_at: movesUpdatedAt })
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.eq('variation_key', move.fromKey);
		if (writeFailed(`exclusion rekey ${move.fromKey} -> ${move.toKey}`, error)) return;
	}

	if (plan.clearActiveVariation) {
		// An UPDATE, not an upsert: the plan only sets this when the stored pointer
		// named a carried key, which means the row already exists. `null` is a
		// legal value for the column and every reader already self-heals a missing
		// or unusable pointer by re-picking one.
		const { error } = await supabase
			.from('practice_active_variation')
			.update({ active_variation_key: null })
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId);
		if (writeFailed('clear active variation', error)) return;
	}

	// Stamped LAST, and only after every write above succeeded: the stamp is the
	// claim "this student's progress matches this shape", so writing it ahead of
	// the writes it describes would make a failure permanent — reconciliation
	// would never run again for this shape and the un-carried progress would stay
	// stranded under dead keys.
	//
	// `reconciled_at` is the repertoire's own `moves_updated_at` VALUE, not a
	// clock reading. The freshness test compares the two directly, so copying the
	// value satisfies it with no clock agreement needed between the app and the
	// database (see migration 0062).
	const { error } = await supabase.from('repertoire_reconciliation').upsert(
		{ player_id: playerId, repertoire_id: repertoireId, reconciled_at: movesUpdatedAt },
		{ onConflict: 'player_id,repertoire_id' }
	);
	writeFailed('reconciliation stamp', error);
}
