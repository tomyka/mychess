import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
const { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } = env;

export function createSupabaseClient() {
	if (isBrowser()) {
		return createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
	}
	return createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: { getAll: () => [], setAll: () => {} }
	});
}
