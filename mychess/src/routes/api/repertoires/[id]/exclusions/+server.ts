// mychess/src/routes/api/repertoires/[id]/exclusions/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
import { validateVariationKeysOwnership } from '$lib/server/practice-repertoire';
import { setVariationsIncluded } from '$lib/server/variation-practice-settings';

/**
 * Sets whether one or more variations are included in practice for the
 * caller. Used both for a single variation's own checkbox and for the
 * repertoire-level checkbox's bulk include/exclude-all action (see
 * `RepertoirePracticeRow.svelte`) — same shape either way, just a longer
 * `variationKeys` array.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireApiUser(locals);
	const body = await request.json().catch(() => null);
	const { variationKeys, included } = body ?? {};

	if (!Array.isArray(variationKeys) || !variationKeys.every((k) => typeof k === 'string')) {
		throw error(400, 'variationKeys must be an array of strings');
	}
	if (typeof included !== 'boolean') throw error(400, 'included must be a boolean');

	// Confirms the caller can access this repertoire and that every move
	// referenced by variationKeys actually belongs to it — see
	// validateVariationKeysOwnership's own doc comment for why this is a
	// cheap, targeted check rather than fetching every move and
	// re-enumerating the whole variation tree just to compare keys.
	const validation = await validateVariationKeysOwnership(locals.supabase, params.id, variationKeys);
	if (validation.notFound) throw error(404, 'Repertoire not found');
	if (validation.error) {
		console.error('exclusions POST: ownership validation failed', {
			repertoireId: params.id,
			userId: user.id,
			variationKeyCount: variationKeys.length,
			error: validation.error
		});
		throw error(400, validation.error);
	}

	const result = await setVariationsIncluded(locals.supabase, user.id, params.id, variationKeys, included);
	if (result.error) {
		// Logged (not just returned to the client) since a write failure here
		// means practice/progress state silently diverges from what the UI
		// shows — see migration 0049's own comment for the class of bug this
		// caught (a Postgres btree index size limit, not obvious from the
		// generic error message alone).
		console.error('exclusions POST: write failed', {
			repertoireId: params.id,
			userId: user.id,
			variationKeyCount: variationKeys.length,
			included,
			error: result.error
		});
		throw error(400, result.error);
	}

	return json({ ok: true });
};
