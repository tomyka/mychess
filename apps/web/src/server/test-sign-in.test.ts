import { describe, expect, it, vi } from 'vitest';
import {
  testSignIn,
  testSignInEnabled,
  type TestSignInDeps,
} from './test-sign-in';

const SECRET = 's'.repeat(32);
const COOKIE = 'mychess.session_token=v; Path=/; HttpOnly; SameSite=Lax';

const deps = (
  over: Partial<TestSignInDeps['env']> = {},
  cookie: { readonly value: string | undefined } = { value: COOKIE },
): TestSignInDeps => ({
  env: {
    MYCHESS_ENV: 'staging',
    MYCHESS_TEST_SIGNIN: true,
    TEST_SIGNIN_SECRET: SECRET,
    ...over,
  },
  signIn: vi.fn<TestSignInDeps['signIn']>().mockResolvedValue(cookie.value),
});

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
    expect(d.signIn).toHaveBeenCalledWith('u1@mychess.test');
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
    expect(d.signIn).not.toHaveBeenCalled();
  });

  it.each([
    ['a wrong secret', post('u1@mychess.test', 'x'.repeat(32))],
    ['a shorter secret', post('u1@mychess.test', 's'.repeat(31))],
    ['a longer secret', post('u1@mychess.test', 's'.repeat(33))],
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
      'a body that is not JSON',
      request('u1@mychess.test', { 'x-test-secret': SECRET }),
    ],
  ])('answers 403 to %s', async (_, r) => {
    const d = deps();
    const response = await testSignIn(r, d);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(d.signIn).not.toHaveBeenCalled();
  });

  it('answers 403 when the account may not sign in (disabled)', async () => {
    const d = deps({}, { value: undefined });
    const response = await testSignIn(post('u1@mychess.test'), d);
    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(d.signIn).toHaveBeenCalledWith('u1@mychess.test');
  });
});

describe('testSignInEnabled', () => {
  it.each([
    ['local', true, true],
    ['staging', true, true],
    ['production', true, false],
    ['local', false, false],
    ['staging', false, false],
  ] as const)('on %s with the switch %s is %s', (env, on, expected) => {
    expect(
      testSignInEnabled({ MYCHESS_ENV: env, MYCHESS_TEST_SIGNIN: on }),
    ).toBe(expected);
  });
});
