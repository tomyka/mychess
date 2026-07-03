import { redirect } from '@sveltejs/kit';
import { ensureGuestProfile } from './guest';

type Locals = App.Locals;

/** Requires a real (non-anonymous) signed-in account. Redirects to /login otherwise. */
export async function requireAccount(locals: Locals) {
	const data = await locals.safeGetSession();
	if (!data.user || (data.user as any).is_anonymous) {
		throw redirect(303, '/login');
	}
	return data;
}

/**
 * Returns the current session, lazily creating an anonymous one if none exists so
 * guests can try DB-backed training. Returns null if anonymous sign-in is
 * unavailable (provider disabled / error) — callers show a "sign in to train" state.
 */
export async function ensureGuestSession(locals: Locals) {
	const existing = await locals.safeGetSession();
	if (existing.session) return existing;

	const { data, error } = await locals.supabase.auth.signInAnonymously();
	if (error || !data.session) return null;

	await ensureGuestProfile(locals.supabase, data.session.user.id);
	return locals.safeGetSession();
}
