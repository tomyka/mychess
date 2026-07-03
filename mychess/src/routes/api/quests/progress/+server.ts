import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user: authUser } = await locals.safeGetSession();
  if (!authUser) throw error(401, 'Unauthorized');

  const body = await request.json();
  const { questId, increment = 1 } = body as { questId: string; increment?: number };

  const today = new Date().toISOString().slice(0, 10);

  const { data: quest } = await supabase
    .from('quests')
    .select('*')
    .eq('player_id', authUser.id)
    .eq('date', today)
    .eq('quest_id', questId)
    .single();

  if (!quest || quest.completed) {
    return json({ updated: false });
  }

  const newProgress = Math.min(quest.progress + increment, quest.target);
  const nowComplete = newProgress >= quest.target;

  const { error: updateErr } = await supabase
    .from('quests')
    .update({ progress: newProgress, completed: nowComplete })
    .eq('id', quest.id);

  if (updateErr) throw error(500, updateErr.message);

  if (nowComplete && !quest.completed) {
    await supabase.rpc('update_xp_and_level', {
      p_player_id: authUser.id,
      p_xp_delta: quest.xp_reward
    });
    await supabase.rpc('update_weekly_leaderboard', {
      p_player_id: authUser.id,
      p_xp: quest.xp_reward
    });
  }

  return json({ updated: true, completed: nowComplete, progress: newProgress });
};
