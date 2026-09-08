export interface QuestTemplate {
  id: string;
  description: string;
  target: number;
}

/**
 * The daily-task roster.
 *
 * Down to one entry: `time_trial`, `drill_streak` and `sessions` were removed
 * along with the `/drill` and `/time-trial` pages, whose endpoints were their
 * ONLY progress writers. Both pages had been unreachable — no nav entry, no
 * link, no `goto` — so those three templates could never advance, and because
 * the roster was sampled at random the dashboard showed a player two or three
 * impossible tasks most days.
 *
 * A template belongs here only if something reachable calls
 * `incrementQuestProgress` with its id.
 */
export const QUEST_TEMPLATES: QuestTemplate[] = [
  { id: 'review_cards',  description: 'Complete 10 Practice attempts today',       target: 10 },
];

/**
 * Today's quests for a player.
 *
 * Every template, deliberately: this used to shuffle the roster on a
 * `date:playerId` seed and take three of four, which existed purely to vary
 * which subset a player saw. With one earnable template that sampling could
 * only ever return that template, so it was doing no work — and if the roster
 * grows again, handing out all of it is both simpler and the behaviour a small
 * roster wants anyway.
 *
 * `date` and `playerId` are still taken so callers don't change and so a
 * future per-player roster has somewhere to hook in.
 */
export function selectDailyQuests(_date: string, _playerId: string): QuestTemplate[] {
  return [...QUEST_TEMPLATES];
}
