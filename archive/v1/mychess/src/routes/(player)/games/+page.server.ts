import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await requireAccount(locals);
	const { data: games } = await locals.supabase
		.from('games')
		.select('id, headers, played_as, analysis_status, analysis, created_at')
		.eq('player_id', user!.id)
		.order('created_at', { ascending: false });
	return { games: games ?? [] };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const fd = await request.formData();
		const gameId = fd.get('game_id') as string;
		if (!gameId) return fail(400, { error: 'No game selected' });

		const { error } = await locals.supabase
			.from('games')
			.delete()
			.eq('id', gameId)
			.eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	}
};
