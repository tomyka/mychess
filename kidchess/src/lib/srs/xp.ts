// XP constants
const XP_CORRECT_FIRST_TRY = 10;
const XP_WITH_HINT = 5;
const XP_WRONG_PENALTY = 2;

// Fixed level thresholds up to level 5
const FIXED_THRESHOLDS = [0, 100, 250, 500, 1000];

/** XP earned for a single card review */
export function xpForReview(wasCorrect: boolean, usedHint: boolean): number {
  if (wasCorrect && !usedHint) return XP_CORRECT_FIRST_TRY;
  if (wasCorrect && usedHint) return XP_WITH_HINT;
  return -XP_WRONG_PENALTY;
}

/** Cumulative XP needed to *reach* a given level (0-indexed: level 1 requires FIXED_THRESHOLDS[1]) */
export function xpForLevel(level: number): number {
  if (level <= 0) return 0;
  if (level < FIXED_THRESHOLDS.length) return FIXED_THRESHOLDS[level];

  // Beyond level 5: each level is 1.6x the previous, rounded to nearest 50
  let prev = FIXED_THRESHOLDS[FIXED_THRESHOLDS.length - 1];
  for (let i = FIXED_THRESHOLDS.length; i <= level; i++) {
    prev = Math.round((prev * 1.6) / 50) * 50;
  }
  return prev;
}

/** Given total XP, return { level, xpInLevel, xpToNextLevel } */
export function levelFromXp(totalXp: number): {
  level: number;
  xpInLevel: number;
  xpToNextLevel: number;
} {
  let level = 0;
  while (xpForLevel(level + 1) <= totalXp) level++;

  const xpInLevel = totalXp - xpForLevel(level);
  const xpToNextLevel = xpForLevel(level + 1) - xpForLevel(level);
  return { level, xpInLevel, xpToNextLevel };
}

/** Check streak survival: returns whether streak is preserved today */
export function isStreakAlive(
  lastTrainedAt: Date | null,
  now: Date = new Date()
): 'alive' | 'frozen_needed' | 'dead' {
  if (!lastTrainedAt) return 'dead';
  const msPerDay = 86400000;
  const daysDiff = Math.floor((now.getTime() - lastTrainedAt.getTime()) / msPerDay);
  if (daysDiff <= 1) return 'alive';
  if (daysDiff === 2) return 'frozen_needed';
  return 'dead';
}
