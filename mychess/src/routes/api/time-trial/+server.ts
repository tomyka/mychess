import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { correct, sessionXp, bonus } = await request.json() as {
    correct: number;
    sessionXp: number;
    bonus: number;
  };

  await supabase.from('sessions').insert({
    player_id: user.id,
    mode: 'time_trial',
    cards_reviewed: correct,
    xp_earned: sessionXp
  });

  if (sessionXp > 0) {
    await supabase.rpc('update_xp_and_level', {
      p_user_id: user.id,
      p_xp_delta: sessionXp
    });
    await supabase.rpc('update_weekly_leaderboard', {
      p_player_id: user.id,
      p_xp: sessionXp
    });
    await supabase.rpc('update_streak', { p_user_id: user.id });
  }

  // Update quest progress for time_trial
  if (correct >= 8) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: quest } = await supabase
      .from('quests')
      .select('*')
      .eq('player_id', user.id)
      .eq('date', today)
      .eq('quest_id', 'time_trial')
      .single();

    if (quest && !quest.completed) {
      const newProgress = Math.min(quest.progress + 1, quest.target);
      const nowComplete = newProgress >= quest.target;
      await supabase
        .from('quests')
        .update({ progress: newProgress, completed: nowComplete })
        .eq('id', quest.id);

      if (nowComplete) {
        await supabase.rpc('update_xp_and_level', {
          p_user_id: user.id,
          p_xp_delta: quest.xp_reward
        });
      }
    }
  }

  grantNewBadges(supabase, user.id, { ttBestScore: correct }).catch(() => {});

  return json({ ok: true });
};
