import type { SupabaseClient } from '@supabase/supabase-js';
import type { BadgeStats } from './recalc';
import { checkBadgeEligibility, checkBadgeRevocations } from './recalc';
import { countRepertoireStatuses } from '$lib/server/repertoire-status-counts';
import type { RepertoireProgressSummary } from '$lib/server/repertoire-progress';

export interface BadgeStatsInput {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  sessionCount: number;
  repertoireCount: number;
  ttScore: number;
  questsCompleted: number;
  hasUploaded: boolean;
  repertoiresLearned: number;
  repertoiresMastered: number;
  earnedIds: Set<string>;
}

/** Identity helper — lets tests verify the mapping without mocking Supabase. */
export function buildBadgeStats(input: BadgeStatsInput): BadgeStats {
  return input;
}

/**
 * Collect stats from DB, run the eligibility check, insert new badges — and,
 * for the four revocable epic-#95 badges only, delete any that no longer hold.
 *
 * Revocation is new behaviour: this function was insert-only, so badges were
 * permanent by construction. Deleting the row is also what lets a badge be
 * re-earned later with no special case, since `earnedIds` stops suppressing it.
 *
 * Returns the IDs of newly granted badges (empty if none).
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
  progressSummaries?: RepertoireProgressSummary[]
): Promise<string[]> {
  const [profileRes, playerStatsRes, sessionRes, repRes, questRes, earnedRes] =
    await Promise.all([
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

  const earnedIds = new Set((earnedRes.data ?? []).map((r: any) => r.badge_id as string));

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
    ttScore: 0,
    questsCompleted: (questRes.data ?? []).length,
    hasUploaded: (repRes.data ?? []).length > 0,
    repertoiresLearned: statusCounts.learned,
    repertoiresMastered: statusCounts.mastered,
    earnedIds,
    ...overrides
  });

  // Revocations first, so a tier that has fallen is removed even in the same
  // pass that grants something else.
  const revoked = checkBadgeRevocations(stats);
  if (revoked.length > 0) {
    const { error: revokeError } = await supabase
      .from('badges_earned')
      .delete()
      .eq('player_id', playerId)
      .in('badge_id', revoked);
    if (revokeError) {
      console.error(`grantNewBadges: failed to revoke ${revoked.join(', ')} for player ${playerId}:`, revokeError.message);
    }
  }

  const newBadgeIds = checkBadgeEligibility(stats);
  if (newBadgeIds.length === 0) return [];

  const rows = newBadgeIds.map(id => ({ player_id: playerId, badge_id: id }));
  const { error } = await supabase.from('badges_earned').insert(rows);
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
