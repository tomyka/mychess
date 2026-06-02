import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } = env;
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookies) =>
				cookies.forEach(({ name, value, options }) =>
					event.cookies.set(name, value, { ...options, path: '/' })
				)
		}
	});

	event.locals.safeGetSession = async () => {
		let {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		// Auto-create anonymous session for new visitors (guest mode)
		if (!session) {
			const { data: anonData } = await event.locals.supabase.auth.signInAnonymously();
			session = anonData.session;
		}

		if (!session) return { session: null, user: null, profile: null };

		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('id', session.user.id)
			.single();

		// Auto-create a guest profile for anonymous users
		if (!profile && session.user.is_anonymous) {
			await event.locals.supabase.from('profiles').insert({
				id: session.user.id,
				role: 'kid',
				display_name: 'Guest',
				avatar_id: 'knight'
			});
			await event.locals.supabase.from('kid_stats').upsert({ kid_id: session.user.id });
			await event.locals.supabase.from('equipped_cosmetics').upsert({ kid_id: session.user.id });
		}

		const resolvedProfile = profile ?? (await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('id', session.user.id)
			.single()).data;

		return { session, user: session.user, profile: resolvedProfile, isGuest: !!session.user.is_anonymous };
	};

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};
