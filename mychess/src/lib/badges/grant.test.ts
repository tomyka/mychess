import { describe, it, expect } from 'vitest';
import { buildBadgeStats } from './grant';

describe('buildBadgeStats', () => {
  it('maps DB rows to BadgeStats correctly', () => {
    const stats = buildBadgeStats({
      totalReviews: 10,
      totalCorrect: 8,
      movesLearned: 5,
      streakDays: 3,
      sessionCount: 4,
      repertoireCount: 1,
      questsCompleted: 0,
      hasUploaded: true,
    repertoiresLearned: 0,
    repertoiresMastered: 0,
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
      sessionCount: 0,
      repertoireCount: 0,
      questsCompleted: 0,
      hasUploaded: false,
    repertoiresLearned: 0,
    repertoiresMastered: 0,
      earnedIds: new Set()
    });
    expect(stats.streakDays).toBe(0);
  });
});
