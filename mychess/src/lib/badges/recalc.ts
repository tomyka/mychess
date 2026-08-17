export interface BadgeStats {
  totalReviews: number;
  totalCorrect: number;
  movesLearned: number;
  streakDays: number;
  sessionCount: number;
  repertoireCount: number;
  ttScore: number;
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
  { id: 'first_time_trial',    check: s => s.ttScore >= 1 },
  // Streak
  { id: 'streak_7',            check: s => s.streakDays >= 7 },
  { id: 'streak_30',           check: s => s.streakDays >= 30 },
  { id: 'streak_100',          check: s => s.streakDays >= 100 },
  // `streak_freeze_saved` used to sit here as `check: () => false`, described
  // as "granted manually only" — but no manual path ever existed (no cron, no
  // admin action, no streak-freeze feature), so it was unearnable by anyone
  // while still being listed to players by the badges page, which renders the
  // whole `badges` catalog table. Rule and catalog row both removed (see
  // migration 0053); re-add both together if a real streak-freeze feature
  // ships.
  // Review volume
  { id: 'review_10',           check: s => s.totalReviews >= 10 },
  { id: 'review_100',          check: s => s.totalReviews >= 100 },
  { id: 'review_500',          check: s => s.totalReviews >= 500 },
  { id: 'review_1000',         check: s => s.totalReviews >= 1000 },
  // Mastery
  { id: 'moves_learned_10',    check: s => s.movesLearned >= 10 },
  { id: 'moves_learned_50',    check: s => s.movesLearned >= 50 },
  { id: 'moves_learned_100',   check: s => s.movesLearned >= 100 },
  // Time Trial
  { id: 'speed_demon',         check: s => s.ttScore >= 10 },
  { id: 'speed_legend',        check: s => s.ttScore >= 20 },
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
