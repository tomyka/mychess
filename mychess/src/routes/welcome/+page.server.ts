import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { fullNameOrNull } from '$lib/profile';
import { createPlayerProfile } from '$lib/server/onboarding';

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
		const firstName = ((data.get('first_name') as string) ?? '').trim();
		const lastName = ((data.get('last_name') as string) ?? '').trim();
		if (!firstName || !lastName) {
			return fail(400, { error: 'First and last name are required' });
		}

		const displayName = fullNameOrNull(firstName, lastName) ?? `${firstName} ${lastName}`;

		const { error } = await createPlayerProfile(supabase, {
			id: user.id,
			firstName,
			lastName,
			displayName
		});
		if (error) return fail(500, { error });

		throw redirect(303, '/');
	}
};
