import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { newCard } from '$lib/srs/fsrs';
import type { Card } from '$lib/srs/fsrs';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user, session, profile } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: reps } = await supabase
    .from('repertoires')
    .select('id')
    .eq('kid_id', user.id);
  const repIds = reps?.map((r: any) => r.id) ?? [];

  if (repIds.length === 0) {
    return { session, profile, drillMoves: [] };
  }

  const { data: moves } = await supabase
    .from('moves')
    .select(`
      id, san, move_number,
      from_position(fen),
      to_position(fen),
      repertoire:repertoire_id(id, name, color)
    `)
    .in('repertoire_id', repIds);

  const { data: reviews } = await supabase
    .from('reviews')
    .select('move_id, state')
    .eq('kid_id', user.id);

  // Drill mode: only use Review-state cards (state === 2)
  const reviewedSet = new Set(
    (reviews ?? []).filter((r: any) => r.state === 2).map((r: any) => r.move_id)
  );

  const drillMoves = (moves ?? []).filter((m: any) => reviewedSet.has(m.id));

  // Shuffle for freshness
  for (let i = drillMoves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [drillMoves[i], drillMoves[j]] = [drillMoves[j], drillMoves[i]];
  }

  return { session, profile, drillMoves };
};
