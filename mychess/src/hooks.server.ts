import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { fullNameOrNull, isPlaceholderName } from '$lib/profile';
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

	async function computeSession() {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		// No eager anonymous session — public pages are viewable without any session.
		if (!session) return { session: null, user: null, profile: null, isSignedOut: true };

		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('id', session.user.id)
			.single();

		let resolvedProfile = profile;

		// Backfill display_name for an account that never set one. Once first/last
		// name exist, adopt them.
		if (resolvedProfile && isPlaceholderName((resolvedProfile as any).display_name)) {
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

		// A session now means a real account, full stop — anonymous auth is
		// retired: the code path that minted guests went in #88, the 3,811 rows it
		// left were purged in #90, and the Supabase provider itself is disabled,
		// so nothing can present an anonymous session any more.
		return { session, user: session.user, profile: resolvedProfile, isSignedOut: false };
	}

	// Every layout in a route's tree runs its `load` on each navigation, and
	// most pages' own `load`/actions call this again via requireAccount/
	// requireApiUser — for a typical (player) page that's 3+ independent
	// calls per single page view. Without caching, each one redoes the full
	// auth+profile round trip, multiplying Supabase round trips 3x-4x on
	// every single page load across the whole app. Memoize per-request (this
	// `handle` call, and therefore `sessionPromise`, is fresh per request) so
	// every call after the first reuses the same in-flight/resolved promise.
	let sessionPromise: ReturnType<typeof computeSession> | undefined;
	event.locals.safeGetSession = () => (sessionPromise ??= computeSession());

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};
