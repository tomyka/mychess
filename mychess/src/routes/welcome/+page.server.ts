import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { session, profile } = await safeGetSession();
	if (!session) throw redirect(303, '/login');
	if (profile) throw redirect(303, (profile as any).role === 'coach' ? '/coach' : '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { error: 'Not logged in' });

		const data = await request.formData();
		const role = data.get('role') as string;
		const display_name = data.get('display_name') as string;
		if (!role || !display_name) return fail(400, { error: 'All fields required' });

		const { error } = await supabase
			.from('profiles')
			.upsert({ id: user.id, role, display_name, avatar_id: 'knight' });
		if (error) return fail(500, { error: error.message });

		await supabase.from('player_stats').upsert({ player_id: user.id });
		await supabase.from('equipped_cosmetics').upsert({ player_id: user.id });

		throw redirect(303, role === 'coach' ? '/coach' : '/');
	}
};
