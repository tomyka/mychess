// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { buildPracticeView } from '$lib/mastery/practice';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ repertoire, variations }, solvedKeys, teachingProgress] = await Promise.all([
		loadFilteredRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId),
		loadTeachingProgress(supabase, user!.id, repertoireId)
	]);
	const activeVariationKey = await loadSyncedActiveVariationKey(supabase, user!.id, repertoireId, variations, solvedKeys);

	const view = buildPracticeView(variations, activeVariationKey, solvedKeys, teachingProgress);
	return { repertoire, ...view };
};
