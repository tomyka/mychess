import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const user = await requireApiUser(locals);

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

  const today = new Date().toISOString().slice(0, 10);
  await incrementQuestProgress(supabase, user.id, 'sessions', today);
  if (chain >= 5) {
    await incrementQuestProgress(supabase, user.id, 'drill_streak', today);
  }

  grantNewBadges(supabase, user.id).catch(() => {});

  return json({ ok: true });
};
