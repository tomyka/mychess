import type { PageServerLoad } from './$types';
import { listRelationshipsForCoach } from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user, session, profile } = await safeGetSession();
	const { active, pending } = await listRelationshipsForCoach(supabase, user!.id);

	return {
		session,
		profile,
		players: active.map((r) => r.other),
		pendingCount: pending.length
	};
};
