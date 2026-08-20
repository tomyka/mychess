// mychess/src/routes/(player)/practice/[repertoire_id]/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadFilteredRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { loadMoveAttemptStats } from '$lib/server/practice-pool';
import { splitQueues } from '$lib/mastery/learning';
import { orderPracticeQueue } from '$lib/mastery/practiceQueue';

/**
 * The Practice pool: learned variations only, weakest-first, no arrows ever
 * (story #97 of epic #95).
 *
 * This URL used to serve the teaching flow, which moved to `/learn/[id]` in #96.
 * An old bookmark therefore lands here, and for a repertoire with nothing
 * learned yet that is the locked state below — which says so and links to Learn,
 * rather than a redirect that would have had to be removed one story later.
 *
 * `loadFilteredRepertoireVariations` has already dropped anything excluded, so
 * `splitQueues` only separates learned from un-learned here — and it is the same
 * function the Learn route uses, which is what stops a variation appearing on
 * both surfaces.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const repertoireId = params.repertoire_id;

	const [{ repertoire, variations }, learnedKeys] = await Promise.all([
		loadFilteredRepertoireVariations(supabase, user!.id, repertoireId),
		loadSolvedKeys(supabase, user!.id, repertoireId)
	]);

	const { learn, practice } = splitQueues(variations, learnedKeys);

	// Only pay for the attempt sweep when there is something to order with it.
	const stats = practice.length > 0 ? await loadMoveAttemptStats(supabase, user!.id, repertoireId) : new Map();
	const ordered = orderPracticeQueue(practice, stats);
	const byKey = new Map(practice.map((v) => [v.variationKey, v]));

	return {
		repertoire,
		// Ordered weakest-first on the server. The client walks this list rather
		// than re-deriving the order, so the two cannot disagree about what comes
		// next.
		queue: ordered.map((variationKey) => {
			const variation = byKey.get(variationKey)!;
			return { variationKey, path: variation.path, chapterNames: variation.chapterNames };
		}),
		learnedCount: practice.length,
		stillLearningCount: learn.length,
		total: practice.length + learn.length
	};
};
