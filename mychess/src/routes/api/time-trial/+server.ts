import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { grantNewBadges } from '$lib/badges/grant';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, locals }) => {
  const { supabase } = locals;
  const user = await requireApiUser(locals);

  const { correct } = await request.json() as {
    correct: number;
  };

  const { error: sessionError } = await supabase.from('sessions').insert({
    player_id: user.id,
    mode: 'time_trial',
    cards_done: correct
  });
  // Logged, not swallowed. This insert had been failing since it was written —
  // `cards_reviewed` has never existed as a column (it is `cards_done`) — and
  // because nothing checked the error, `sessions` sat empty for months and the
  // session-count badges were unearnable. See #103.
  if (sessionError) {
    console.error('failed to record session:', sessionError.message);
  }

  if (correct > 0) {
    await supabase.rpc('update_streak', { p_player_id: user.id });
  }

  const today = new Date().toISOString().slice(0, 10);
  await incrementQuestProgress(supabase, user.id, 'sessions', today);
  if (correct >= 8) {
    await incrementQuestProgress(supabase, user.id, 'time_trial', today);
  }

  grantNewBadges(supabase, user.id, { ttScore: correct }).catch(() => {});

  return json({ ok: true });
};
