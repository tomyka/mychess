export interface BadgeStats {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  level: number;
  sessionCount: number;
  repertoireCount: number;
  drillStreak: number;
  ttBestScore: number;
  questsCompleted: number;
  hasUploaded: boolean;
  earnedIds: Set<string>;
}

interface BadgeRule {
  id: string;
  check: (s: BadgeStats) => boolean;
}

const RULES: BadgeRule[] = [
  // First-time
  { id: 'first_move',          check: s => s.totalReviews >= 1 },
  { id: 'first_repertoire',    check: s => s.repertoireCount >= 1 },
  { id: 'first_streak_3',      check: s => s.streakDays >= 3 },
  { id: 'first_drill',         check: s => s.drillStreak >= 1 },
  { id: 'first_time_trial',    check: s => s.ttBestScore >= 1 },
  // Streak
  { id: 'streak_7',            check: s => s.streakDays >= 7 },
  { id: 'streak_30',           check: s => s.streakDays >= 30 },
  { id: 'streak_100',          check: s => s.streakDays >= 100 },
  // streak_freeze_saved is granted manually only
  { id: 'streak_freeze_saved', check: _s => false },
  // Review volume
  { id: 'review_10',           check: s => s.totalReviews >= 10 },
  { id: 'review_100',          check: s => s.totalReviews >= 100 },
  { id: 'review_500',          check: s => s.totalReviews >= 500 },
  { id: 'review_1000',         check: s => s.totalReviews >= 1000 },
  // Mastery
  { id: 'moves_learned_10',    check: s => s.movesLearned >= 10 },
  { id: 'moves_learned_50',    check: s => s.movesLearned >= 50 },
  { id: 'moves_learned_100',   check: s => s.movesLearned >= 100 },
  // Level
  { id: 'level_3',             check: s => s.level >= 3 },
  { id: 'level_5',             check: s => s.level >= 5 },
  { id: 'level_10',            check: s => s.level >= 10 },
  // Time Trial
  { id: 'speed_demon',         check: s => s.ttBestScore >= 10 },
  { id: 'speed_legend',        check: s => s.ttBestScore >= 20 },
  // Drill
  { id: 'drill_chain_5',       check: s => s.drillStreak >= 5 },
  { id: 'drill_chain_10',      check: s => s.drillStreak >= 10 },
  { id: 'drill_chain_20',      check: s => s.drillStreak >= 20 },
  { id: 'drill_ace',           check: s => s.drillStreak >= 10 },
  // Sessions
  { id: 'sessions_10',         check: s => s.sessionCount >= 10 },
  { id: 'sessions_50',         check: s => s.sessionCount >= 50 },
  // Exploration
  { id: 'uploader',            check: s => s.hasUploaded },
  { id: 'multi_repertoire',    check: s => s.repertoireCount >= 2 },
  // Quests
  { id: 'quest_master',        check: s => s.questsCompleted >= 10 },
];

/** Returns badge IDs that should be granted (not already in earnedIds). */
export function checkBadgeEligibility(stats: BadgeStats): string[] {
  return RULES
    .filter(r => !stats.earnedIds.has(r.id) && r.check(stats))
    .map(r => r.id);
}
