import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { selectDailyQuests } from '$lib/quests/generate';

export const GET: RequestHandler = async ({ locals }) => {
  const { supabase } = locals;
  const { user: authUser } = await locals.safeGetSession();
  if (!authUser) throw error(401, 'Unauthorized');

  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from('quests')
    .select('*')
    .eq('player_id', authUser.id)
    .eq('date', today);

  if (existing && existing.length > 0) {
    return json({ quests: existing });
  }

  const templates = selectDailyQuests(today, authUser.id);
  const rows = templates.map(t => ({
    player_id: authUser.id,
    date: today,
    quest_id: t.id,
    description: t.description,
    target: t.target,
    progress: 0,
    xp_reward: t.xpReward,
    completed: false
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from('quests')
    .insert(rows)
    .select();

  if (insertErr) throw error(500, insertErr.message);
  return json({ quests: inserted });
};
