import { describe, it, expect } from 'vitest';
import { sessionCookieOptions } from './cookies';

describe('sessionCookieOptions', () => {
	it('returns options unchanged (plus forced httpOnly) when persistence is allowed', () => {
		const opts = { path: '/', maxAge: 3600, sameSite: 'lax' as const };
		expect(sessionCookieOptions(opts, false)).toEqual({ ...opts, httpOnly: true });
	});
	it('strips maxAge and expires when noPersist is true (session cookie)', () => {
		const opts = { path: '/', maxAge: 3600, expires: new Date(0), sameSite: 'lax' as const, httpOnly: true };
		const out = sessionCookieOptions(opts, true);
		expect('maxAge' in out).toBe(false);
		expect('expires' in out).toBe(false);
		expect(out).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: true });
	});
	it('forces httpOnly: true even if the input explicitly set it to false', () => {
		// This is the actual bug being guarded against: @supabase/ssr's
		// DEFAULT_COOKIE_OPTIONS sets httpOnly: false on every cookie it asks
		// us to set, which would otherwise silently override SvelteKit's own
		// httpOnly: true default and leave session cookies readable via
		// document.cookie.
		const opts = { path: '/', sameSite: 'lax' as const, httpOnly: false };
		expect(sessionCookieOptions(opts, false).httpOnly).toBe(true);
	});
});
