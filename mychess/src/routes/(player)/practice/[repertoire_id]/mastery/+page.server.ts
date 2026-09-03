// mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { filterVariations, rowsInChapterTier, UNTAGGED_CHAPTER } from '$lib/mastery/variations';
import { deriveLearnPlan, deriveRepertoireLevel } from '$lib/mastery/learnUnits';
import { computeMasteredMoveIds } from '$lib/mastery/teaching';

/**
 * The knowledge-levels screen: each chapter's Bronze/Silver/Gold/Platinum
 * band, derived read-only from the chapter's own learn units and how much of
 * them this player has mastered. Superseded the mastery-run screen (story
 * #100) — there is no run to start any more, a chapter's level simply
 * reflects what's already been learned.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ repertoire, variations: allVariations, excludedVariationKeys }, learnedKeys, teachingProgress] = await Promise.all([
		loadRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadTeachingProgress(supabase, user!.id, repertoireId)
	]);
	// FILTERED (GitHub issue #182): an excluded line produces no learn unit and
	// no longer caps its chapter's band, so a player who trims a line can still
	// finish the chapter it was in.
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, learnedKeys);
	// The levels come from the SAME `deriveLearnPlan` call Learn itself uses,
	// rather than a per-chapter derivation of their own — that duplication is
	// what let this page and Learn disagree about a chapter's band across
	// GitHub issue #181's five fixes.
	const plan = deriveLearnPlan(variations, masteredMoveIds);

	const chapters = plan.chapters.map((state) => {
		// `null` is the flat pool of a chapterless repertoire; name it the way
		// `masterableChapters` does so this page's own labels are unchanged.
		const chapter = state.chapter ?? UNTAGGED_CHAPTER;
		const rows = rowsInChapterTier(variations, chapter);
		return {
			chapter,
			total: rows.length,
			learned: rows.filter((v) => learnedKeys.has(v.variationKey)).length,
			level: state.level
		};
	});

	return {
		repertoire,
		chapters,
		repertoireLevel: deriveRepertoireLevel(chapters.map((c) => c.level))
	};
};
