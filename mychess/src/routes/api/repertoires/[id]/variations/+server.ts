// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { moveSequenceLabel } from '$lib/mastery/variations';

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own included/excluded state, originating PGN chapter (if any),
 * first move (for the picker's move-group buckets), and solved state.
 * Fetched lazily (only when a repertoire row is expanded or the picker is
 * opened), not eagerly for every repertoire, to avoid re-introducing the
 * full-move-fetch cost the shape cache exists to avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const [{ variations, excludedVariationKeys }, solvedKeys] = await Promise.all([
		loadRepertoireVariations(locals.supabase, user.id, params.id),
		loadSolvedKeys(locals.supabase, user.id, params.id)
	]);

	return json(
		variations.map((v) => ({
			variationKey: v.variationKey,
			label: moveSequenceLabel(v.path),
			included: !excludedVariationKeys.has(v.variationKey),
			chapterName: v.chapterName ?? null,
			firstMoveSan: v.path[0]?.san ?? null,
			solved: solvedKeys.has(v.variationKey)
		}))
	);
};
