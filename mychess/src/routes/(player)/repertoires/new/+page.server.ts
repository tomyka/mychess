import type { PageServerLoad } from './$types';
import { requireAccount } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
	await requireAccount(locals);
	return {};
};
