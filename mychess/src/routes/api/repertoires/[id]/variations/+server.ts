// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { loadSolvedKeys } from '$lib/server/practice-progress';
import { moveSequenceLabel } from '$lib/mastery/variations';

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own included/excluded state, every originating PGN chapter (empty
 * for an untagged line — a line cross-referenced by several chapters is one
 * entry listing all of them, never one entry per chapter), full move path (for the picker's fixed-window move-group buckets, which
 * key on each variation's first FIRST_MOVES_GROUP_PLIES plies — not just the
 * first move), and solved state. Fetched lazily (only when a repertoire row
 * is expanded or the picker is opened), not eagerly for every repertoire, to
 * avoid re-introducing the full-move-fetch cost the shape cache exists to
 * avoid.
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
			chapterNames: v.chapterNames,
			path: v.path,
			solved: solvedKeys.has(v.variationKey)
		}))
	);
};
