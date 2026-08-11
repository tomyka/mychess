// mychess/src/routes/api/practice/maintenance-review/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordMaintenanceReview } from '$lib/server/level-progress';
import { requireApiUser } from '$lib/server/auth';

/**
 * Called once a maintenance review session (see `pickMaintenanceLevels`)
 * finishes — a mastered repertoire's periodic "keep it fresh" retest, run
 * entirely through the existing read-only review path (never touches
 * level/queue), that just needs a timestamp bumped on completion. RLS on
 * `level_progress` (player_id = auth.uid()) is the only authorization check
 * needed here.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { supabase } = locals;
	const user = await requireApiUser(locals);

	const body = await request.json().catch(() => null);
	const { repertoireId } = body ?? {};
	if (typeof repertoireId !== 'string') {
		throw error(400, 'Invalid request');
	}

	await recordMaintenanceReview(supabase, user.id, repertoireId);
	return json({ ok: true });
};
