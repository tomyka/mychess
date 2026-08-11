// mychess/src/routes/api/practice/mistake/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyPreviousLevelMistake } from '$lib/server/level-progress';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';

/**
 * Called the instant a wrong move lands on the previous-level review band —
 * not batched until the attempt it's part of eventually completes, since a
 * player who keeps failing the same move and never gets it right would
 * otherwise never trigger a demotion no matter how many times they fail it.
 * Skipped entirely during review (read-only, no progress side effects).
 * Only builds a full `PracticeView` on the (rare) demoted case — most wrong
 * moves don't demote and there's nothing for the client to update then, so
 * building one on every miss would be pure waste.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId } = body ?? {};
	if (typeof repertoireId !== 'string') {
		throw error(400, 'Invalid request');
	}

	const { repertoire, variations } = await loadRepertoireVariations(supabase, user.id, repertoireId);
	const maxLevel = repertoire.practiceDepthLevels;
	const result = await applyPreviousLevelMistake(supabase, user.id, repertoireId, variations, maxLevel);

	if (!result || !result.demoted) return json({ demoted: false });
	return json({ demoted: true, view: buildPracticeView(variations, result.row, null, maxLevel) });
};
