import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const { data: repertoires } = await supabase
		.from('repertoires')
		.select('id, name, color, created_at, moves(count)')
		.eq('player_id', user!.id)
		.order('created_at', { ascending: false });
	return { repertoires: repertoires ?? [] };
};
