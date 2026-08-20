import { error, redirect } from '@sveltejs/kit';

type Locals = App.Locals;

/** Requires a signed-in account. Redirects to /login otherwise. */
export async function requireAccount(locals: Locals) {
	const data = await locals.safeGetSession();
	if (!data.user) {
		throw redirect(303, '/login');
	}
	return data;
}

/** Requires a signed-in user for a JSON API route. Throws a 401 (not a redirect) otherwise. */
export async function requireApiUser(locals: Locals) {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Unauthorized');
	return user;
}
