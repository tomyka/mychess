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

const STAGING = {
  MYCHESS_ENV: 'staging',
  BETTER_AUTH_URL: 'https://staging.mychess.test',
  MYCHESS_TEST_SIGNIN: 'true',
  TEST_SIGNIN_SECRET: SECRET,
};

// A local server with the test sign-in on: plain http, so no Secure cookie.
const LOCAL = { ...STAGING, MYCHESS_ENV: 'local', BETTER_AUTH_URL: BASE };

// Production as it may run: the secret set, the switch off.
const PRODUCTION = {
  ...STAGING,
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
  it('signs a persona in on staging, once per canonical email', async () => {
    const { POST, auth } = await serverOn(STAGING);
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
    const { POST, auth } = await serverOn(STAGING);
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
      const { auth } = await serverOn(STAGING);
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

  it('answers 404 without the flag', async () => {
    const { POST } = await serverOn({
      ...STAGING,
      MYCHESS_TEST_SIGNIN: 'false',
    });
    expect((await POST(asPersona('u1@mychess.test'))).status).toBe(404);
    expect(await accountsInDb()).toEqual([]);
  });

  it.each([
    ['no secret header', post('u1@mychess.test')],
    ['a non-persona email', asPersona('ruta@example.lt')],
  ])('answers 403 to %s, and creates nothing', async (_, request) => {
    const { POST } = await serverOn(STAGING);
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await accountsInDb()).toEqual([]);
    expect(await sessionCount()).toEqual([{ n: 0 }]);
  });

  it('refuses a disabled persona (403) and starts no session (security item 8)', async () => {
    const { POST, auth } = await serverOn(STAGING);
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
    ['an auth without the flag', { ...STAGING, MYCHESS_TEST_SIGNIN: 'false' }],
  ])('refuses on %s: no account, no session', async (_, env) => {
    const { auth } = buildTestAuth(db, { env });
    await expect(
      auth.api.startTestSession({ body: { email: 'u1@mychess.test' } }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await accountsInDb()).toEqual([]);
    expect(await sessionCount()).toEqual([{ n: 0 }]);
  });

  it('starts a session on a staging auth with the flag', async () => {
    const { auth } = buildTestAuth(db, { env: STAGING });
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
    const { auth } = buildTestAuth(db, { env: STAGING });
    await expect(
      auth.api.startTestSession({ body: { email: 'ruta@example.lt' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await accountsInDb()).toEqual([]);
    expect(await sessionCount()).toEqual([{ n: 0 }]);
  });
});
