// mychess/src/routes/api/practice/attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyAttemptResult } from '$lib/server/level-progress';

/**
 * Called once per completed Practice attempt (not per move — see
 * docs/superpowers/specs/2026-08-07-level-gauntlet-mastery-design.md).
 * Skipped entirely during review (read-only, no progress side effects).
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { repertoireId, taskKey, hadMistake } = body ?? {};
	if (typeof repertoireId !== 'string' || typeof taskKey !== 'string' || typeof hadMistake !== 'boolean') {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadRepertoireVariations(supabase, user.id, repertoireId);
	await applyAttemptResult(supabase, user.id, repertoireId, { taskKey, hadMistake }, variations);

	return json({ ok: true });
};
