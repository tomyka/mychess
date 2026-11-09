import { disableAccount } from '@mychess/db';
import { TEST_AUDIT_EMAIL_KEY, useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BASE, buildTestAuth, TEST_ENV_VARS } from './support/auth';

const { db, client } = useTestDatabase();
const SECRET = 'persona-secret-persona-secret-persona';

const accountRows = z.array(
  z.object({
    email: z.string(),
    display_name: z.string(),
    email_verified: z.boolean(),
  }),
);

const accountsInDb = async () =>
  accountRows.parse(
    (
      await client.query(
        'select email, display_name, email_verified from accounts',
      )
    ).rows,
  );

const sessionCount = async (): Promise<unknown> =>
  (await client.query('select count(*)::int as n from sessions')).rows;

/**
 * The route and the auth it uses, loaded fresh on `env`: `getAuth` and
 * `readWebEnv` cache what they read, so each case resets the module
 * registry. `getDb` answers with this file's own connection (the
 * environment names an unreachable database), so no case opens a pool it
 * would leave open.
 */
async function serverOn(env: Record<string, string>) {
  for (const [name, value] of Object.entries({ ...TEST_ENV_VARS, ...env }))
    vi.stubEnv(name, value);
  vi.resetModules();
  vi.doMock('../../src/server/db', () => ({ getDb: () => db }));
  const route = await import('../../src/app/api/test/sign-in/route');
  const { getAuth } = await import('../../src/server/auth');
  return { POST: route.POST, auth: getAuth() };
}

// A local server with the test sign-in on: plain http, so no Secure cookie.
// Local is the only environment the sign-in exists in (R-73, R-93, R-166).
const LOCAL = {
  MYCHESS_ENV: 'local',
  BETTER_AUTH_URL: BASE,
  MYCHESS_TEST_SIGNIN: 'true',
  TEST_SIGNIN_SECRET: SECRET,
};

// The same local server behind an https URL, so the cookie is Secure.
const LOCAL_HTTPS = { ...LOCAL, BETTER_AUTH_URL: 'https://mychess.localhost' };

// Production as it may run: the secret set, the switch off.
const PRODUCTION = {
  ...LOCAL,
  MYCHESS_ENV: 'production',
  BETTER_AUTH_URL: 'https://mychess.test',
  MYCHESS_TEST_SIGNIN: 'false',
};

const post = (email: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}/api/test/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email }),
  });

const asPersona = (email: string) => post(email, { 'x-test-secret': SECRET });

const cookieHeader = (response: Response) =>
  new Headers({
    cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('../../src/server/db');
});

describe('POST /api/test/sign-in (R-73)', () => {
  it('signs a persona in locally, once per canonical email', async () => {
    const { POST, auth } = await serverOn(LOCAL);
    const first = await POST(asPersona('u1@mychess.test'));
    const second = await POST(asPersona(' U1@MyChess.TEST '));
    expect([first.status, second.status]).toEqual([204, 204]);
    for (const response of [first, second]) {
      const session = await auth.api.getSession({
        headers: cookieHeader(response),
      });
      expect(session?.user.email).toBe('u1@mychess.test');
    }
    expect(await accountsInDb()).toEqual([
      { email: 'u1@mychess.test', display_name: '', email_verified: true },
    ]);
  });

  it('sets the session cookie Better Auth itself would set', async () => {
    const { POST } = await serverOn(LOCAL);
    const cookie = (await POST(asPersona('u1@mychess.test'))).headers.get(
      'set-cookie',
    );
    expect(cookie).toMatch(
      /^better-auth\.session_token=[^;.]+\.[^;]+; Max-Age=7776000; Path=\/; HttpOnly; SameSite=Lax$/,
    );
  });

  it('marks the cookie Secure when the auth URL is https', async () => {
    const { POST, auth } = await serverOn(LOCAL_HTTPS);
    const response = await POST(asPersona('u1@mychess.test'));
    expect(response.headers.get('set-cookie')).toMatch(
      /^__Secure-better-auth\.session_token=[^;]+; Max-Age=7776000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    const session = await auth.api.getSession({
      headers: cookieHeader(response),
    });
    expect(session?.user.email).toBe('u1@mychess.test');
  });

  it.each(['/api/auth/start-test-session', '/api/auth/startTestSession'])(
    'is not reachable over Better Auth HTTP handler (%s)',
    async (path) => {
      const { auth } = await serverOn(LOCAL);
      const response = await auth.handler(
        new Request(`${BASE}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: BASE },
          body: JSON.stringify({ email: 'u1@mychess.test' }),
        }),
      );
      expect(response.status).toBe(404);
      expect(await accountsInDb()).toEqual([]);
    },
  );

  it('answers 404 in production, even with the secret, and creates nothing', async () => {
    const { POST } = await serverOn(PRODUCTION);
    const response = await POST(asPersona('u1@mychess.test'));
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await accountsInDb()).toEqual([]);
    expect(await sessionCount()).toEqual([{ n: 0 }]);
  });

  // R-73, R-93: production refuses the switch itself, before any request.
  it('refuses to start a production server with the flag on', async () => {
    await expect(
      serverOn({ ...PRODUCTION, MYCHESS_TEST_SIGNIN: 'true' }),
    ).rejects.toThrow(/MYCHESS_TEST_SIGNIN/);
    expect(await accountsInDb()).toEqual([]);
  });

  // R-166: staging is gone, so a server still named staging does not start
  // rather than keeping the sign-in on under a name it no longer knows.
  it('refuses to start a server named staging with the flag on', async () => {
    await expect(
      serverOn({ ...LOCAL_HTTPS, MYCHESS_ENV: 'staging' }),
    ).rejects.toThrow(/MYCHESS_ENV/);
    expect(await accountsInDb()).toEqual([]);
  });

  it('answers 404 without the flag', async () => {
    const { POST } = await serverOn({
      ...LOCAL,
      MYCHESS_TEST_SIGNIN: 'false',
    });
    expect((await POST(asPersona('u1@mychess.test'))).status).toBe(404);
    expect(await accountsInDb()).toEqual([]);
  });

  it.each([
    ['no secret header', post('u1@mychess.test')],
    ['a non-persona email', asPersona('ruta@example.lt')],
  ])('answers 403 to %s, and creates nothing', async (_, request) => {
    const { POST } = await serverOn(LOCAL);
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await accountsInDb()).toEqual([]);
    expect(await sessionCount()).toEqual([{ n: 0 }]);
  });

  it('refuses a disabled persona (403) and starts no session (security item 8)', async () => {
    const { POST, auth } = await serverOn(LOCAL);
    const before = await POST(asPersona('u1@mychess.test'));
    await disableAccount(db, {
      email: 'u1@mychess.test',
      actor: 'cli',
      now: new Date(),
      key: TEST_AUDIT_EMAIL_KEY,
    });
    const response = await POST(asPersona('u1@mychess.test'));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await sessionCount()).toEqual([{ n: 0 }]);
    expect(
      await auth.api.getSession({ headers: cookieHeader(before) }),
    ).toBeNull();
  });
});

// Defence in depth: the endpoint itself refuses where the route would 404,
// whoever calls it.
describe('startTestSession, called directly', () => {
  it.each([
    ['a production auth', PRODUCTION],
    ['an auth without the flag', { ...LOCAL, MYCHESS_TEST_SIGNIN: 'false' }],
  ])('refuses on %s: no account, no session', async (_, env) => {
    const { auth } = buildTestAuth(db, { env });
    await expect(
      auth.api.startTestSession({ body: { email: 'u1@mychess.test' } }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await accountsInDb()).toEqual([]);
    expect(await sessionCount()).toEqual([{ n: 0 }]);
  });

  it('starts a session on a local https auth with the flag', async () => {
    const { auth } = buildTestAuth(db, { env: LOCAL_HTTPS });
    const { headers } = await auth.api.startTestSession({
      body: { email: 'u1@mychess.test' },
      returnHeaders: true,
    });
    expect(headers.get('set-cookie')).toMatch(
      /^__Secure-better-auth\.session_token=/,
    );
    expect(await sessionCount()).toEqual([{ n: 1 }]);
  });

  it('refuses a non-persona email itself: no account, no session', async () => {
    const { auth } = buildTestAuth(db, { env: LOCAL });
    await expect(
      auth.api.startTestSession({ body: { email: 'ruta@example.lt' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await accountsInDb()).toEqual([]);
    expect(await sessionCount()).toEqual([{ n: 0 }]);
  });
});
