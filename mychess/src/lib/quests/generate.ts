export interface QuestTemplate {
  id: string;
  description: string;
  target: number;
  xpReward: number;
}

export const QUEST_TEMPLATES: QuestTemplate[] = [
  { id: 'review_cards', description: 'Review 10 cards today',              target: 10, xpReward: 50 },
  { id: 'new_cards',    description: 'Learn 5 new moves today',            target: 5,  xpReward: 60 },
  { id: 'drill_streak', description: 'Get a 5-move Drill chain',           target: 5,  xpReward: 70 },
  { id: 'time_trial',   description: 'Score 8+ in Time Trial',             target: 8,  xpReward: 80 },
  { id: 'sessions',     description: 'Complete 2 training sessions today', target: 2,  xpReward: 40 },
];

/** Deterministic LCG shuffle seeded on date + kidId string */
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    hash = ((hash * 1664525) + 1013904223) | 0;
    const j = Math.abs(hash) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Select 3 quests for the given date + kid. Deterministic. */
export function selectDailyQuests(date: string, kidId: string): QuestTemplate[] {
  const seed = `${date}:${kidId}`;
  return seededShuffle(QUEST_TEMPLATES, seed).slice(0, 3);
}
