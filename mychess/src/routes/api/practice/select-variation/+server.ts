// mychess/src/routes/api/practice/select-variation/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { filterVariations } from '$lib/mastery/variations';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { isLockedForTier, isCeilingReachedAnywhere, knownProgressFor, computeMasteredMoveIds, computeMasteredPliesMap } from '$lib/mastery/teaching';
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
 * An UNSOLVED variation already paused at the current tier ceiling (GitHub
 * issue #163) is rejected with 403 — the picker's own disabled UI (a later
 * task) is only a courtesy; this is the real, server-side gate, since a
 * request can always bypass client-side UI. The check must run BEFORE
 * `setActiveVariationKey` below, or a locked variation would already be
 * persisted as active by the time the rejection is thrown.
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
	const picked = variations.find((v) => v.variationKey === variationKey);
	if (!picked) {
		throw error(404, 'Variation not found');
	}

	const [solvedKeys, teachingProgress] = await Promise.all([
		loadSolvedKeys(supabase, user.id, repertoireId),
		loadTeachingProgress(supabase, user.id, repertoireId)
	]);
	// GitHub issue #181: teachingCeilingMoveCount now needs a masteredPlies
	// map, computed over the UNFILTERED `allVariations` set — distinct from
	// the FILTERED-pool `masteredMoveIds` computed further below for the
	// isLockedForTier check, which deliberately uses a different pool (see
	// that computation's own doc comment).
	const masteredPliesForCeiling = computeMasteredPliesMap(allVariations, teachingProgress, solvedKeys);
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, masteredPliesForCeiling);

	if (!solvedKeys.has(variationKey)) {
		// Shared-credit-aware (GitHub issue #168) and, deliberately, over the
		// same FILTERED `variations` pool `buildPracticeView` below will
		// itself use for the exact same computation (mastery/practice.ts) —
		// not `allVariations`. `knownProgressFor`'s own doc comment requires
		// this: the two calls "must agree exactly, or the server records
		// progress against a different step than the one it served." Using
		// the bigger, unfiltered pool here could credit more shared mastery
		// than the serve step actually will (excluded siblings can only ever
		// ADD credit, never remove it), which could reject a pick that
		// `buildPracticeView` would in fact have served just fine.
		// Computed once, not once for `knownProgressFor` and again inside
		// `isCeilingReachedAnywhere` — both would otherwise independently
		// re-derive the same whole-repertoire set.
		const masteredMoveIds = computeMasteredMoveIds(variations, teachingProgress, solvedKeys);
		const { masteredPlies } = knownProgressFor({
			variation: picked,
			variations,
			teachingProgress,
			solvedKeys,
			resumedAfterBreak: false,
			masteredMoveIds
		});
		// Shared-credit-aware AND deferred-sibling-aware (GitHub issue #172) —
		// matching `computeBlockedKeys`, which is what actually decides what
		// auto-advance would have served here anyway.
		const ceilingReached = isCeilingReachedAnywhere(variations, solvedKeys, teachingProgress, ceilingMoveCount, masteredMoveIds);
		if (isLockedForTier(picked.path, masteredPlies, ceilingMoveCount, ceilingReached)) {
			throw error(403, 'This line is locked until you finish your current tier');
		}
	}

	await setActiveVariationKey(supabase, user.id, repertoireId, variationKey);
	return json(buildPracticeView(variations, variationKey, solvedKeys, teachingProgress, ceilingMoveCount, true));
};
