// mychess/src/routes/api/practice/select-variation/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { filterVariations } from '$lib/mastery/variations';
import { teachingCeilingMoveCount } from '$lib/mastery/chapterLevels';
import { isPausedAtCeiling, knownProgressFor } from '$lib/mastery/teaching';
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
	const ceilingMoveCount = teachingCeilingMoveCount(allVariations, solvedKeys);

	if (!solvedKeys.has(variationKey)) {
		// Shared-credit-aware, matching the picker's own `locked` computation
		// (GET /api/repertoires/[id]/variations) — a never-visited variation
		// whose entire visible opening is already mastered via a sibling must
		// be rejected here too, or this "real" gate would disagree with what
		// the picker displays as locked (GitHub issue #168).
		const { masteredPlies } = knownProgressFor({
			variation: picked,
			variations: allVariations,
			teachingProgress,
			solvedKeys,
			resumedAfterBreak: false
		});
		if (isPausedAtCeiling(picked.path, masteredPlies, ceilingMoveCount)) {
			throw error(403, 'This line is locked until you finish your current tier');
		}
	}

	await setActiveVariationKey(supabase, user.id, repertoireId, variationKey);
	return json(buildPracticeView(variations, variationKey, solvedKeys, teachingProgress, ceilingMoveCount, true));
};
