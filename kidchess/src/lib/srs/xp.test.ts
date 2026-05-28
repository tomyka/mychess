import { describe, it, expect } from 'vitest';
import { xpForReview, xpForLevel, levelFromXp, isStreakAlive } from '$lib/srs/xp';

describe('xpForReview', () => {
  it('returns 10 for correct first try', () => {
    expect(xpForReview(true, false)).toBe(10);
  });
  it('returns 5 for correct with hint', () => {
    expect(xpForReview(true, true)).toBe(5);
  });
  it('returns -2 for wrong', () => {
    expect(xpForReview(false, false)).toBe(-2);
  });
});

// FIXED_THRESHOLDS = [0, 100, 250, 500, 1000]
// Indices:             0    1    2    3    4
// So level 4 needs 1000 XP, level 5 needs ~1600
describe('xpForLevel', () => {
  it('level 0 = 0', () => expect(xpForLevel(0)).toBe(0));
  it('level 1 = 100', () => expect(xpForLevel(1)).toBe(100));
  it('level 4 = 1000', () => expect(xpForLevel(4)).toBe(1000));
  it('level 5 > level 4', () => expect(xpForLevel(5)).toBeGreaterThan(1000));
  it('level 5 is 1600 (1000*1.6 rounded to 50)', () => expect(xpForLevel(5)).toBe(1600));
});

describe('levelFromXp', () => {
  it('0 xp = level 0', () => {
    const r = levelFromXp(0);
    expect(r.level).toBe(0);
  });
  it('100 xp = level 1', () => {
    const r = levelFromXp(100);
    expect(r.level).toBe(1);
  });
  it('500 xp = level 3', () => {
    const r = levelFromXp(500);
    expect(r.level).toBe(3);
  });
  it('1000 xp = level 4', () => {
    const r = levelFromXp(1000);
    expect(r.level).toBe(4);
  });
  it('xpInLevel + xpForLevel(level) = totalXp', () => {
    const totalXp = 350;
    const r = levelFromXp(totalXp);
    expect(r.xpInLevel + xpForLevel(r.level)).toBe(totalXp);
  });
});

describe('isStreakAlive', () => {
  it('null lastTrainedAt = dead', () => {
    expect(isStreakAlive(null)).toBe('dead');
  });
  it('trained today = alive', () => {
    expect(isStreakAlive(new Date())).toBe('alive');
  });
  it('trained yesterday = alive', () => {
    const yesterday = new Date(Date.now() - 86400000);
    expect(isStreakAlive(yesterday)).toBe('alive');
  });
  it('trained 2 days ago = frozen_needed', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    expect(isStreakAlive(twoDaysAgo)).toBe('frozen_needed');
  });
  it('trained 3 days ago = dead', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    expect(isStreakAlive(threeDaysAgo)).toBe('dead');
  });
});
