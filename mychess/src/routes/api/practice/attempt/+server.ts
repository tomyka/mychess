// mychess/src/routes/api/practice/attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyAttemptResult } from '$lib/server/level-progress';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';

/**
 * Called once per completed Practice attempt (not per move — see
 * docs/superpowers/specs/2026-08-07-level-gauntlet-mastery-design.md).
 * Skipped entirely during review (read-only, no progress side effects).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, taskKey, hadMistake } = body ?? {};
	if (typeof repertoireId !== 'string' || typeof taskKey !== 'string' || typeof hadMistake !== 'boolean') {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadRepertoireVariations(supabase, user.id, repertoireId);
	await applyAttemptResult(supabase, user.id, repertoireId, { taskKey, hadMistake }, variations);

	const today = new Date().toISOString().slice(0, 10);
	await incrementQuestProgress(supabase, user.id, 'review_cards', today);

	return json({ ok: true });
};
