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
  /** Repertoires where every non-excluded variation is learned (epic #95). */
  repertoiresLearned: number;
  /** Repertoires where every chapter additionally holds current mastery. */
  repertoiresMastered: number;
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
  // Epic #95. Unlike every other rule here, these four are REVOCABLE — see
  // REVOCABLE_BADGE_IDS below.
  { id: 'first_repertoire_learned',  check: s => s.repertoiresLearned >= 1 },
  { id: 'repertoires_learned_5',     check: s => s.repertoiresLearned >= 5 },
  { id: 'first_repertoire_mastered', check: s => s.repertoiresMastered >= 1 },
  { id: 'repertoires_mastered_5',    check: s => s.repertoiresMastered >= 5 }
];


/** Returns badge IDs that should be granted (not already in earnedIds). */
/**
 * The only badges that can be taken away.
 *
 * Every other rule here keys off a monotonic-in-practice counter, and a player
 * who once had a 7-day streak keeps `streak_7` even after breaking it —
 * revoking those would be a behaviour change nobody asked for. These four track
 * CURRENT state instead: a repertoire drops out of Learned when a coach adds
 * material or a line is demoted, and out of Mastered when either happens. The
 * product owner decided explicitly that losing the status loses the badge, so
 * the count tiers recompute downward too — 5 mastered repertoires falling to 4
 * removes `repertoires_mastered_5`.
 */
export const REVOCABLE_BADGE_IDS = new Set([
  'first_repertoire_learned',
  'repertoires_learned_5',
  'first_repertoire_mastered',
  'repertoires_mastered_5'
]);

/**
 * Earned badges that no longer hold. Deliberately narrow: only ids in
 * REVOCABLE_BADGE_IDS are ever returned, so a future rule cannot start silently
 * stripping badges by being added to RULES.
 */
export function checkBadgeRevocations(stats: BadgeStats): string[] {
  return RULES
    .filter(r => REVOCABLE_BADGE_IDS.has(r.id) && stats.earnedIds.has(r.id) && !r.check(stats))
    .map(r => r.id);
}

export function checkBadgeEligibility(stats: BadgeStats): string[] {
  return RULES
    .filter(r => !stats.earnedIds.has(r.id) && r.check(stats))
    .map(r => r.id);
}
