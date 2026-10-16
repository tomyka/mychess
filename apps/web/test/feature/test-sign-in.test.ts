import { disableAccount } from '@mychess/db';
import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BASE, TEST_ENV_VARS } from './support/auth';

const { url, db, client } = useTestDatabase();
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
 * The route and the auth it uses, loaded fresh on `env`: `getAuth`,
 * `getDb` and `readWebEnv` cache what they read, so each case resets the
 * module registry.
 */
async function serverOn(env: Record<string, string>) {
  for (const [name, value] of Object.entries({
    ...TEST_ENV_VARS,
    DATABASE_URL: url,
    ...env,
  }))
    vi.stubEnv(name, value);
  vi.resetModules();
  const route = await import('../../src/app/api/test/sign-in/route');
  const { getAuth } = await import('../../src/server/auth');
  return { POST: route.POST, auth: getAuth() };
}

const STAGING = {
  MYCHESS_ENV: 'staging',
  MYCHESS_TEST_SIGNIN: 'true',
  TEST_SIGNIN_SECRET: SECRET,
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
    const { POST } = await serverOn(STAGING);
    const cookie = (await POST(asPersona('u1@mychess.test'))).headers.get(
      'set-cookie',
    );
    expect(cookie).toMatch(
      /^better-auth\.session_token=[^;.]+\.[^;]+; Max-Age=7776000; Path=\/; HttpOnly; SameSite=Lax$/,
    );
  });

  it('marks the cookie Secure when the auth URL is https', async () => {
    const { POST, auth } = await serverOn({
      ...STAGING,
      BETTER_AUTH_URL: 'https://staging.mychess.test',
    });
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

  it('answers 404 in production even with the flag and secret, and creates nothing', async () => {
    const { POST } = await serverOn({ ...STAGING, MYCHESS_ENV: 'production' });
    const response = await POST(asPersona('u1@mychess.test'));
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await accountsInDb()).toEqual([]);
    expect(await sessionCount()).toEqual([{ n: 0 }]);
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
    await disableAccount(db, 'u1@mychess.test', 'cli', new Date());
    const response = await POST(asPersona('u1@mychess.test'));
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await sessionCount()).toEqual([{ n: 0 }]);
    expect(
      await auth.api.getSession({ headers: cookieHeader(before) }),
    ).toBeNull();
  });
});
