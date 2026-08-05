import { describe, it, expect } from 'vitest';
import { checkBadgeEligibility } from './recalc';

describe('checkBadgeEligibility', () => {
  const base = {
    totalReviews: 0,
    totalCorrect: 0,
    movesLearned: 0,
    streakDays: 0,
    level: 1,
    sessionCount: 0,
    repertoireCount: 0,
    ttBestScore: 0,
    questsCompleted: 0,
    hasUploaded: false,
    earnedIds: new Set<string>()
  };

  it('grants first_move on first review', () => {
    const result = checkBadgeEligibility({ ...base, totalReviews: 1 });
    expect(result).toContain('first_move');
  });

  it('does not grant first_move if already earned', () => {
    const result = checkBadgeEligibility({ ...base, totalReviews: 1, earnedIds: new Set(['first_move']) });
    expect(result).not.toContain('first_move');
  });

  it('grants review_10 at 10 reviews', () => {
    const result = checkBadgeEligibility({ ...base, totalReviews: 10 });
    expect(result).toContain('review_10');
  });

  it('grants streak_7 at 7 streak days', () => {
    const result = checkBadgeEligibility({ ...base, streakDays: 7 });
    expect(result).toContain('streak_7');
  });

  it('grants level_3 at level 3', () => {
    const result = checkBadgeEligibility({ ...base, level: 3 });
    expect(result).toContain('level_3');
  });

  it('grants speed_demon at tt best score >= 10', () => {
    const result = checkBadgeEligibility({ ...base, ttBestScore: 10 });
    expect(result).toContain('speed_demon');
  });

  it('grants multi_repertoire at 2+ repertoires', () => {
    const result = checkBadgeEligibility({ ...base, repertoireCount: 2 });
    expect(result).toContain('multi_repertoire');
  });

  it('never grants streak_freeze_saved automatically', () => {
    const result = checkBadgeEligibility({ ...base, streakDays: 100 });
    expect(result).not.toContain('streak_freeze_saved');
  });

  it('returns empty array when no new badges earned', () => {
    const result = checkBadgeEligibility(base);
    expect(result).toHaveLength(0);
  });
});
