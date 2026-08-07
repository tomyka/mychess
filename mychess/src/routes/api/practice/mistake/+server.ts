// mychess/src/routes/api/practice/mistake/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyPreviousLevelMistake } from '$lib/server/level-progress';

/**
 * Called the instant a wrong move lands on the previous-level review band —
 * not batched until the attempt it's part of eventually completes, since a
 * player who keeps failing the same move and never gets it right would
 * otherwise never trigger a demotion no matter how many times they fail it.
 * Skipped entirely during review (read-only, no progress side effects).
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { repertoireId } = body ?? {};
	if (typeof repertoireId !== 'string') {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadRepertoireVariations(supabase, user.id, repertoireId);
	const result = await applyPreviousLevelMistake(supabase, user.id, repertoireId, variations);

	return json({ demoted: result?.demoted ?? false, level: result?.level ?? null });
};
