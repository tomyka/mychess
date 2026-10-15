import type { BadgeStats } from './recalc';

/**
 * The shape the badge rules are evaluated against, and the mapping onto it.
 *
 * Pure by design (GitHub issue #223): this file names every input a badge
 * decision reads, and nothing here touches Supabase. The query half — reading
 * these numbers out of the database and writing the resulting grants — lives in
 * `$lib/server/badges/grant.ts`, per the split CLAUDE.md documents. Keeping the
 * type here rather than beside the I/O is what lets `recalc.ts`'s rules and
 * their tests stay database-free.
 */
export interface BadgeStatsInput {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  sessionCount: number;
  repertoireCount: number;
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
