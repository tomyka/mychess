// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedLevelProgress } from '$lib/server/level-progress';
import { repertoireProgress } from '$lib/mastery/levelProgress';
import { pickQueuedAttempt, pickReviewAttempt, splitAttempt } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const { repertoire, variations } = await loadRepertoireVariations(supabase, user!.id, repertoireId);
	const row = await loadSyncedLevelProgress(supabase, user!.id, repertoireId, variations);
	const { level, totalVariations, totalLevels, levelTaskCount, levelSolvedCount } = repertoireProgress(
		variations,
		row
	);

	// A `?level=N` request only takes effect for a level strictly below the
	// active one (or any level up to totalLevels once mastered) — anything
	// else (the active level, a locked level, garbage input) is ignored and
	// the page falls back to normal training below. This means URL tampering
	// to peek at a locked level just does nothing, rather than erroring.
	const requestedLevel = Number(url.searchParams.get('level'));
	const isValidReview =
		Number.isInteger(requestedLevel) &&
		requestedLevel >= 1 &&
		(level === 'mastered' ? requestedLevel <= totalLevels : requestedLevel < level);
	const reviewLevel = isValidReview ? requestedLevel : null;

	let attempt: {
		prefix: ReturnType<typeof splitAttempt>['prefix'];
		quizSteps: ReturnType<typeof splitAttempt>['quizSteps'];
		taskKey: string;
	} | null = null;

	if (reviewLevel !== null) {
		const picked = pickReviewAttempt(variations, reviewLevel);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, reviewLevel, picked.targetDepth, variations);
			attempt = { prefix, quizSteps, taskKey: picked.taskKey };
		}
	} else if (level !== 'mastered' && row) {
		const picked = pickQueuedAttempt(variations, level, row.queue);
		if (picked) {
			const { prefix, quizSteps } = splitAttempt(picked.variation.path, level, picked.targetDepth, variations);
			attempt = { prefix, quizSteps, taskKey: picked.taskKey };
		}
	}

	return {
		repertoire,
		level,
		totalVariations,
		totalLevels,
		levelTaskCount,
		levelSolvedCount,
		attempt,
		reviewLevel
	};
};
