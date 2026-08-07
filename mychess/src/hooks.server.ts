import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { fullNameOrNull, isPlaceholderName } from '$lib/profile';
import { ensureGuestProfile } from '$lib/server/guest';
import { sessionCookieOptions } from '$lib/server/cookies';
import { requireEnv } from '$lib/env';

export const handle: Handle = async ({ event, resolve }) => {
	const PUBLIC_SUPABASE_URL = requireEnv(env.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL');
	const PUBLIC_SUPABASE_ANON_KEY = requireEnv(env.PUBLIC_SUPABASE_ANON_KEY, 'PUBLIC_SUPABASE_ANON_KEY');
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		// @supabase/ssr's own DEFAULT_COOKIE_OPTIONS sets httpOnly: false —
		// without this override it silently beats SvelteKit's httpOnly: true
		// framework default (the caller's options win in cookies.set's merge),
		// leaving the session/refresh-token cookies readable via document.cookie
		// and stealable by any future XSS. Force it back on explicitly.
		cookieOptions: { httpOnly: true, secure: !dev, sameSite: 'lax' },
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookies) => {
				const noPersist = event.cookies.get('sb-no-persist') === '1';
				cookies.forEach(({ name, value, options }) =>
					event.cookies.set(name, value, sessionCookieOptions({ ...options, path: '/' }, noPersist))
				);
			}
		}
	});

	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		// No eager anonymous session — public pages are viewable without any session.
		if (!session) return { session: null, user: null, profile: null };

		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('id', session.user.id)
			.single();

		// A lazily-created anonymous session may not have its guest profile yet.
		if (!profile && session.user.is_anonymous) {
			await ensureGuestProfile(event.locals.supabase, session.user.id);
		}

		let resolvedProfile = profile ?? (await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('id', session.user.id)
			.single()).data;

		// Backfill display_name for accounts that converted from a guest: they
		// keep the "Guest" placeholder even after a real name is set. Once a
		// name exists on a non-anonymous account, adopt it as the display name.
		if (
			resolvedProfile &&
			!session.user.is_anonymous &&
			isPlaceholderName((resolvedProfile as any).display_name)
		) {
			const displayName = fullNameOrNull(
				(resolvedProfile as any).first_name,
				(resolvedProfile as any).last_name
			);
			if (displayName) {
				await event.locals.supabase
					.from('profiles')
					.update({ display_name: displayName } as any)
					.eq('id', session.user.id);
				resolvedProfile = { ...(resolvedProfile as any), display_name: displayName };
			}
		}

		return { session, user: session.user, profile: resolvedProfile, isGuest: !!session.user.is_anonymous };
	};

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};
