import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { parseBoardPrefs } from '$lib/board/prefs';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession } }) => {
	const data = await safeGetSession();
	// A real signup that hasn't completed onboarding yet.
	if (data.user && !data.profile) {
		throw redirect(303, '/welcome');
	}
	// Coaches use the coach dashboard.
	if ((data.profile as any)?.role === 'coach') {
		throw redirect(303, '/coach');
	}
	// Visitors with no session, and players, both pass through.
	return { ...data, boardPrefs: parseBoardPrefs((data.profile as any)?.board_prefs) };
};
