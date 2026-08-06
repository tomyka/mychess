import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Flips a move's `move_progress` row to `'correct'` (idempotent — calling
 * this again on an already-correct move is a no-op past the first time).
 * Returns whether it was ALREADY `'correct'` before this call, so callers
 * that only care about the new -> correct transition can distinguish it
 * from a no-op replay. Also returns `error` (matching this codebase's
 * `src/lib/server/*` convention, e.g. `pgn-import.ts`/`coach-players.ts`)
 * so callers can detect a failed write instead of silently assuming success.
 */
export async function markMoveCorrect(
	supabase: SupabaseClient,
	playerId: string,
	moveId: string
): Promise<{ alreadyCorrect: boolean; error: string | null }> {
	const { data: existing, error: selectError } = await supabase
		.from('move_progress')
		.select('state')
		.eq('player_id', playerId)
		.eq('move_id', moveId)
		.maybeSingle();

	if (selectError) return { alreadyCorrect: false, error: selectError.message };

	const alreadyCorrect = existing?.state === 'correct';

	const { error: upsertError } = await supabase
		.from('move_progress')
		.upsert({ player_id: playerId, move_id: moveId, state: 'correct' }, { onConflict: 'player_id,move_id' });

	if (upsertError) return { alreadyCorrect, error: upsertError.message };

	return { alreadyCorrect, error: null };
}
