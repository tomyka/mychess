export interface CookieOptions {
	path?: string;
	maxAge?: number;
	expires?: Date;
	[key: string]: unknown;
}

/**
 * When noPersist is true, remove maxAge/expires so the cookie becomes a
 * session cookie (cleared when the browser closes). Otherwise unchanged.
 *
 * Also force httpOnly: true regardless of what's already on `options` —
 * @supabase/ssr's own DEFAULT_COOKIE_OPTIONS sets httpOnly: false, which
 * would otherwise silently override SvelteKit's httpOnly: true framework
 * default and leave auth cookies readable via document.cookie. The
 * hooks.server.ts call site already passes an explicit `cookieOptions`
 * override to fix this at the source — this is a second, independent
 * safety net so the same mistake can't quietly resurface if that override
 * is ever removed or a new call site forgets it.
 */
export function sessionCookieOptions<T extends CookieOptions>(options: T, noPersist: boolean): T {
	const withHttpOnly = { ...options, httpOnly: true };
	if (!noPersist) return withHttpOnly;
	const { maxAge, expires, ...rest } = withHttpOnly;
	return rest as T;
}
