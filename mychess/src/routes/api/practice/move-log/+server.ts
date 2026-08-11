// mychess/src/routes/api/practice/move-log/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

/**
 * Fire-and-forget log of a single move resolution during Practice (correct
 * or wrong, including during review) — every move, not just ones that
 * affect level_progress. Purely additive: doesn't touch level_progress or
 * either of its sibling endpoints (api/practice/attempt, api/practice/mistake).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, moveId, playedSan, isCorrect, level } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof moveId !== 'string' ||
		typeof playedSan !== 'string' ||
		typeof isCorrect !== 'boolean' ||
		typeof level !== 'number'
	) {
		throw error(400, 'Invalid request');
	}

	const { error: insertError } = await supabase.from('move_attempts').insert({
		player_id: user.id,
		repertoire_id: repertoireId,
		move_id: moveId,
		played_san: playedSan,
		is_correct: isCorrect,
		level
	});
	if (insertError) throw error(500, insertError.message);

	return json({ ok: true });
};
