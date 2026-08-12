// mychess/src/routes/api/repertoires/[id]/exclusions/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';
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

	const result = await setVariationsIncluded(locals.supabase, user.id, params.id, variationKeys, included);
	if (result.error) throw error(400, result.error);

	return json({ ok: true });
};
