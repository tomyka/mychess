// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSyncedActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { buildPracticeView } from '$lib/mastery/practice';
import { loadPositionEvals, fensInPath } from '$lib/server/position-evals';

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
	// Precomputed evals for exactly the positions this attempt can put on the
	// board (#126) — what lets the eval bar show a number without the client
	// downloading an engine at all. Empty until scripts/eval-positions.ts has run
	// for these positions, which the bar renders as its neutral state.
	const evals = view.attempt ? await loadPositionEvals(supabase, fensInPath(view.attempt.path)) : {};

	return { repertoire, evals, ...view };
};
