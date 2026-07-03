export interface CookieOptions {
	path?: string;
	maxAge?: number;
	expires?: Date;
	[key: string]: unknown;
}

/**
 * When noPersist is true, remove maxAge/expires so the cookie becomes a
 * session cookie (cleared when the browser closes). Otherwise unchanged.
 */
export function sessionCookieOptions<T extends CookieOptions>(options: T, noPersist: boolean): T {
	if (!noPersist) return options;
	const { maxAge, expires, ...rest } = options;
	return rest as T;
}
