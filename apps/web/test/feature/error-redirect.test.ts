import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE, buildTestAuth } from './support/auth';
import { fakeProviderFetch, oauthCallback, startedFlow } from './support/oauth';

const { db } = useTestDatabase();

afterEach(() => {
  vi.unstubAllGlobals();
});

const location = (response: Response) => response.headers.get('location');

// Security review A9: Better Auth's own /error page is never where a
// person lands; its code goes to the sign-in page, which translates it.
describe('an auth error with no errorCallbackURL', () => {
  it('sends a failed OAuth callback to the sign-in page with its code', async () => {
    vi.stubGlobal('fetch', fakeProviderFetch({}));
    const built = buildTestAuth(db);
    const flow = await startedFlow(built, 'lichess');
    const response = await oauthCallback(built, {
      ...flow,
      state: `${flow.state}x`,
    });
    expect(response.status).toBe(302);
    expect(location(response)).toBe(`${BASE}/prisijungti?error=state_mismatch`);
  });

  it("sends Better Auth's error page on to the sign-in page", async () => {
    const built = buildTestAuth(db);
    const response = await built.auth.handler(
      new Request(`${BASE}/api/auth/error?error=unable_to_create_user`),
    );
    expect(response.status).toBe(302);
    expect(location(response)).toBe(
      `${BASE}/prisijungti?error=unable_to_create_user`,
    );
  });
});
