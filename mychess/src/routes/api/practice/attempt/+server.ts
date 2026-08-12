// mychess/src/routes/api/practice/attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { applyAttemptResult } from '$lib/server/level-progress';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';
import { filterVariations } from '$lib/mastery/variations';

/**
 * Called once per completed Practice attempt (not per move — see
 * docs/superpowers/specs/2026-08-07-level-gauntlet-mastery-design.md).
 * Skipped entirely during review (read-only, no progress side effects).
 * Returns the resulting `PracticeView` directly so the client can update its
 * local state without a follow-up `invalidateAll()` re-fetching the same
 * repertoire content this endpoint already loaded.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, taskKey, hadMistake, abandonedTaskKey } = body ?? {};
	if (
		typeof repertoireId !== 'string' ||
		typeof taskKey !== 'string' ||
		typeof hadMistake !== 'boolean' ||
		(abandonedTaskKey !== undefined && typeof abandonedTaskKey !== 'string')
	) {
		throw error(400, 'Invalid request');
	}

	const { repertoire, variations: allVariations, excludedVariationKeys } = await loadRepertoireVariations(
		supabase,
		user.id,
		repertoireId
	);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const maxLevel = repertoire.practiceDepthLevels;
	const today = new Date().toISOString().slice(0, 10);
	// The level-progress write and the quest-progress write touch disjoint
	// tables/rows with no ordering dependency — run them concurrently. Both
	// are best-effort gamification writes; if the level-progress write ever
	// exhausts its retries, quest progress may still have recorded, which is
	// an acceptable trade for not serializing two unrelated writes.
	const [row] = await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, { taskKey, hadMistake, abandonedTaskKey }, variations, maxLevel),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);

	return json(buildPracticeView(variations, row, null, maxLevel));
};
