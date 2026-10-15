// mychess/src/lib/server/supabase-admin.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { requireEnv } from '$lib/env';

/**
 * A service-role Supabase client, for writes the PLAYER must not be able to
 * make for themselves.
 *
 * RLS cannot tell "our server, acting for this player" from "this player
 * calling PostgREST directly" — both arrive with the same JWT. So any table
 * whose rows are a server-side decision has to stay closed to the anon key and
 * be written through this instead. `badges_earned` is the case that prompted
 * extracting it (GitHub issue #221): it had no INSERT policy at all, and the
 * grant path was handing it `locals.supabase`, so no badge was ever awarded.
 *
 * Living under `$lib/server/` is load-bearing, not tidiness: SvelteKit refuses
 * to bundle anything under that path into client code, so importing this makes
 * a module server-only and the mistake is caught at build time rather than by
 * shipping the service key to a browser.
 *
 * Built per call rather than once at module load: `$env/dynamic/private` is
 * resolved at runtime, and a module-level client would be constructed during
 * prerender/build where the key legitimately is not set yet.
 */
export function createAdminClient(): SupabaseClient {
	// A test process has mychess/.env loaded, so without this a unit test that
	// happens to drive a privileged write reaches PRODUCTION and succeeds — the
	// service role bypasses every policy that would otherwise stop it. Caught
	// for real while fixing #221: `repertoire-progress.test.ts` drives a badge
	// grant with a fake client, and the moment the write moved off that client
	// it went straight to the live database (it only failed because the
	// fixture's 'player-1' is not a uuid). A loud throw naming the seam is the
	// only safe default; the alternative is silent writes nobody looks for.
	if (process.env.VITEST) {
		throw new Error(
			'createAdminClient() must not be called from a test — inject a client instead (see grantNewBadges\'s `writeClient`).'
		);
	}
	const serviceKey = requireEnv(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
	const url = requireEnv(pubEnv.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL');
	return createClient(url, serviceKey);
}
