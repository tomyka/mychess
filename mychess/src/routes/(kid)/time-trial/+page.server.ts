import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: reps } = await supabase
    .from('repertoires')
    .select('id')
    .eq('kid_id', user.id);
  const repIds = reps?.map((r: any) => r.id) ?? [];

  if (repIds.length === 0) {
    return { session, profile, trialMoves: [] };
  }

  const { data: moves } = await supabase
    .from('moves')
    .select(`
      id, san,
      from_position(fen),
      to_position(fen)
    `)
    .in('repertoire_id', repIds);

  // Shuffle for variety
  const shuffled = [...(moves ?? [])];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return { session, profile, trialMoves: shuffled };
};
