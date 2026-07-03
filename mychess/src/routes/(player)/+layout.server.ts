import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession } }) => {
	const data = await safeGetSession();
	// Anonymous guests are allowed through — they have auto-created profiles
	if (!data.session) throw redirect(303, '/login');
	if (!data.profile) throw redirect(303, '/welcome');
	if ((data.profile as any).role !== 'player') throw redirect(303, '/coach');
	return data;
};
