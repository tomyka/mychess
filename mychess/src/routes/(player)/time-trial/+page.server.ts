import type { PageServerLoad } from './$types';
import { ensureGuestSession } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const guest = await ensureGuestSession(locals);
  if (!guest) return { needsAccount: true };
  const { user, session, profile } = guest;
  if (!user) return { needsAccount: true };
  const supabase = locals.supabase;

  const { data: reps } = await supabase
    .from('repertoires')
    .select('id')
    .eq('player_id', user.id);
  const repIds = reps?.map((r: any) => r.id) ?? [];

  if (repIds.length === 0) {
    return { session, profile, trialMoves: [] };
  }

  // Only the player's own moves are quizzed — the opponent's replies
  // (is_player_turn = false) are just context, not something to guess.
  const { data: moves } = await supabase
    .from('moves')
    .select(`
      id, san,
      from_position(fen),
      to_position(fen)
    `)
    .in('repertoire_id', repIds)
    .eq('is_player_turn', true);

  // Shuffle for variety
  const shuffled = [...(moves ?? [])];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return { session, profile, trialMoves: shuffled };
};
