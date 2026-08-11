// mychess/src/routes/api/repertoires/[id]/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireApiUser } from '$lib/server/auth';

/**
 * Deletes a repertoire the caller owns. Used by `PgnImportForm.svelte` to
 * roll back chapters already imported when a later chapter in the same
 * multi-chapter PGN fails — each chapter is its own request/repertoire now
 * (see `/api/repertoires/import-chapter`), so nothing server-side can roll
 * back the whole batch atomically anymore.
 */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = await requireApiUser(locals);

	const { error: err } = await locals.supabase
		.from('repertoires')
		.delete()
		.eq('id', params.id)
		.eq('player_id', user.id);
	if (err) throw error(400, err.message);

	return json({ ok: true });
};

/**
 * Updates a repertoire's practice depth (how many levels deep the level
 * system currently goes into it — see `effectiveLevelCap`), owner-only.
 * Free-form and editable anytime: the full repertoire is always imported,
 * so raising this later reveals content that was already there rather than
 * requiring a re-upload. Setting it beyond the repertoire's real depth has
 * no further effect — there's nothing more to unlock.
 */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const user = await requireApiUser(locals);

	const body = await request.json().catch(() => null);
	const practiceDepthLevels = body?.practiceDepthLevels;
	if (!Number.isInteger(practiceDepthLevels) || practiceDepthLevels < 1) {
		throw error(400, 'practiceDepthLevels must be a positive whole number');
	}

	const { error: err } = await locals.supabase
		.from('repertoires')
		.update({ practice_depth_levels: practiceDepthLevels })
		.eq('id', params.id)
		.eq('player_id', user.id);
	if (err) throw error(400, err.message);

	return json({ ok: true });
};
