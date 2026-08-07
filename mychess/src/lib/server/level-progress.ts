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

type DbRow = { level: number; prev_level_mistakes: number; queue: unknown };

function toRow(r: DbRow): LevelProgressRow {
	return { level: r.level, prevLevelMistakes: r.prev_level_mistakes, queue: r.queue as LevelProgressRow['queue'] };
}

async function upsert(supabase: SupabaseClient, playerId: string, repertoireId: string, row: LevelProgressRow) {
	await supabase.from('level_progress').upsert(
		{
			player_id: playerId,
			repertoire_id: repertoireId,
			level: row.level,
			prev_level_mistakes: row.prevLevelMistakes,
			queue: row.queue
		},
		{ onConflict: 'player_id,repertoire_id' }
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
	variations: Variation[]
): Promise<LevelProgressRow | null> {
	if (variations.length === 0) return null;

	const { data: existing } = await supabase
		.from('level_progress')
		.select('level, prev_level_mistakes, queue')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.maybeSingle();

	const row = existing ? toRow(existing) : { level: 1, prevLevelMistakes: 0, queue: buildQueue(variations, 1) };
	const synced = syncLevelProgress(row, variations);
	await upsert(supabase, playerId, repertoireId, synced);
	return synced;
}

/**
 * Applies a completed Practice attempt's outcome — see
 * `$lib/mastery/levelProgress.ts`'s `resolveAttempt` for the rules. Assumes
 * a row already exists (an attempt can only be reported for a level that
 * was itself served from an existing row); silently no-ops otherwise.
 */
export async function applyAttemptResult(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	result: AttemptResult,
	variations: Variation[]
): Promise<void> {
	const { data: existing, error: selectError } = await supabase
		.from('level_progress')
		.select('level, prev_level_mistakes, queue')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.single();

	if (selectError || !existing) return;

	const next = resolveAttempt(toRow(existing), result, variations);
	await upsert(supabase, playerId, repertoireId, next);
}

/**
 * Applies a single previous-level-band mistake immediately — see
 * `$lib/mastery/levelProgress.ts`'s `resolvePreviousLevelMistake` for the
 * rules. Called the instant a wrong move lands on review material, not
 * batched until some attempt eventually completes. Returns whether this
 * mistake demoted the level, so the caller can react right away; `null` if
 * no row exists yet (an attempt can only be in progress against an existing
 * row, so this shouldn't normally happen).
 */
export async function applyPreviousLevelMistake(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variations: Variation[]
): Promise<{ demoted: boolean; level: number } | null> {
	const { data: existing, error: selectError } = await supabase
		.from('level_progress')
		.select('level, prev_level_mistakes, queue')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.single();

	if (selectError || !existing) return null;

	const { row: next, demoted } = resolvePreviousLevelMistake(toRow(existing), variations);
	await upsert(supabase, playerId, repertoireId, next);
	return { demoted, level: next.level };
}
