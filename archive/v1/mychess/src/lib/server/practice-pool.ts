// mychess/src/lib/server/practice-pool.ts
//
// Supabase IO behind the Practice pool (story #97 of epic #95). The ordering
// itself is pure and lives in `$lib/mastery/practiceQueue`; this module only
// fetches what that needs and hands the result over.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MoveAttemptStat } from '$lib/mastery/practiceQueue';
import { fetchAllPages } from './paginate';

/**
 * Page size for the attempt sweep. A single repertoire's attempt history is the
 * unit here, not the whole table, so this stays well clear of PostgREST's
 * 1000-row default cap while keeping the round-trip count low.
 */
const ATTEMPTS_PAGE_SIZE = 1000;

/**
 * Per-move attempt history for one player+repertoire, aggregated in memory.
 *
 * Aggregating client-side rather than in SQL is deliberate: PostgREST can't
 * express `group by` without a database function, and adding one would put a
 * second copy of the "what counts as an attempt" rule in SQL where the pure
 * ordering logic can't see it. A repertoire's own attempt history is small
 * enough that the sweep is cheaper than that divergence — and if it ever isn't,
 * the fix is a view with the aggregation in one place, not a second rule.
 *
 * Errors propagate rather than degrading to an empty map: an empty map reads as
 * "never practised anything", which would silently reorder the whole queue into
 * repertoire order and look like a feature rather than a failed read.
 */
export async function loadMoveAttemptStats(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<Map<string, MoveAttemptStat>> {
	const rows = await fetchAllPages<{ move_id: string; is_correct: boolean; created_at: string }>(
		() =>
			supabase
				.from('move_attempts')
				.select('move_id, is_correct, created_at')
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId)
				.order('created_at', { ascending: true }),
		() =>
			supabase
				.from('move_attempts')
				.select('id', { count: 'exact', head: true })
				.eq('player_id', playerId)
				.eq('repertoire_id', repertoireId),
		ATTEMPTS_PAGE_SIZE
	);

	const stats = new Map<string, MoveAttemptStat>();
	for (const row of rows) {
		const existing = stats.get(row.move_id);
		if (existing) {
			existing.attempts++;
			if (!row.is_correct) existing.wrong++;
			// Rows arrive oldest-first, so a later row is always the newer one.
			existing.lastAttemptAt = row.created_at;
		} else {
			stats.set(row.move_id, {
				moveId: row.move_id,
				attempts: 1,
				wrong: row.is_correct ? 0 : 1,
				lastAttemptAt: row.created_at
			});
		}
	}
	return stats;
}

/**
 * Deletes the learned marker and resets graduation progress, sending a
 * variation back to Learn (story #98).
 *
 * Two writes, deliberately in this order: the `variation_solved` delete is what
 * actually moves the variation between queues, so it goes first. If the counter
 * reset then fails, the variation is un-learned with a stale count of 2 — it
 * gets re-taught and its next clean pass graduates it immediately, which is
 * merely lenient. The reverse order would leave it *learned* with a zeroed
 * count: still in Practice, and a failure there would reset a counter that is
 * already 0, so the player could never get it out of the pool.
 */
export async function demoteVariation(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	variationKey: string,
	cause: 'mistake' | 'hint'
): Promise<void> {
	await supabase
		.from('variation_solved')
		.delete()
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.eq('variation_key', variationKey);

	await supabase
		.from('variation_teaching_progress')
		.update({ clean_pass_count: 0, last_clean_pass_at: null })
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId)
		.eq('variation_key', variationKey);

	// The audit row is last and its failure is swallowed: losing a metric row
	// must never make the demotion itself look like it failed to the player.
	const { error } = await supabase.from('variation_demotions').insert({
		player_id: playerId,
		repertoire_id: repertoireId,
		variation_key: variationKey,
		cause
	});
	if (error) {
		console.error(`demoteVariation: failed to log demotion for ${variationKey}:`, error.message);
	}
}
