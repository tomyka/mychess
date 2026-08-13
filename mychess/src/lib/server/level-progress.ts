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
import { pickActiveVariation, advanceVariationIfMastered } from '$lib/mastery/variationSequence';

type DbRow = {
	level: number;
	prev_level_mistakes: number;
	queue: unknown;
	version: number;
	active_variation_key: string | null;
};

function toRow(r: DbRow): LevelProgressRow {
	return {
		level: r.level,
		prevLevelMistakes: r.prev_level_mistakes,
		queue: r.queue as LevelProgressRow['queue'],
		activeVariationKey: r.active_variation_key
	};
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
			.select('level, prev_level_mistakes, queue, version, active_variation_key')
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
				active_variation_key: next.activeVariationKey ?? null,
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
				active_variation_key: next.activeVariationKey ?? null,
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
 * Loads a repertoire's level_progress row, creating a fresh Level 1 run
 * against the first (or resumed) active variation if none exists yet, then
 * reconciles it against the repertoire's current content — persisting
 * either write. `advanceVariationIfMastered` runs after every sync so a row
 * left sitting past its active variation's cap (e.g. the player closed the
 * tab right after their last correct move) advances to the next variation
 * on this very load, not just on a future attempt report. Returns `null` for
 * a repertoire with no variations (vacuously mastered, nothing to track).
 */
export async function loadSyncedLevelProgress(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number
): Promise<LevelProgressRow | null> {
	if (variations.length === 0) return null;

	return mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		const active = pickActiveVariation(variations, existing?.activeVariationKey ?? null);
		if (!active) return null;
		const row = existing ?? {
			level: 1,
			prevLevelMistakes: 0,
			queue: buildQueue([active], 1, chunkSize),
			activeVariationKey: active.variationKey
		};
		const synced = syncLevelProgress(row, [active], maxLevel, chunkSize);
		return advanceVariationIfMastered(synced, variations, maxLevel, chunkSize);
	});
}

/**
 * Applies a completed Practice attempt's outcome — see
 * `$lib/mastery/levelProgress.ts`'s `resolveAttempt` for the rules, scoped to
 * whichever variation is currently active. `advanceVariationIfMastered` runs
 * afterward so completing a variation's final level immediately switches the
 * active variation, rather than leaving that switch to the next page load.
 */
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	result: AttemptResult,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number
): Promise<LevelProgressRow | null> {
	return mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		if (!existing) return null;
		const active = pickActiveVariation(variations, existing.activeVariationKey ?? null);
		if (!active) return null;
		const resolved = resolveAttempt(existing, result, [active], maxLevel, chunkSize);
		return advanceVariationIfMastered(resolved, variations, maxLevel, chunkSize);
	});
}

/**
 * Applies a single previous-level-band mistake immediately — see
 * `$lib/mastery/levelProgress.ts`'s `resolvePreviousLevelMistake` for the
 * rules, scoped to the active variation. `advanceVariationIfMastered` is
 * applied uniformly afterward for consistency even though a demotion never
 * masters anything — it's a harmless pass-through in that case, and every
 * other mutation path already goes through it, so a mistake report doesn't
 * need its own special case to still carry a correct `activeVariationKey`.
 */
export async function applyPreviousLevelMistake(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[],
	maxLevel: number,
	chunkSize: number
): Promise<{ demoted: boolean; row: LevelProgressRow } | null> {
	let demoted = false;
	const next = await mutateLevelProgress(supabase, playerId, repertoireId, (existing) => {
		if (!existing) return null;
		const active = pickActiveVariation(variations, existing.activeVariationKey ?? null);
		if (!active) return null;
		const outcome = resolvePreviousLevelMistake(existing, [active], maxLevel, chunkSize);
		demoted = outcome.demoted;
		return advanceVariationIfMastered(outcome.row, variations, maxLevel, chunkSize);
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
 * doesn't participate in the level/queue/version/active-variation invariants
 * that machinery protects, so a concurrent write to any of those can't
 * corrupt this column or vice versa — Postgres's normal row-level locking is
 * all that's needed here. Assumes a row already exists (only reachable from
 * the Mastered screen, which requires one); silently no-ops otherwise via the
 * `.eq` filters matching nothing.
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
