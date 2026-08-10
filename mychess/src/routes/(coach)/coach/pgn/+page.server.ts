import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { importPgn } from '$lib/server/pgn-import';

export const actions: Actions = {
	upload: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401);

		const data = await request.formData();
		const name = data.get('name') as string;
		const pgnText = data.get('pgn_text') as string;
		const color = data.get('color') as string;
		const maxVariationMoves = Number(data.get('max_variation_moves'));

		if (!name || !pgnText) return fail(400, { error: 'Name and PGN required' });
		if (color !== 'white' && color !== 'black') return fail(400, { error: 'Please select a color' });
		if (!Number.isInteger(maxVariationMoves) || maxVariationMoves < 1) {
			return fail(400, { error: 'Max moves per line must be a positive whole number' });
		}

		const { error } = await importPgn(supabase, {
			playerId: user.id,
			name,
			color,
			pgnText,
			maxVariationMoves
		});
		if (error) return fail(400, { error });

		throw redirect(303, '/coach/repertoires');
	}
};
