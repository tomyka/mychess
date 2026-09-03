// mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { filterVariations, rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel } from '$lib/mastery/learnUnits';
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
	// Computed once and reused by every chapter's deriveChapterLevel call below
	// — recomputing this O(repertoire) scan per chapter would turn an O(n)
	// question into O(chapters × n).
	const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, learnedKeys);

	const chapters = masterableChapters(variations).map((chapter) => {
		const rows = rowsInChapterTier(variations, chapter);
		return {
			chapter,
			total: rows.length,
			learned: rows.filter((v) => learnedKeys.has(v.variationKey)).length,
			level: deriveChapterLevel(rows, masteredMoveIds)
		};
	});

	return {
		repertoire,
		chapters,
		repertoireLevel: deriveRepertoireLevel(chapters.map((c) => c.level))
	};
};
