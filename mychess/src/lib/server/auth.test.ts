import { describe, it, expect, vi } from 'vitest';
import { requireAccount, ensureGuestSession } from './auth';

vi.mock('./guest', () => ({ ensureGuestProfile: vi.fn(async () => {}) }));

function fakeLocals(sessionResult: any) {
	return { safeGetSession: async () => sessionResult } as any;
}

function fakeGuestLocals(opts: { existingSession?: any; freshProfile?: any }) {
	return {
		safeGetSession: async () => opts.existingSession ?? { session: null, user: null, profile: null },
		supabase: {
			auth: {
				signInAnonymously: async () => ({
					data: { session: { user: { id: 'g1', is_anonymous: true } } },
					error: null
				})
			},
			from: () => ({
				select: () => ({
					eq: () => ({
						single: async () => ({ data: opts.freshProfile ?? null })
					})
				})
			})
		}
	} as any;
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

describe('ensureGuestSession', () => {
	it('returns the existing session as-is without creating a new one', async () => {
		const existing = { session: { s: 1 }, user: { id: 'u1' }, profile: { id: 'u1' } };
		const locals = fakeGuestLocals({ existingSession: existing });
		await expect(ensureGuestSession(locals)).resolves.toEqual(existing);
	});

	it('returns the freshly-created profile after signing in anonymously, not a stale/null one', async () => {
		// Regression guard: safeGetSession() is memoized per-request (see
		// hooks.server.ts), so this must NOT rely on calling it a second time
		// to observe the session/profile just created — it would just replay
		// the first "no session yet" result.
		const profile = { id: 'g1', display_name: 'Guest' };
		const locals = fakeGuestLocals({ freshProfile: profile });
		const result = await ensureGuestSession(locals);
		expect(result).toMatchObject({ user: { id: 'g1' }, profile, isGuest: true });
	});
});
