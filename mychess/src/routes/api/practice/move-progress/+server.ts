import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markMoveCorrect } from '$lib/server/move-progress';

/**
 * Called the instant a move is played CORRECTLY (in Practice's interactive
 * range) — grading is per-move, not per-attempt. A move flips 'new' ->
 * 'correct' immediately and stays that way.
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { moveId } = await request.json();
  if (!moveId || typeof moveId !== 'string') {
    throw error(400, 'Invalid request');
  }

  const { error: progressError } = await markMoveCorrect(supabase, user.id, moveId);
  if (progressError) throw error(500, progressError);

  return json({ ok: true });
};
