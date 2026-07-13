import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { xpForReview } from '$lib/srs/xp';
import { markMoveCorrect } from '$lib/server/move-progress';

/**
 * Called the instant a move is played CORRECTLY (in Practice's interactive
 * range) — grading is per-move, not per-attempt. A move flips 'new' ->
 * 'correct' immediately and stays that way; XP is awarded only on the
 * transition itself (xpForReview(true, false) once per move that newly
 * becomes 'correct') — replaying an already-solved move (e.g. re-quizzing a
 * shared prefix from a later attempt) earns no further XP.
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { moveId } = await request.json();
  if (!moveId || typeof moveId !== 'string') {
    throw error(400, 'Invalid request');
  }

  const { alreadyCorrect, error: progressError } = await markMoveCorrect(supabase, user.id, moveId);
  if (progressError) throw error(500, progressError);

  const xpAwarded = alreadyCorrect ? 0 : xpForReview(true, false);
  if (xpAwarded > 0) {
    const { error: rpcError } = await supabase.rpc('update_xp_and_level', {
      p_player_id: user.id,
      p_xp_delta: xpAwarded
    });
    if (rpcError) throw error(500, rpcError.message);
  }

  return json({ xpAwarded });
};
