import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const supabase = locals.supabase;
	const [{ data: repertoires }, { data: assigned }] = await Promise.all([
		supabase
			.from('repertoires')
			.select('id, name, color, created_at, moves(count)')
			.eq('player_id', user!.id)
			.order('created_at', { ascending: false }),
		supabase
			.from('assigned_repertoires')
			.select('repertoire:repertoire_id ( id, name, color, moves(count) )')
			.eq('player_id', user!.id)
	]);
	const assignedRepertoires = (assigned ?? [])
		.map((a: any) => a.repertoire)
		.filter(Boolean);
	return { repertoires: repertoires ?? [], assignedRepertoires };
};
