import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await requireAccount(locals);
	const { data: game, error: err } = await locals.supabase
		.from('games')
		.select('id, headers, played_as, moves, analysis_status, analysis, created_at')
		.eq('id', params.game_id)
		.eq('player_id', user!.id)
		.maybeSingle();
	if (err) throw error(500, err.message);
	if (!game) throw error(404, 'Game not found');
	return { game };
};
