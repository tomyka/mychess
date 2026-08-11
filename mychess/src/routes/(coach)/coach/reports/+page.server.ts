import type { PageServerLoad } from './$types';
import { listRelationshipsForCoach } from '$lib/server/coach-players';
import { loadStudentSummary } from '$lib/server/practice-report';

const RANGE_DAYS = 30;

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active } = await listRelationshipsForCoach(supabase, user!.id);

	const now = new Date();
	const sinceIso = new Date(now.getTime() - RANGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

	const students = await Promise.all(
		active.map(async (r) => ({
			player: r.other,
			summary: await loadStudentSummary(supabase, user!.id, r.other.id, sinceIso, now)
		}))
	);

	return { students };
};
