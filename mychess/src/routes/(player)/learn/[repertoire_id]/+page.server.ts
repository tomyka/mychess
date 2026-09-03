// mychess/src/routes/(player)/learn/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { filterVariations } from '$lib/mastery/variations';
import { activeChapterState, deriveLearnPlan } from '$lib/mastery/learnUnits';
import { computeMasteredMoveIds } from '$lib/mastery/teaching';
import { loadSyncedActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { buildPracticeView } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ repertoire, variations: allVariations, excludedVariationKeys }, solvedKeys, teachingProgress] = await Promise.all([
		loadRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadTeachingProgress(supabase, user!.id, repertoireId)
	]);
	// The FILTERED set throughout (GitHub issue #182): an excluded line produces
	// no learn unit and blocks nothing, so unlike the tier-ceiling model this
	// replaces there is no reason to keep the unfiltered set around.
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
	// Derived ONCE and threaded through everything below — the servable set, the
	// per-variation teaching cap, and the progress bar all read this one value,
	// so they cannot disagree.
	const plan = deriveLearnPlan(variations, masteredMoveIds);
	// Threaded in so a stored pointer at an already-learned unit is resolved
	// past at THIS stage, rather than relying on buildPracticeView's own later
	// pickActiveVariation call to self-correct.
	const activeVariationKey = await loadSyncedActiveVariationKey(
		supabase,
		user!.id,
		repertoireId,
		variations,
		solvedKeys,
		plan.servableVariationKeys
	);

	const view = buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, plan);
	const chapter = activeChapterState(plan, variations, view.attempt?.variationKey ?? activeVariationKey);
	// Shaped for the page's existing band progress bar. `null` once every
	// chapter is complete, which hides the bar rather than showing a full one.
	const currentLevel =
		chapter && chapter.band ? { tier: chapter.band, ready: chapter.learnedInBand, total: chapter.totalInBand } : null;

	return { repertoire, currentLevel, ...view };
};
