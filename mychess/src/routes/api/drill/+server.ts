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
  const { error: sessionError } = await supabase.from('sessions').insert({
    player_id: user.id,
    mode: 'drill',
    cards_done: chain
  });
  // Logged, not swallowed. This insert had been failing since it was written —
  // `cards_reviewed` has never existed as a column (it is `cards_done`) — and
  // because nothing checked the error, `sessions` sat empty for months and the
  // session-count badges were unearnable. See #103.
  if (sessionError) {
    console.error('failed to record session:', sessionError.message);
  }

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
