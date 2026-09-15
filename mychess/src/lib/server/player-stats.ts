// mychess/src/lib/server/player-stats.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Records one completed Learn attempt against `player_stats` and the streak
 * (GitHub issue #224).
 *
 * `player_stats` had no writer at all between migration 0027 and this. The
 * original one was `submit_session_result` (migration 0003), which incremented
 * `total_reviews`/`total_correct` and called `update_streak`; 0027 dropped it
 * along with the XP system it was entangled with, and nothing replaced it. The
 * badge rules kept reading those columns, so eight of them — `first_move`,
 * `review_10/100/500/1000`, `moves_learned_10/50/100` — became permanently
 * unearnable, checking a counter frozen at 0. `first_move` is the one #221
 * expected a player's first attempt to earn.
 *
 * Service-role client, not the player's (same reason as `grantNewBadges`, see
 * #221): `player_stats` has SELECT policies for self and coach and an INSERT
 * policy for self, but **no UPDATE policy** — so the anon-key client cannot
 * write these columns at all, and should not be able to. A player must not be
 * able to set their own review count; it is the server's tally, not theirs.
 */
export async function recordAttemptStats(
	admin: SupabaseClient,
	playerId: string,
	attempt: { hadMistake: boolean; newlyMasteredMoves: number }
): Promise<void> {
	// Read-modify-write rather than an atomic `total_reviews = total_reviews + 1`,
	// which PostgREST cannot express — that needs SQL, and this environment
	// cannot apply migrations (see CLAUDE.md), so an RPC would have parked the
	// whole fix behind a manual step. The race it accepts is two attempts by the
	// SAME player completing within one round trip of each other, which a person
	// playing one board cannot do; the cost if it ever happens is one undercounted
	// review, not a wrong badge. An atomic RPC is still the better shape and is
	// worth a migration next time one is being written anyway.
	const { data: current, error: readError } = await admin
		.from('player_stats')
		.select('total_reviews, total_correct, moves_learned')
		.eq('player_id', playerId)
		.maybeSingle();
	if (readError) {
		console.error(`recordAttemptStats: failed to read player_stats for ${playerId}:`, readError.message);
		return;
	}

	// `upsert`, because the row is created at onboarding but a player who predates
	// that helper may not have one — and a missing row must not silently mean
	// "this player earns no badges", which is the failure mode being fixed here.
	const { error: writeError } = await admin.from('player_stats').upsert(
		{
			player_id: playerId,
			total_reviews: (current?.total_reviews ?? 0) + 1,
			total_correct: (current?.total_correct ?? 0) + (attempt.hadMistake ? 0 : 1),
			// Monotonic, incremented by what this attempt newly mastered, rather than
			// set to a count derived from the repertoire in hand: the badge is
			// account-wide, so an absolute value from one repertoire would clobber
			// every other repertoire's contribution each time a different one was
			// drilled.
			moves_learned: (current?.moves_learned ?? 0) + attempt.newlyMasteredMoves,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'player_id' }
	);
	if (writeError) {
		console.error(`recordAttemptStats: failed to write player_stats for ${playerId}:`, writeError.message);
		return;
	}

	// The streak function survived both cleanups (migration 0051 calls keeping it
	// deliberate) but has had no caller since 0027, which is why `streak_days` is
	// 0 for every player and `first_streak_3`/`streak_7`/`streak_30`/`streak_100`
	// never fire either. It is `security definer` and idempotent within a day —
	// its first branch returns immediately when `last_active_date` is already
	// today — so calling it once per attempt is safe.
	const { error: streakError } = await admin.rpc('update_streak', { p_player_id: playerId });
	if (streakError) {
		console.error(`recordAttemptStats: update_streak failed for ${playerId}:`, streakError.message);
	}
}
