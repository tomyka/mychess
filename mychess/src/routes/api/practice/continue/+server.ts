// mychess/src/routes/api/practice/continue/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { continueFromBranch } from '$lib/mastery/practice';
import { requireApiUser } from '$lib/server/auth';

/**
 * Resumes a specific line after a mid-line branch alternative was taken
 * during Practice — see `continueFromBranch` for the resolution logic.
 * Read-only: doesn't touch level_progress. The eventual credit only lands
 * via the existing /api/practice/attempt call once the continuation is
 * actually solved to its end.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, level, variationKey, afterPlayerMoveIndex } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof level !== 'number' ||
		typeof variationKey !== 'string' ||
		typeof afterPlayerMoveIndex !== 'number'
	) {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const result = continueFromBranch(variations, level, variationKey, afterPlayerMoveIndex);
	if (!result) throw error(404, 'Continuation not found');

	return json(result);
};
