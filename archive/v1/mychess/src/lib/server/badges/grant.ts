// mychess/src/lib/server/badges/grant.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BadgeStats } from '$lib/badges/recalc';
import { checkBadgeEligibility, checkBadgeRevocations } from '$lib/badges/recalc';
import { buildBadgeStats, type BadgeStatsInput } from '$lib/badges/grant';
import { countRepertoireStatuses } from '$lib/server/repertoire-status-counts';
import { createAdminClient } from '$lib/server/supabase-admin';
import type { RepertoireProgressSummary } from '$lib/server/repertoire-progress';

/**
 * Collect stats from DB, run the eligibility check, insert new badges — and,
 * for the four revocable epic-#95 badges only, delete any that no longer hold.
 *
 * Returns the IDs of newly granted badges (empty if none).
 *
 * Lives under `lib/server/`, not beside the rules in `lib/badges/`, because it
 * touches Supabase and mints a privileged client — the split CLAUDE.md
 * documents (GitHub issue #223). The decisions stay pure and colocated-testable
 * in `$lib/badges/recalc.ts` and `$lib/badges/grant.ts`; only the I/O is here.
 * The placement is load-bearing rather than tidy: SvelteKit refuses to bundle
 * anything under `$lib/server/` into client code, so a stray import of this from
 * a component fails the build instead of shipping a service-role client to a
 * browser.
 *
 * `progressSummaries`, when passed, is forwarded to `countRepertoireStatuses`
 * as-is instead of letting it recompute them — see that function's own doc
 * comment for why (avoids calling back into whichever function already
 * computed them, when that function is what's calling this one).
 */
export async function grantNewBadges(
	supabase: SupabaseClient,
	playerId: string,
	overrides: Partial<BadgeStatsInput> = {},
	progressSummaries?: RepertoireProgressSummary[],
	/**
	 * The client the two WRITES below go through, defaulting to a service-role
	 * one (GitHub issue #221).
	 *
	 * `badges_earned` has SELECT policies and nothing else, so every write made
	 * with `supabase` — the anon-key client carrying the player's own JWT, which
	 * is what both callers pass — was refused: zero badges had ever been awarded
	 * in production. Opening an INSERT policy instead would have let a player
	 * grant themselves any badge in the catalog by calling PostgREST directly,
	 * since RLS cannot tell our server acting for a player from the player
	 * acting for themselves.
	 *
	 * Reads deliberately stay on `supabase`: they work under RLS today, and
	 * keeping them scoped to the signed-in player is worth more than the tidiness
	 * of one client for everything.
	 *
	 * Injectable only so tests can observe which client each query went to.
	 * Evaluated lazily at the write, so the service key is not required to merely
	 * call this — a repertoire with no badge movement never builds one.
	 */
	writeClient?: SupabaseClient
): Promise<string[]> {
	const [profileRes, playerStatsRes, sessionRes, repRes, questRes, earnedRes] = await Promise.all([
		supabase.from('profiles').select('streak_days').eq('id', playerId).single(),
		supabase.from('player_stats').select('total_reviews, total_correct, moves_learned').eq('player_id', playerId).single(),
		supabase.from('sessions').select('id, mode').eq('player_id', playerId),
		supabase.from('repertoires').select('id').eq('player_id', playerId),
		// Completion is recorded as a timestamp (`quests.completed_at`), not a
		// boolean — filtering on a non-existent `completed` column made this
		// query fail and pinned questsCompleted at 0 forever.
		supabase.from('quests').select('id').eq('player_id', playerId).not('completed_at', 'is', null),
		supabase.from('badges_earned').select('badge_id').eq('player_id', playerId)
	]);

	// Bounded work: only repertoires that are already fully learned need their
	// chapter mastery checked, and that set is small by definition.
	const statusCounts = await countRepertoireStatuses(supabase, playerId, progressSummaries);

	const p = profileRes.data;
	const ks = playerStatsRes.data;
	const sessions = sessionRes.data ?? [];

	const earnedIds = new Set((earnedRes.data ?? []).map((r) => r.badge_id as string));

	// A failed quest count silently reads as "0 quests completed", which quietly
	// makes quest badges unearnable — log it rather than let it look like real data.
	if (questRes.error) {
		console.error(`grantNewBadges: failed to count completed quests for player ${playerId}:`, questRes.error.message);
	}

	const stats: BadgeStats = buildBadgeStats({
		totalReviews: ks?.total_reviews ?? 0,
		totalCorrect: ks?.total_correct ?? 0,
		movesLearned: ks?.moves_learned ?? 0,
		streakDays: p?.streak_days ?? 0,
		sessionCount: sessions.length,
		repertoireCount: (repRes.data ?? []).length,
		questsCompleted: (questRes.data ?? []).length,
		hasUploaded: (repRes.data ?? []).length > 0,
		repertoiresLearned: statusCounts.learned,
		repertoiresMastered: statusCounts.mastered,
		earnedIds,
		...overrides
	});

	const newBadgeIds = checkBadgeEligibility(stats);
	const revoked = checkBadgeRevocations(stats);
	// Lazily, and once: building it costs an env read and a client, and most
	// passes have nothing to write at all.
	const writes = revoked.length > 0 || newBadgeIds.length > 0 ? (writeClient ?? createAdminClient()) : null;

	// Revocations first, so a tier that has fallen is removed even in the same
	// pass that grants something else.
	if (writes && revoked.length > 0) {
		// `.select()` so the deleted rows come back and can be counted. Without it
		// this was the quieter half of #221: RLS narrowed the DELETE to zero
		// matching rows, PostgREST reports no error for a delete that matched
		// nothing, so `revokeError` stayed null and revocation silently did nothing
		// for the life of the bug. A count that doesn't match what we hold is the
		// only signal such a failure ever gives.
		const { data: deleted, error: revokeError } = await writes
			.from('badges_earned')
			.delete()
			.eq('player_id', playerId)
			.in('badge_id', revoked)
			.select('badge_id');
		if (revokeError) {
			console.error(`grantNewBadges: failed to revoke ${revoked.join(', ')} for player ${playerId}:`, revokeError.message);
		} else if ((deleted?.length ?? 0) < revoked.length) {
			// Compared against `revoked` itself, not a re-filter of it by
			// `stats.earnedIds`: `checkBadgeRevocations` only ever returns ids the
			// player is already recorded as holding, so such a filter is a no-op that
			// reads like a real guard and invites the next reader to trust it.
			console.error(
				`grantNewBadges: revoked ${deleted?.length ?? 0} of ${revoked.length} held badge row(s) for player ${playerId} (${revoked.join(', ')}) — the delete matched fewer rows than expected`
			);
		}
	}

	if (newBadgeIds.length === 0) return [];

	const rows = newBadgeIds.map((id) => ({ player_id: playerId, badge_id: id }));
	const { error } = await writes!.from('badges_earned').insert(rows);
	// A failed insert didn't actually grant anything — surface it (both call
	// sites otherwise swallow the returned promise's rejection too, so this
	// console.error is the only place a real DB failure here would ever be
	// visible) and don't report badges as granted that weren't persisted.
	if (error) {
		console.error(`grantNewBadges: failed to insert ${rows.length} badge row(s) for player ${playerId}:`, error.message);
		return [];
	}

	return newBadgeIds;
}
