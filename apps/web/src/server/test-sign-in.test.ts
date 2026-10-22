import { describe, expect, it, vi } from 'vitest';
import { webEnvSchema } from './env';
import { testSignIn, type TestSignInDeps } from './test-sign-in';

const SECRET = 's'.repeat(32);

// A complete deployed environment (src/server/env.ts) without MYCHESS_ENV.
const DEPLOYED_ENV = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/mychess',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://staging.mychess.lt',
  MAIL_TRANSPORT: 'resend',
  RESEND_API_KEY: 're_x',
  MAIL_FROM: 'mychess <noreply@mychess.test>',
  LICHESS_CLIENT_ID: 'mychess',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
};
const COOKIE = 'mychess.session_token=v; Path=/; HttpOnly; SameSite=Lax';

type StartTestSession = TestSignInDeps['auth']['api']['startTestSession'];

/** The headers the session start answers with: its cookie, or none. */
const answer = (cookie: string | undefined) =>
  new Headers(cookie === undefined ? {} : { 'set-cookie': cookie });

const deps = (
  over: Partial<TestSignInDeps['env']> = {},
  cookie: { readonly value: string | undefined } = { value: COOKIE },
) => {
  const startTestSession = vi
    .fn<StartTestSession>()
    .mockResolvedValue({ headers: answer(cookie.value) });
  const d: TestSignInDeps = {
    env: {
      MYCHESS_ENV: 'staging',
      MYCHESS_TEST_SIGNIN: true,
      TEST_SIGNIN_SECRET: SECRET,
      ...over,
    },
    auth: { api: { startTestSession } },
  };
  return { ...d, startTestSession };
};

const request = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://x/api/test/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

const post = (email: string, secret = SECRET) =>
  request(JSON.stringify({ email }), { 'x-test-secret': secret });

describe('testSignIn (R-73)', () => {
  it('signs a persona in on staging with its canonical email', async () => {
    const d = deps();
    const response = await testSignIn(post(' U1@MyChess.test '), d);
    expect(response.status).toBe(204);
    expect(d.startTestSession).toHaveBeenCalledWith({
      body: { email: 'u1@mychess.test' },
      returnHeaders: true,
    });
    expect(response.headers.get('set-cookie')).toBe(COOKIE);
  });

  it('signs a persona in locally too', async () => {
    const d = deps({ MYCHESS_ENV: 'local' });
    expect((await testSignIn(post('u1@mychess.test'), d)).status).toBe(204);
  });

  it.each([
    [
      'production, even with the flag and secret',
      deps({ MYCHESS_ENV: 'production' }),
    ],
    ['no flag', deps({ MYCHESS_TEST_SIGNIN: false })],
    ['no secret configured', deps({ TEST_SIGNIN_SECRET: undefined })],
  ])('answers 404 on %s', async (_, d) => {
    const response = await testSignIn(post('u1@mychess.test'), d);
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(d.startTestSession).not.toHaveBeenCalled();
  });

  it.each([
    ['a wrong secret', post('u1@mychess.test', 'x'.repeat(32))],
    ['a shorter secret', post('u1@mychess.test', 's'.repeat(31))],
    ['a longer secret', post('u1@mychess.test', 's'.repeat(33))],
    ['a non-ASCII secret', post('u1@mychess.test', 'é'.repeat(32))],
    ['no secret header', request(JSON.stringify({ email: 'u1@mychess.test' }))],
    ['another domain', post('ruta@example.lt')],
    ['a look-alike domain', post('u1@mychess.test.evil.lt')],
    ['a look-alike prefix', post('u1@evilmychess.test')],
    ['the bare domain', post('@mychess.test')],
    ['an invalid email', post('not an email')],
    [
      'a body without an email',
      request(JSON.stringify({ mail: 'u1@mychess.test' }), {
        'x-test-secret': SECRET,
      }),
    ],
    [
      'an email that is not a string',
      request(JSON.stringify({ email: 1 }), { 'x-test-secret': SECRET }),
    ],
    [
      'a body that is not JSON',
      request('u1@mychess.test', { 'x-test-secret': SECRET }),
    ],
  ])('answers 403 to %s', async (_, r) => {
    const d = deps();
    const response = await testSignIn(r, d);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(d.startTestSession).not.toHaveBeenCalled();
  });

  it('answers 403 when the account may not sign in (disabled)', async () => {
    const d = deps({}, { value: undefined });
    const response = await testSignIn(post('u1@mychess.test'), d);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(d.startTestSession).toHaveBeenCalledOnce();
  });

  // Staging is its own Vercel project; its env as Vercel hands it over.
  it('is on for a Vercel deployment named staging', async () => {
    const env = webEnvSchema.parse({
      ...DEPLOYED_ENV,
      VERCEL: '1',
      MYCHESS_ENV: 'staging',
      MYCHESS_TEST_SIGNIN: '1',
      TEST_SIGNIN_SECRET: SECRET,
    });
    const response = await testSignIn(post('u1@mychess.test'), {
      ...deps(),
      env,
    });
    expect(response.status).toBe(204);
  });

  it('cannot be switched on for a Vercel deployment named production', () => {
    const result = webEnvSchema.safeParse({
      ...DEPLOYED_ENV,
      VERCEL: '1',
      MYCHESS_ENV: 'production',
      MYCHESS_TEST_SIGNIN: '1',
      TEST_SIGNIN_SECRET: SECRET,
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['MYCHESS_TEST_SIGNIN'],
    ]);
  });
});
