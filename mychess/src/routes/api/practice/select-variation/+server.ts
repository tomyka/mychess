// mychess/src/routes/api/practice/select-variation/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { filterVariations } from '$lib/mastery/variations';
import { deriveLearnPlan } from '$lib/mastery/learnUnits';
import { computeMasteredMoveIds } from '$lib/mastery/teaching';
import { setActiveVariationKey, loadSolvedKeys, loadTeachingProgress } from '$lib/server/practice-progress';
import { requireApiUser } from '$lib/server/auth';
import { buildPracticeView } from '$lib/mastery/practice';

/**
 * Manually sets the active variation from the picker — the SAME
 * active_variation_key the automatic sequence and attempt-completion both
 * read/write. Picking a variation the player has already solved is allowed
 * (re-drilling for confidence); it doesn't un-solve anything, and it never
 * re-teaches (see buildPracticeView's already-solved bypass).
 *
 * An UNSOLVED variation with no unlearned learn unit is rejected with 409:
 * there is genuinely nothing left to teach in it right now, so persisting it
 * as active would re-serve a finished board. That can only happen from a stale
 * client — the picker never renders a learned unit — so this is a
 * consistency guard, not a gate the UI is expected to hit. The check must run
 * BEFORE `setActiveVariationKey`, or the dead pick would already be persisted
 * by the time the rejection is thrown.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json();
	const { repertoireId, variationKey } = body ?? {};
	if (typeof repertoireId !== 'string' || typeof variationKey !== 'string') {
		throw error(400, 'Invalid request');
	}

	const { variations: allVariations, excludedVariationKeys } = await loadRepertoireVariations(supabase, user.id, repertoireId);
	const variations = filterVariations(allVariations, excludedVariationKeys);
	if (!variations.some((v) => v.variationKey === variationKey)) {
		throw error(404, 'Variation not found');
	}

	const [solvedKeys, teachingProgress] = await Promise.all([
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	// Over the FILTERED pool, which is the same pool `buildPracticeView` below
	// will use for the same computation — `knownProgressFor`'s doc comment
	// requires it: the two "must agree exactly, or the server records progress
	// against a different step than the one it served."
	const plan = deriveLearnPlan(variations, computeMasteredMoveIds(variations, teachingProgress, solvedKeys));

	if (!solvedKeys.has(variationKey) && !plan.servableVariationKeys.includes(variationKey)) {
		throw error(409, 'That line is already learned');
	}

	await setActiveVariationKey(supabase, user.id, repertoireId, variationKey);
	return json(buildPracticeView(variations, variationKey, solvedKeys, teachingProgress, plan, true));
};
