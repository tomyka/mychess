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
