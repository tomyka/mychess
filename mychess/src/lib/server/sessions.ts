// mychess/src/lib/server/sessions.ts
//
// Training-session records (story #103 of epic #95). These back the epic's
// behavioural success criterion: once a repertoire is Learned, are practice and
// mastery sessions outnumbering learn sessions?
//
// The table already had a `mode` column — `0001_core_tables.sql:76`, widened by
// 0005, 0026 and now 0059. What it never had was a working writer: the two
// original callers (`/api/drill`, `/api/time-trial`, both since removed with
// their unreachable pages) inserted `cards_reviewed`, which has never existed
// in any migration, and neither checked the error. That is why `sessions` was
// empty in production, and why `grantNewBadges`' session-count badges were
// unearnable.

import type { SupabaseClient } from '@supabase/supabase-js';

export type SessionMode = 'learn' | 'practice' | 'mastery';

/**
 * Records one training session.
 *
 * Called once per page visit — on the first attempt reported, not per attempt —
 * so "sessions" means what a person would mean by it. The write is best-effort:
 * a failed insert must never break the attempt the player just made, but unlike
 * the two pre-existing writers it is logged, so a broken column name can't hide
 * for months again.
 */
export async function recordSession(
	supabase: SupabaseClient,
	playerId: string,
	repertoireId: string | null,
	mode: SessionMode,
	cardsDone = 0
): Promise<void> {
	const { error } = await supabase.from('sessions').insert({
		player_id: playerId,
		repertoire_id: repertoireId,
		mode,
		cards_done: cardsDone
	});
	if (error) {
		console.error(`recordSession: failed to record a ${mode} session for player ${playerId}:`, error.message);
	}
}
