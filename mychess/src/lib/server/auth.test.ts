import { describe, it, expect } from 'vitest';
import { requireAccount } from './auth';

function fakeLocals(sessionResult: any) {
	return { safeGetSession: async () => sessionResult } as any;
}

describe('requireAccount', () => {
	it('returns the session data for a real (non-anonymous) user', async () => {
		const data = { session: { s: 1 }, user: { id: 'u1', is_anonymous: false }, profile: { id: 'u1' } };
		await expect(requireAccount(fakeLocals(data))).resolves.toEqual(data);
	});

	it('redirects to /login when there is no user', async () => {
		const data = { session: null, user: null, profile: null };
		await expect(requireAccount(fakeLocals(data))).rejects.toMatchObject({ status: 303, location: '/login' });
	});

	it('redirects to /login when the user is anonymous', async () => {
		const data = { session: { s: 1 }, user: { id: 'a1', is_anonymous: true }, profile: { id: 'a1' } };
		await expect(requireAccount(fakeLocals(data))).rejects.toMatchObject({ status: 303, location: '/login' });
	});
});
