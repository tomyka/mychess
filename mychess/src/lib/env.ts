// mychess/src/lib/env.ts
/**
 * Narrows a `$env/dynamic/*` value (typed `string | undefined` since it's
 * resolved at runtime, not build time) to `string`, throwing a clear error
 * immediately if it's actually missing rather than letting `undefined` leak
 * into a downstream API (a Supabase client constructor, an OAuth token
 * request body, ...) as an unclear low-level failure.
 */
export function requireEnv(value: string | undefined, name: string): string {
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}
