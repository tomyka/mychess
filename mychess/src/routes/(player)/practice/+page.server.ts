import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { loadRepertoireProgressSummaries } from '$lib/server/repertoire-progress';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const repertoires = await loadRepertoireProgressSummaries(locals.supabase, user!.id);
	return { repertoires };
};
