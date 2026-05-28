import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	const { data: invites } = await supabase
		.from('invites')
		.select('*')
		.eq('coach_id', user!.id)
		.order('created_at', { ascending: false });
	return { invites: invites ?? [] };
};

export const actions: Actions = {
	create: async ({ locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401);
		const { data, error } = await supabase.from('invites').insert({ coach_id: user.id }).select().single();
		if (error) return fail(500, { error: error.message });
		return { token: data.token };
	}
};
