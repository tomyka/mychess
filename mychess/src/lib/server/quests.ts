// mychess/src/lib/server/quests.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectDailyQuests } from '$lib/quests/generate';

export type QuestRow = {
  id: string;
  player_id: string;
  date: string;
  quest_id: string;
  description: string;
  target: number;
  progress: number;
  completed: boolean;
};

/** Loads today's quests for a player, seeding them from the daily templates on first load. */
export async function ensureDailyQuests(
  supabase: SupabaseClient,
  playerId: string,
  date: string
): Promise<QuestRow[]> {
  const { data: existing } = await supabase
    .from('quests')
    .select('*')
    .eq('player_id', playerId)
    .eq('date', date);

  if (existing && existing.length > 0) return existing as QuestRow[];

  const templates = selectDailyQuests(date, playerId);
  const rows = templates.map((t) => ({
    player_id: playerId,
    date,
    quest_id: t.id,
    description: t.description,
    target: t.target,
    progress: 0,
    completed: false
  }));

  const { data: inserted } = await supabase.from('quests').insert(rows).select();
  return (inserted ?? []) as QuestRow[];
}

/** Adds `amount` to today's progress on `questId`, capped at target. No-op if the quest doesn't exist today or is already completed. */
export async function incrementQuestProgress(
  supabase: SupabaseClient,
  playerId: string,
  questId: string,
  date: string,
  amount = 1
): Promise<void> {
  const { data: quest } = await supabase
    .from('quests')
    .select('id, progress, target, completed')
    .eq('player_id', playerId)
    .eq('date', date)
    .eq('quest_id', questId)
    .single();

  if (!quest || quest.completed) return;

  const newProgress = Math.min(quest.progress + amount, quest.target);
  const nowComplete = newProgress >= quest.target;

  await supabase.from('quests').update({ progress: newProgress, completed: nowComplete }).eq('id', quest.id);
}
