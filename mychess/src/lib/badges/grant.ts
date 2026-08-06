import type { SupabaseClient } from '@supabase/supabase-js';
import type { BadgeStats } from './recalc';
import { checkBadgeEligibility } from './recalc';

export interface BadgeStatsInput {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  sessionCount: number;
  repertoireCount: number;
  ttBestScore: number;
  questsCompleted: number;
  hasUploaded: boolean;
  earnedIds: Set<string>;
}

/** Identity helper — lets tests verify the mapping without mocking Supabase. */
export function buildBadgeStats(input: BadgeStatsInput): BadgeStats {
  return input;
}

/**
 * Collect stats from DB, run eligibility check, insert new badges.
 * Returns the IDs of newly granted badges (empty if none).
 */
export async function grantNewBadges(
  supabase: SupabaseClient,
  playerId: string,
  overrides: Partial<BadgeStatsInput> = {}
): Promise<string[]> {
  const [profileRes, playerStatsRes, sessionRes, repRes, questRes, earnedRes] =
    await Promise.all([
      supabase.from('profiles').select('streak_days').eq('id', playerId).single(),
      supabase.from('player_stats').select('total_reviews, total_correct, moves_learned').eq('player_id', playerId).single(),
      supabase.from('sessions').select('id, mode').eq('player_id', playerId),
      supabase.from('repertoires').select('id').eq('player_id', playerId),
      supabase.from('quests').select('id').eq('player_id', playerId).eq('completed', true),
      supabase.from('badges_earned').select('badge_id').eq('player_id', playerId)
    ]);

  const p = profileRes.data;
  const ks = playerStatsRes.data;
  const sessions = sessionRes.data ?? [];

  const earnedIds = new Set((earnedRes.data ?? []).map((r: any) => r.badge_id as string));

  const stats: BadgeStats = buildBadgeStats({
    totalReviews: ks?.total_reviews ?? 0,
    totalCorrect: ks?.total_correct ?? 0,
    movesLearned: ks?.moves_learned ?? 0,
    streakDays: p?.streak_days ?? 0,
    sessionCount: sessions.length,
    repertoireCount: (repRes.data ?? []).length,
    ttBestScore: 0,
    questsCompleted: (questRes.data ?? []).length,
    hasUploaded: (repRes.data ?? []).length > 0,
    earnedIds,
    ...overrides
  });

  const newBadgeIds = checkBadgeEligibility(stats);
  if (newBadgeIds.length === 0) return [];

  const rows = newBadgeIds.map(id => ({ player_id: playerId, badge_id: id }));
  await supabase.from('badges_earned').insert(rows);

  return newBadgeIds;
}
