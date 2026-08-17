// mychess/src/routes/api/practice/attempt/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import {
	applyAttemptResult,
	loadActiveVariationKey,
	loadSolvedKeys,
	loadTeachingProgress,
	touchVariationAttempt
} from '$lib/server/practice-progress';
import { incrementQuestProgress } from '$lib/server/quests';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';

/**
 * Called once per completed Practice attempt (the whole variation replayed,
 * not per move). Reports whether the attempt was clean — a clean attempt
 * marks the variation solved and advances the active variation; a mistaken
 * one leaves progress untouched (the same variation is naturally re-served
 * next). `touchVariationAttempt` is the one exception to that mistake-is-a-
 * no-op rule: it always records that this variation was just attempted,
 * regardless of outcome, purely to detect a later resume-after-a-break (see
 * `buildPracticeView` in `$lib/mastery/practice.ts`) — it never affects
 * teaching progress or which variation is active.
 *
 * `touchVariationAttempt` and `applyAttemptResult`'s own `saveTeachingProgress`
 * upsert can run concurrently below against the same `variation_teaching_progress`
 * row — this is safe because they write disjoint column sets (only `updated_at`
 * vs. only `taught_plies`/`mastered_plies`), and Postgres/PostgREST's upsert only
 * updates columns present in each request's own payload, so neither can clobber
 * what the other just wrote regardless of interleaving.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, variationKey, hadMistake } = body ?? {};
	if (typeof repertoireId !== 'string' || typeof variationKey !== 'string' || typeof hadMistake !== 'boolean') {
		throw error(400, 'Invalid request');
	}

	const { variations } = await loadFilteredRepertoireVariations(supabase, user.id, repertoireId);
	const today = new Date().toISOString().slice(0, 10);
	await Promise.all([
		applyAttemptResult(supabase, user.id, repertoireId, variationKey, hadMistake, variations),
		touchVariationAttempt(supabase, user.id, repertoireId, variationKey),
		incrementQuestProgress(supabase, user.id, 'review_cards', today)
	]);

	const [activeVariationKey, solvedKeys, teachingProgress] = await Promise.all([
		loadActiveVariationKey(supabase, user.id, repertoireId),
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	return json(buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress));
};
