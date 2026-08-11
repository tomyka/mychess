// mychess/src/lib/server/level-progress.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variation } from '$lib/mastery/variations';
import {
	buildQueue,
	resolveAttempt,
	resolvePreviousLevelMistake,
	syncLevelProgress,
	type AttemptResult,
	type LevelProgressRow
} from '$lib/mastery/levelProgress';

type DbRow = { level: number; prev_level_mistakes: number; queue: unknown; version: number };

function toRow(r: DbRow): LevelProgressRow {
	return { level: r.level, prevLevelMistakes: r.prev_level_mistakes, queue: r.queue as LevelProgressRow['queue'] };
}

const MAX_CONFLICT_RETRIES = 5;

/**
 * Reads the current row (if any), runs `compute` against it, and persists
 * the result with an optimistic-concurrency check — an `UPDATE ... WHERE
 * version = <version just read>` (or a bare `INSERT` when no row exists
 * yet), retrying against a fresh read whenever that affects zero rows,
 * meaning a concurrent writer landed first.
 *
 * This matters because THREE independent flows mutate the same
 * (player_id, repertoire_id) row: the detail page's on-load sync, an
 * attempt's completion, and an instant previous-level-mistake report (fired
 * unawaited the moment a wrong move lands, so it can genuinely overlap with
 * either of the other two). A plain read-then-write here would let
 * whichever write lands last silently clobber the other.
 *
 * `compute` returns `null` to mean "no row and nothing to create" (an
 * attempt/mistake report against a repertoire with no run yet — shouldn't
 * normally happen, but is a safe no-op rather than an error). Returning the
 * exact `existing` object back is treated as a no-op write too — every pure
 * resolver in `$lib/mastery/levelProgress.ts` already does this for its own
 * no-op cases (stale/replayed report, already mastered), so this falls out
 * for free rather than needing each call site to special-case it.
 */
async function mutateLevelProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	compute: (existing: LevelProgressRow | null) => LevelProgressRow | null
): Promise<LevelProgressRow | null> {
	for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
		const { data: existingRaw } = await supabase
			.from('level_progress')
			.select('level, prev_level_mistakes, queue, version')
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.maybeSingle();

		const existingRow = existingRaw ? toRow(existingRaw) : null;
		const next = compute(existingRow);
		if (next === null) return existingRow;
		if (existingRow && next === existingRow) return existingRow;

		if (!existingRaw) {
			const { error } = await supabase.from('level_progress').insert({
				player_id: playerId,
				repertoire_id: repertoireId,
				level: next.level,
				prev_level_mistakes: next.prevLevelMistakes,
				queue: next.queue,
				version: 0
			});
			if (!error) return next;
			continue; // someone else inserted first — retry, this time as a version-checked update
		}

		const { data: updated } = await supabase
			.from('level_progress')
			.update({
				level: next.level,
				prev_level_mistakes: next.prevLevelMistakes,
				queue: next.queue,
				version: existingRaw.version + 1
			})
			.eq('player_id', playerId)
			.eq('repertoire_id', repertoireId)
			.eq('version', existingRaw.version)
			.select('version');
		if (updated && updated.length > 0) return next;
		// Lost the race against a concurrent writer — retry from a fresh read.
	}
	throw new Error(
		`level_progress: exceeded retry limit resolving a concurrent update (player ${playerId}, repertoire ${repertoireId})`
	);
}

/**
 * Loads a repertoire's level_progress row, creating a fresh Level 1 run if
 * none exists yet, then reconciles it against the repertoire's current
 * content (a coach edit since the last run) — persisting either write.
 * Returns `null` for a repertoire with no variations (vacuously mastered,
 * nothing to track).
 */
export async function loadSyncedLevelProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	maxLevel: number
): Promise<LevelProgressRow | null> {
	if (variations.length === 0) return null;

	return mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		const row = existing ?? { level: 1, prevLevelMistakes: 0, queue: buildQueue(variations, 1) };
		return syncLevelProgress(row, variations, maxLevel);
	});
}

/**
 * Applies a completed Practice attempt's outcome — see
 * `$lib/mastery/levelProgress.ts`'s `resolveAttempt` for the rules. Assumes
 * a row already exists (an attempt can only be reported for a level that
 * was itself served from an existing row); silently no-ops otherwise.
 * Returns the resulting row so the caller can build a fresh `PracticeView`
 * without a separate re-read.
 */
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	result: AttemptResult,
	variations: Variation[],
	maxLevel: number
): Promise<LevelProgressRow | null> {
	return mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		if (!existing) return null;
		return resolveAttempt(existing, result, variations, maxLevel);
	});
}

/**
 * Applies a single previous-level-band mistake immediately — see
 * `$lib/mastery/levelProgress.ts`'s `resolvePreviousLevelMistake` for the
 * rules. Called the instant a wrong move lands on review material, not
 * batched until some attempt eventually completes. Returns whether this
 * mistake demoted the level plus the resulting row (so a demotion's caller
 * can build a fresh `PracticeView` without a separate re-read); `null` if no
 * row exists yet (an attempt can only be in progress against an existing
 * row, so this shouldn't normally happen).
 */
export async function applyPreviousLevelMistake(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	maxLevel: number
): Promise<{ demoted: boolean; row: LevelProgressRow } | null> {
	let demoted = false;
	const next = await mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		if (!existing) return null;
		const outcome = resolvePreviousLevelMistake(existing, variations, maxLevel);
		demoted = outcome.demoted;
		return outcome.row;
	});
	return next ? { demoted, row: next } : null;
}

/** When this player last completed a maintenance review of a mastered repertoire, or `null` if never. */
export async function getLastReviewedAt(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<string | null> {
	const { data } = await supabase
		.from('level_progress')
		.select('last_reviewed_at')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.maybeSingle();
	return data?.last_reviewed_at ?? null;
}

/**
 * Records that a maintenance review session just finished — see
 * `reviewFreshness`. A plain update, not routed through
 * `mutateLevelProgress`'s optimistic-concurrency machinery: `last_reviewed_at`
 * doesn't participate in the level/queue/version invariants that machinery
 * protects (a maintenance review never touches level or queue), so a
 * concurrent write to either can't corrupt this column or vice versa —
 * Postgres's normal row-level locking is all that's needed here. Assumes a
 * row already exists (only reachable from the Mastered screen, which
 * requires one); silently no-ops otherwise via the `.eq` filters matching
 * nothing.
 */
export async function recordMaintenanceReview(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<void> {
	await supabase
		.from('level_progress')
		.update({ last_reviewed_at: new Date().toISOString() })
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId);
}
