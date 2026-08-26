// mychess/src/routes/(player)/learn/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { filterVariations } from '$lib/mastery/variations';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { computeBlockedKeys } from '$lib/mastery/teaching';
import { loadSyncedActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { buildPracticeView } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	// UNFILTERED here (`loadRepertoireVariations`, not `loadFilteredRepertoireVariations`):
	// the served `variations` still need to be the FILTERED set (unchanged), but
	// `teachingCeilingMoveCount` (GitHub issue #163) needs the unfiltered set for
	// the same exclusion-blocking reason `deriveChapterLevel` itself documents.
	const [{ repertoire, variations: allVariations, excludedVariationKeys }, solvedKeys, teachingProgress] = await Promise.all([
		loadRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadTeachingProgress(supabase, user!.id, repertoireId)
	]);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, solvedKeys);
	// Threaded into loadSyncedActiveVariationKey so a stored pointer already
	// paused at the ceiling is resolved past it at THIS stage, rather than
	// relying solely on buildPracticeView's own later pickActiveVariation call
	// to self-correct (see loadSyncedActiveVariationKey's doc comment).
	const blockedKeys = computeBlockedKeys(variations, solvedKeys, teachingProgress, ceilingMoveCount);
	const activeVariationKey = await loadSyncedActiveVariationKey(supabase, user!.id, repertoireId, variations, solvedKeys, blockedKeys);

	const view = buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress, ceilingMoveCount);
	return { repertoire, ...view };
};
