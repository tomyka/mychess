import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession } }) => {
	const data = await safeGetSession();
	if (!data.session) throw redirect(303, '/login');
	if (!data.profile) throw redirect(303, '/welcome');
	if ((data.profile as any).role !== 'kid') throw redirect(303, '/coach');
	return data;
};
