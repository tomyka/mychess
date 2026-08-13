// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedLevelProgress, getLastReviewedAt } from '$lib/server/level-progress';
import { repertoireProgress } from '$lib/mastery/levelProgress';
import { pickActiveVariation } from '$lib/mastery/variationSequence';
import { buildPracticeView } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const { repertoire, variations } = await loadFilteredRepertoireVariations(supabase, user!.id, repertoireId);
	const maxLevel = repertoire.practiceDepthLevels;
	const chunkSize = repertoire.chunkSize;
	const row = await loadSyncedLevelProgress(supabase, user!.id, repertoireId, variations, maxLevel, chunkSize);
	const active = pickActiveVariation(variations, row?.activeVariationKey ?? null);
	const { level, totalLevels } = repertoireProgress(active ? [active] : [], row, maxLevel, chunkSize);

	// A `?level=N` request only takes effect for a level strictly below the
	// active variation's own active level (or any level up to its totalLevels
	// once IT is mastered) — anything else is ignored and the page falls back
	// to normal training below.
	const requestedLevel = Number(url.searchParams.get('level'));
	const isValidReview =
		Number.isInteger(requestedLevel) &&
		requestedLevel >= 1 &&
		(level === 'mastered' ? requestedLevel <= totalLevels : requestedLevel < level);
	const reviewLevel = isValidReview ? requestedLevel : null;

	const lastReviewedAt = level === 'mastered' ? await getLastReviewedAt(supabase, user!.id, repertoireId) : null;

	return { repertoire, lastReviewedAt, ...buildPracticeView(variations, row, reviewLevel, maxLevel, chunkSize) };
};
