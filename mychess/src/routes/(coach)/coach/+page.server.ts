import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user, session, profile } = await safeGetSession();

	const { data: kids } = await supabase
		.from('profiles')
		.select('id, display_name')
		.eq('coach_id', user!.id)
		.eq('role', 'kid');

	return { session, profile, kids: kids ?? [] };
};
