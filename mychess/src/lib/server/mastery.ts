// mychess/src/lib/server/mastery.ts
//
// Supabase IO for chapter mastery (story #100 of epic #95). The rules live in
// `$lib/mastery/masteryRun` and `$lib/mastery/repertoireStatus`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MasteryRecord } from '$lib/mastery/masteryRun';

/** This player's chapter-mastery records for one repertoire. */
export async function loadChapterMastery(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string
): Promise<MasteryRecord[]> {
	const { data, error } = await supabase
		.from('chapter_mastery')
		.select('chapter_name, moves_updated_at')
		.eq('player_id', playerId)
		.eq('repertoire_id', repertoireId);

	// Propagated rather than swallowed: an empty list reads as "nothing mastered",
	// which would quietly revoke a Mastered repertoire on a transient read error.
	if (error) throw error;
	return (data ?? []).map((r) => ({ chapterName: r.chapter_name, movesUpdatedAt: r.moves_updated_at }));
}

/**
 * Records (or re-records) mastery of one chapter, stamped with the repertoire's
 * current `moves_updated_at`.
 *
 * Upsert on the natural key rather than insert: a chapter whose mastery went
 * stale because the coach added material is re-earned by running it again, and
 * that must refresh the existing row rather than fail on the unique constraint
 * or pile up history rows. `onConflict` is explicit because the table's primary
 * key is a surrogate `id` — the default would target that and never match.
 */
export async function recordChapterMastery(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string,
	chapterName: string,
	movesUpdatedAt: string | null
): Promise<void> {
	const { error } = await supabase.from('chapter_mastery').upsert(
		{
			player_id: playerId,
			repertoire_id: repertoireId,
			chapter_name: chapterName,
			mastered_at: new Date().toISOString(),
			moves_updated_at: movesUpdatedAt
		},
		{ onConflict: 'player_id,repertoire_id,chapter_name' }
	);
	if (error) throw error;
}
