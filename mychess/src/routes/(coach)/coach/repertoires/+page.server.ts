import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
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

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const { user } = await requireAccount(locals);
		const supabase = locals.supabase;
		const fd = await request.formData();
		const repId = fd.get('rep_id') as string;
		if (!repId) return fail(400, { error: 'No repertoire selected' });

		const { error } = await supabase.from('repertoires').delete().eq('id', repId).eq('player_id', user!.id);
		if (error) return fail(500, { error: error.message });

		return { success: true };
	}
};
