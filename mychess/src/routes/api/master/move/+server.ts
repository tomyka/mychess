import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markMoveCorrect } from '$lib/server/move-progress';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const { moveId } = (await request.json()) as { moveId: string };
	if (!moveId) throw error(400, 'moveId is required');

	const { error: progressError } = await markMoveCorrect(supabase, user.id, moveId);
	if (progressError) throw error(500, progressError);

	return json({ ok: true });
};
