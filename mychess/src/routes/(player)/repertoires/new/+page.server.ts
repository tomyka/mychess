import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';
import { importPgn } from '$lib/server/pgn-import';

export const load: PageServerLoad = async ({ locals }) => {
	await requireAccount(locals);
	return {};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const name = ((fd.get('name') as string) ?? '').trim();
		const color = fd.get('color') as string;
		const pgnText = ((fd.get('pgn_text') as string) ?? '').trim();
		const maxVariationMoves = Number(fd.get('max_variation_moves'));

		if (!name || !pgnText) return fail(400, { error: 'Name and PGN are required' });
		if (color !== 'white' && color !== 'black') return fail(400, { error: 'Please select a color' });
		if (!Number.isInteger(maxVariationMoves) || maxVariationMoves < 1) {
			return fail(400, { error: 'Max moves per line must be a positive whole number' });
		}

		const { error } = await importPgn(supabase, { playerId: user!.id, name, color, pgnText, maxVariationMoves });
		if (error) return fail(400, { error });

		throw redirect(303, '/repertoires');
	}
};
