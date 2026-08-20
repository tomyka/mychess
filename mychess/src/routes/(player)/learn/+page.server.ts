// mychess/src/routes/(player)/learn/+page.server.ts
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireProgressSummaries } from '$lib/server/repertoire-progress';

/**
 * The Learn list. Added after #96 moved the teaching flow to `/learn/[id]` and
 * gave the nav a Learn entry without a landing page behind it — `/learn` 404'd
 * in production until this existed.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const repertoires = await loadRepertoireProgressSummaries(locals.supabase, user!.id);
	return { repertoires };
};
