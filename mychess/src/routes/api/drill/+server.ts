import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { chain } = (await request.json()) as { chain: number };

  // Record drill session
  await supabase.from('sessions').insert({
    player_id: user.id,
    mode: 'drill',
    cards_reviewed: chain
  });

  if (chain > 0) {
    await supabase.rpc('update_streak', { p_player_id: user.id });
  }

  // Update quest progress for drill_streak
  if (chain >= 5) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: quest } = await supabase
      .from('quests')
      .select('*')
      .eq('player_id', user.id)
      .eq('date', today)
      .eq('quest_id', 'drill_streak')
      .single();

    if (quest && !quest.completed) {
      const newProgress = Math.min(quest.progress + 1, quest.target);
      const nowComplete = newProgress >= quest.target;
      await supabase
        .from('quests')
        .update({ progress: newProgress, completed: nowComplete })
        .eq('id', quest.id);
    }
  }

  grantNewBadges(supabase, user.id).catch(() => {});

  return json({ ok: true });
};
