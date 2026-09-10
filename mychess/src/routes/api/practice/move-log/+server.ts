// mychess/src/routes/api/practice/move-log/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

/**
 * Fire-and-forget log of a single move resolution during Practice (correct
 * or wrong). Purely additive: doesn't touch practice_active_variation or
 * variation_solved.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, moveId, playedSan, isCorrect } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof moveId !== 'string' ||
		typeof playedSan !== 'string' ||
		typeof isCorrect !== 'boolean'
	) {
		throw error(400, 'Invalid request');
	}

	// Deliberately does NOT filter `retired_at`. This check's invariant is
	// narrow — "does this move id belong to this repertoire" — and a retired
	// move still does. Filtering it here would 404 every move a student logs
	// while finishing a session that was already in flight when their coach
	// reshaped the repertoire, and a session in flight is meant to complete
	// against the material it loaded. The log is
	// additive history, so recording an attempt against a line that has since
	// been retired is a true statement about what happened.
	const { data: move } = await supabase
		.from('moves')
		.select('id')
		.eq('id', moveId)
		.eq('repertoire_id', repertoireId)
		.maybeSingle();
	if (!move) throw error(404, 'Move not found');

	const { error: insertError } = await supabase.from('move_attempts').insert({
		player_id: user.id,
		repertoire_id: repertoireId,
		move_id: moveId,
		played_san: playedSan,
		is_correct: isCorrect
	});
	if (insertError) throw error(500, insertError.message);

	return json({ ok: true });
};
