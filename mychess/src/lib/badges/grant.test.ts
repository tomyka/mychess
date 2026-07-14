import { describe, it, expect } from 'vitest';
import { buildBadgeStats } from './grant';

describe('buildBadgeStats', () => {
  it('maps DB rows to BadgeStats correctly', () => {
    const stats = buildBadgeStats({
      totalReviews: 10,
      totalCorrect: 8,
      movesLearned: 5,
      streakDays: 3,
      level: 2,
      sessionCount: 4,
      repertoireCount: 1,
      masterStreak: 0,
      ttBestScore: 0,
      questsCompleted: 0,
      hasUploaded: true,
      earnedIds: new Set(['first_move'])
    });
    expect(stats.totalReviews).toBe(10);
    expect(stats.hasUploaded).toBe(true);
    expect(stats.earnedIds.has('first_move')).toBe(true);
  });

  it('handles zero values without throwing', () => {
    const stats = buildBadgeStats({
      totalReviews: 0,
      totalCorrect: 0,
      movesLearned: 0,
      streakDays: 0,
      level: 1,
      sessionCount: 0,
      repertoireCount: 0,
      masterStreak: 0,
      ttBestScore: 0,
      questsCompleted: 0,
      hasUploaded: false,
      earnedIds: new Set()
    });
    expect(stats.level).toBe(1);
  });
});
