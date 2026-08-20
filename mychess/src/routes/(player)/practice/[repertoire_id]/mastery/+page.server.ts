// mychess/src/routes/(player)/practice/[repertoire_id]/mastery/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { loadChapterMastery } from '$lib/server/mastery';
import { chapterMasteryView, masteryRunQueue } from '$lib/mastery/masteryRun';

/**
 * The mastery screen (story #100): one chapter at a time, every learned
 * variation in it, no arrows and no hints, any mistake ending the run.
 *
 * Every chapter's queue is shipped up front rather than fetched when a run
 * starts. A run is a single sitting by design, so a mid-run network round trip
 * is a failure mode worth removing — and the whole repertoire's variations are
 * already loaded here to compute the chapter view anyway.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ repertoire, variations }, learnedKeys, masteryRecords] = await Promise.all([
		loadFilteredRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadChapterMastery(supabase, user!.id, repertoireId)
	]);

	const chapters = chapterMasteryView({
		variations,
		learnedKeys,
		masteryRecords,
		repertoireMovesUpdatedAt: repertoire.movesUpdatedAt
	});

	return {
		repertoire,
		chapters,
		queues: Object.fromEntries(
			chapters
				.filter((c) => c.canRun)
				.map((c) => [
					c.chapter,
					masteryRunQueue(variations, c.chapter, learnedKeys).map((v) => ({
						variationKey: v.variationKey,
						path: v.path
					}))
				])
		),
		allMastered: chapters.length > 0 && chapters.every((c) => c.mastered)
	};
};
