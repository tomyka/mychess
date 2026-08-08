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
    return { session, profile, drillMoves: [] };
  }

  // Only the player's own moves are quizzed — the opponent's replies
  // (is_player_turn = false) are just context, not something to guess.
  // Paginated: an unbounded select across every one of a player's
  // repertoires at once can exceed PostgREST's max_rows (1000, see
  // supabase/config.toml), which truncates silently rather than erroring —
  // a player with several large repertoires would otherwise just lose
  // access to drilling moves past the cutoff with no indication why.
  const MOVES_PAGE_SIZE = 1000;
  const moves: any[] = [];
  for (let offset = 0; ; offset += MOVES_PAGE_SIZE) {
    const { data: page } = await supabase
      .from('moves')
      .select(`
        id, san, move_number,
        from_position(fen),
        to_position(fen),
        repertoire:repertoire_id(id, name, color)
      `)
      .in('repertoire_id', repIds)
      .eq('is_player_turn', true)
      .order('id', { ascending: true })
      .range(offset, offset + MOVES_PAGE_SIZE - 1);
    moves.push(...(page ?? []));
    if (!page || page.length < MOVES_PAGE_SIZE) break;
  }

  const { data: reviews } = await supabase
    .from('reviews')
    .select('move_id, state')
    .eq('player_id', user.id);

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
