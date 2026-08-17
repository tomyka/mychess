import { describe, it, expect } from 'vitest';
import { checkBadgeEligibility } from './recalc';

describe('checkBadgeEligibility', () => {
  const base = {
    totalReviews: 0,
    totalCorrect: 0,
    movesLearned: 0,
    streakDays: 0,
    sessionCount: 0,
    repertoireCount: 0,
    ttScore: 0,
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

  it('grants speed_demon at tt best score >= 10', () => {
    const result = checkBadgeEligibility({ ...base, ttScore: 10 });
    expect(result).toContain('speed_demon');
  });

  it('grants multi_repertoire at 2+ repertoires', () => {
    const result = checkBadgeEligibility({ ...base, repertoireCount: 2 });
    expect(result).toContain('multi_repertoire');
  });

  it('does not offer streak_freeze_saved at all — it has no grant path, so it is not in the roster', () => {
    // It previously sat in RULES as `check: () => false` ("granted manually
    // only"), but nothing anywhere granted it, so it was permanently
    // unearnable while still being shown to players. Removed from both the
    // rules and the badges catalog (migration 0053). This assertion still
    // holds for the same observable reason — nobody can earn it — but now
    // because it isn't offered, rather than because it silently always fails.
    const result = checkBadgeEligibility({ ...base, streakDays: 100 });
    expect(result).not.toContain('streak_freeze_saved');
  });

  it('returns empty array when no new badges earned', () => {
    const result = checkBadgeEligibility(base);
    expect(result).toHaveLength(0);
  });
});
