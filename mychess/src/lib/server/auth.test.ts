import { describe, it, expect } from 'vitest';
import { requireAccount } from './auth';

function fakeLocals(sessionResult: any) {
	return { safeGetSession: async () => sessionResult } as any;
}

describe('requireAccount', () => {
	it('returns the session data for a signed-in user', async () => {
		const data = { session: { s: 1 }, user: { id: 'u1' }, profile: { id: 'u1' } };
		await expect(requireAccount(fakeLocals(data))).resolves.toEqual(data);
	});

	it('redirects to /login when there is no user', async () => {
		const data = { session: null, user: null, profile: null };
		await expect(requireAccount(fakeLocals(data))).rejects.toMatchObject({ status: 303, location: '/login' });
	});
});
