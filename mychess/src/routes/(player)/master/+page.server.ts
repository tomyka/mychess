import type { PageServerLoad } from './$types';
import { ensureGuestSession } from '$lib/server/auth';
import { mergeRepertoireIds, buildBookMoveMap } from '$lib/repertoire';

export const load: PageServerLoad = async ({ locals }) => {
  const guest = await ensureGuestSession(locals);
  if (!guest) return { needsAccount: true };
  const { user, session, profile } = guest;
  if (!user) return { needsAccount: true };
  const supabase = locals.supabase;

  const [{ data: ownReps }, { data: assigned }] = await Promise.all([
    supabase.from('repertoires').select('id').eq('player_id', user.id),
    supabase.from('assigned_repertoires').select('repertoire_id').eq('player_id', user.id)
  ]);
  const repIds = mergeRepertoireIds(
    ownReps?.map((r: any) => r.id) ?? [],
    assigned?.map((a: any) => a.repertoire_id) ?? []
  );

  if (repIds.length === 0) {
    return { session, profile, masterMoves: [], bookMoveMap: {} };
  }

  // Master's pool is every player-turn move across every repertoire the
  // player owns or is assigned — no reviews.state filter (that flag hasn't
  // been written since Learn mode was removed, so on the old Drill route it
  // only ever froze the queue rather than growing it). Only the player's
  // own moves are quizzed — the opponent's replies (is_player_turn = false)
  // are just context, not something to guess.
  const { data: moves } = await supabase
    .from('moves')
    .select(
      `
      id, san, from_position,
      from_pos:from_position(fen),
      repertoire:repertoire_id(id, name, color)
    `
    )
    .in('repertoire_id', repIds)
    .eq('is_player_turn', true);

  const allMoves = moves ?? [];
  const bookMoveMap = buildBookMoveMap(allMoves as any);

  // Shuffle for freshness.
  const masterMoves = [...allMoves];
  for (let i = masterMoves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [masterMoves[i], masterMoves[j]] = [masterMoves[j], masterMoves[i]];
  }

  return { session, profile, masterMoves, bookMoveMap };
};
