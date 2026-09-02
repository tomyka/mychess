// mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { masterableChapters } from '$lib/mastery/repertoireStatus';
import { rowsInChapterTier } from '$lib/mastery/variations';
import { deriveChapterLevel, deriveRepertoireLevel } from '$lib/mastery/chapterLevels';
import { computeMasteredPliesMap } from '$lib/mastery/teaching';

/**
 * The knowledge-levels screen: each chapter's Bronze/Silver/Gold/Platinum
 * tier, derived read-only from `playerMoveCount` + this player's solved set.
 * Superseded the mastery-run screen (story #100) — there is no run to start
 * any more, a chapter's level simply reflects what's already been solved in
 * Practice.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	// UNFILTERED on purpose: an excluded, never-solved variation must still be
	// present in its tier bracket to block the ladder past its own tier,
	// rather than silently absent from it — see `deriveChapterLevel`'s doc
	// comment. This page has no other use for `variations`, so it switches
	// entirely rather than also deriving a filtered copy.
	const [{ repertoire, variations }, learnedKeys, teachingProgress] = await Promise.all([
		loadRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadTeachingProgress(supabase, user!.id, repertoireId)
	]);
	// Computed once, reused by every chapter's deriveChapterLevel call below
	// (GitHub issue #181) — the map only needs variationKey lookups, so this
	// avoids recomputing computeMasteredMoveIds (an O(repertoire) scan) once
	// per chapter.
	const masteredPlies = computeMasteredPliesMap(variations, teachingProgress, learnedKeys);

	const chapters = masterableChapters(variations).map((chapter) => {
		const rows = rowsInChapterTier(variations, chapter);
		return {
			chapter,
			total: rows.length,
			learned: rows.filter((v) => learnedKeys.has(v.variationKey)).length,
			level: deriveChapterLevel(rows, masteredPlies)
		};
	});

	return {
		repertoire,
		chapters,
		repertoireLevel: deriveRepertoireLevel(chapters.map((c) => c.level))
	};
};
