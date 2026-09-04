import { describe, it, expect } from 'vitest';
import { checkBadgeEligibility, checkBadgeRevocations, REVOCABLE_BADGE_IDS } from './recalc';

describe('checkBadgeEligibility', () => {
  const base = {
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

describe('epic #95 repertoire badges', () => {
  const base = {
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
    earnedIds: new Set<string>()
  };

  it('grants the first-learned badge on the first fully-learned repertoire', () => {
    expect(checkBadgeEligibility({ ...base, repertoiresLearned: 1 })).toContain('first_repertoire_learned');
    expect(checkBadgeEligibility({ ...base, repertoiresLearned: 1 })).not.toContain('repertoires_learned_5');
  });

  it('grants the five-learned tier at five', () => {
    expect(checkBadgeEligibility({ ...base, repertoiresLearned: 5 })).toContain('repertoires_learned_5');
  });

  it('grants mastery badges independently of learned ones', () => {
    const result = checkBadgeEligibility({ ...base, repertoiresLearned: 5, repertoiresMastered: 1 });
    expect(result).toContain('first_repertoire_mastered');
    expect(result).not.toContain('repertoires_mastered_5');
  });
});

describe('checkBadgeRevocations', () => {
  const base = {
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
    earnedIds: new Set<string>()
  };

  // The product owner's explicit decision: losing the status loses the badge.
  it('revokes a mastery badge once the repertoire is no longer mastered', () => {
    const result = checkBadgeRevocations({
      ...base,
      repertoiresMastered: 0,
      earnedIds: new Set(['first_repertoire_mastered'])
    });
    expect(result).toEqual(['first_repertoire_mastered']);
  });

  it('recomputes a count tier downward', () => {
    const result = checkBadgeRevocations({
      ...base,
      repertoiresMastered: 4,
      earnedIds: new Set(['first_repertoire_mastered', 'repertoires_mastered_5'])
    });
    expect(result).toEqual(['repertoires_mastered_5']);
  });

  it('revokes nothing while the badge still holds', () => {
    expect(
      checkBadgeRevocations({ ...base, repertoiresLearned: 2, earnedIds: new Set(['first_repertoire_learned']) })
    ).toEqual([]);
  });

  it('revokes nothing that was never earned', () => {
    expect(checkBadgeRevocations({ ...base, earnedIds: new Set() })).toEqual([]);
  });

  // The guard that matters: a streak badge must never be taken back, however
  // far the streak has fallen. Only the four epic-#95 ids are revocable.
  it('never revokes a non-revocable badge, even when its rule no longer holds', () => {
    const result = checkBadgeRevocations({
      ...base,
      streakDays: 0,
      totalReviews: 0,
      earnedIds: new Set(['streak_7', 'streak_100', 'review_1000', 'first_move'])
    });
    expect(result).toEqual([]);
  });

  it('keeps the revocable set to exactly the four epic badges', () => {
    expect([...REVOCABLE_BADGE_IDS].sort()).toEqual([
      'first_repertoire_learned',
      'first_repertoire_mastered',
      'repertoires_learned_5',
      'repertoires_mastered_5'
    ]);
  });
});
