import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { data: repertoires } = await supabase
		.from('repertoires')
		.select('id, name, color, created_at, moves(count)')
		.eq('kid_id', user!.id)
		.order('created_at', { ascending: false });
	return { repertoires: repertoires ?? [] };
};
