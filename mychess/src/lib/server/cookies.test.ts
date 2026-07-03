import { describe, it, expect } from 'vitest';
import { sessionCookieOptions } from './cookies';

describe('sessionCookieOptions', () => {
	it('returns options unchanged when persistence is allowed', () => {
		const opts = { path: '/', maxAge: 3600, sameSite: 'lax' as const };
		expect(sessionCookieOptions(opts, false)).toEqual(opts);
	});
	it('strips maxAge and expires when noPersist is true (session cookie)', () => {
		const opts = { path: '/', maxAge: 3600, expires: new Date(0), sameSite: 'lax' as const, httpOnly: true };
		const out = sessionCookieOptions(opts, true);
		expect('maxAge' in out).toBe(false);
		expect('expires' in out).toBe(false);
		expect(out).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: true });
	});
});
