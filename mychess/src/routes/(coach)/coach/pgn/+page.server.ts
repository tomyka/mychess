import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { importPgn } from '$lib/server/pgn-import';
import { listRelationshipsForCoach } from '$lib/server/coach-players';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { active } = await listRelationshipsForCoach(supabase, user!.id);
	return { players: active.map((r) => r.other) };
};

export const actions: Actions = {
	upload: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401);

		const data = await request.formData();
		const name = data.get('name') as string;
		const playerId = data.get('player_id') as string;
		const pgnText = data.get('pgn_text') as string;
		const color = data.get('color') as string;

		if (!name || !pgnText) return fail(400, { error: 'Name and PGN required' });
		if (color !== 'white' && color !== 'black') return fail(400, { error: 'Please select a color' });

		const targetPlayer = playerId || user.id;
		const { repertoireId, gameCount, error } = await importPgn(supabase, {
			playerId: targetPlayer,
			name,
			color,
			pgnText
		});
		if (error) return fail(400, { error });

		return { success: true, gameCount, repId: repertoireId };
	}
};
