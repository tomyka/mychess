import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import { requireEnv } from '$lib/env';

export function createSupabaseClient() {
	const PUBLIC_SUPABASE_URL = requireEnv(env.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL');
	const PUBLIC_SUPABASE_ANON_KEY = requireEnv(env.PUBLIC_SUPABASE_ANON_KEY, 'PUBLIC_SUPABASE_ANON_KEY');
	if (isBrowser()) {
		return createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
	}
	return createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: { getAll: () => [], setAll: () => {} }
	});
}
