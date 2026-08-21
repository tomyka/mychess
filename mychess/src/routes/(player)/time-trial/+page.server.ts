import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const { user, session, profile } = await requireAccount(locals);
  const supabase = locals.supabase;

  const { data: reps } = await supabase
    .from('repertoires')
    .select('id')
    .eq('player_id', user!.id);
  const repIds = reps?.map((r: any) => r.id) ?? [];

  if (repIds.length === 0) {
    return { session, profile, trialMoves: [] };
  }

  // Only the player's own moves are quizzed — the opponent's replies
  // (is_player_turn = false) are just context, not something to guess.
  // Paginated: an unbounded select across every one of a player's
  // repertoires at once can exceed PostgREST's max_rows (1000, see
  // supabase/config.toml), which truncates silently rather than erroring —
  // a player with several large repertoires would otherwise just lose
  // access to time-trial moves past the cutoff with no indication why.
  const MOVES_PAGE_SIZE = 1000;
  const moves: any[] = [];
  for (let offset = 0; ; offset += MOVES_PAGE_SIZE) {
    const { data: page } = await supabase
      .from('moves')
      .select(`
        id, san,
        from_position(fen),
        to_position(fen)
      `)
      .in('repertoire_id', repIds)
      .eq('is_player_turn', true)
      // Retired moves are lines a coach removed on a repertoire re-upload; the
      // rows survive only so restoring the line restores its review/attempt
      // history, so they must never come back for time-trial.
      .is('retired_at', null)
      .order('id', { ascending: true })
      .range(offset, offset + MOVES_PAGE_SIZE - 1);
    moves.push(...(page ?? []));
    if (!page || page.length < MOVES_PAGE_SIZE) break;
  }

  // Shuffle for variety
  const shuffled = [...(moves ?? [])];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return { session, profile, trialMoves: shuffled };
};
