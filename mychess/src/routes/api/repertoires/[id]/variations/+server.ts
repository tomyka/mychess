// mychess/src/routes/api/repertoires/[id]/variations/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { loadRepertoireVariations } from '$lib/server/practice-repertoire';
import { moveSequenceLabel } from '$lib/mastery/variations';

/**
 * Every variation in a repertoire, labeled by its move sequence, with this
 * player's own included/excluded state and its originating PGN chapter (if
 * any) — powers the Practice picker's expand-to-show-variations checkbox
 * list, grouped by chapter. Fetched lazily (only when a repertoire row is
 * expanded), not eagerly for every repertoire on the picker, to avoid
 * re-introducing the full-move-fetch cost the shape cache (see
 * `repertoire-progress.ts`) exists specifically to avoid.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);
	const { variations, excludedVariationKeys } = await loadRepertoireVariations(locals.supabase, user.id, params.id);

	return json(
		variations.map((v) => ({
			variationKey: v.variationKey,
			label: moveSequenceLabel(v.path),
			included: !excludedVariationKeys.has(v.variationKey),
			// `?? null`, not just `v.chapterName`: `chapterName` is an OPTIONAL
			// field on `Variation` (see `mastery/variations.ts`), so an
			// omitted value is `undefined` at the type level — `JSON.stringify`
			// drops `undefined` object keys entirely, which would silently
			// remove `chapterName` from the response instead of sending `null`.
			// The client's `VariationRow` type (Task 9) requires the key to
			// always be present.
			chapterName: v.chapterName ?? null
		}))
	);
};
