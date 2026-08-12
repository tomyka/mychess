// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedLevelProgress, getLastReviewedAt } from '$lib/server/level-progress';
import { repertoireProgress } from '$lib/mastery/levelProgress';
import { buildPracticeView } from '$lib/mastery/practice';
import { filterVariations } from '$lib/mastery/variations';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const { repertoire, variations: allVariations, excludedVariationKeys } = await loadRepertoireVariations(
		supabase,
		user!.id,
		repertoireId
	);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const maxLevel = repertoire.practiceDepthLevels;
	const row = await loadSyncedLevelProgress(supabase, user!.id, repertoireId, variations, maxLevel);
	const { level, totalLevels } = repertoireProgress(variations, row, maxLevel);

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

	// Only relevant once mastered (see the "Repertoire Mastered" screen's
	// maintenance-review control) — skip the extra round trip for every
	// other load, which is the overwhelmingly common case.
	const lastReviewedAt = level === 'mastered' ? await getLastReviewedAt(supabase, user!.id, repertoireId) : null;

	return { repertoire, lastReviewedAt, ...buildPracticeView(variations, row, reviewLevel, maxLevel) };
};
