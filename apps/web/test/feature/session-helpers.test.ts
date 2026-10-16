import { completeOnboarding } from '@mychess/db';
import { useTestDatabase } from '@mychess/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import requestConfig from '../../src/i18n/request';
import {
  getAccount,
  requireAccount,
  requireOnboarded,
} from '../../src/server/session';
import {
  buildTestAuth,
  signInByMagicLink,
  type BuiltAuth,
} from './support/auth';

// What the mocked Next.js request carries, and the auth it is checked against.
const request = vi.hoisted(() => {
  const state: {
    cookie: string;
    localeCookie?: string;
    built?: BuiltAuth;
  } = { cookie: '' };
  return state;
});

function built(): BuiltAuth {
  if (request.built === undefined) throw new Error('no test auth was built');
  return request.built;
}

/** The error the mocked `redirect` throws, naming where it sends. */
class Redirected extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ cookie: request.cookie })),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'NEXT_LOCALE' && request.localeCookie !== undefined
          ? { name, value: request.localeCookie }
          : undefined,
    }),
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

// Outside a React server build next-intl's getRequestConfig refuses to run;
// the request config is the function it wraps.
vi.mock('next-intl/server', () => ({
  getRequestConfig: <T>(config: T): T => config,
}));

vi.mock('../../src/server/db', () => ({ getDb: () => db }));

vi.mock('../../src/server/auth', async (original) => ({
  ...(await original<typeof import('../../src/server/auth')>()),
  getAuth: () => built().auth,
}));

const { db, client } = useTestDatabase();

beforeEach(() => {
  request.built = buildTestAuth(db);
  request.cookie = '';
  delete request.localeCookie;
});

async function signIn(email: string): Promise<void> {
  request.cookie = await signInByMagicLink(built(), email);
}

async function onboard(locale: 'lt' | 'en'): Promise<string> {
  const account = await requireAccount();
  await completeOnboarding(
    db,
    account.id,
    { displayName: 'Rūta', locale },
    new Date(),
  );
  return account.id;
}

const redirectOf = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'no redirect',
    (error: unknown) => (error instanceof Redirected ? error.to : 'other'),
  );

describe('the session helpers', () => {
  it('send a signed-out visitor to sign-in', async () => {
    expect(await getAccount()).toBeNull();
    expect(await redirectOf(requireAccount())).toBe('/prisijungti');
    expect(await redirectOf(requireOnboarded())).toBe('/prisijungti');
  });

  it('send a new account to onboarding (R-81)', async () => {
    await signIn('ruta@example.lt');
    expect(await requireAccount()).toMatchObject({ email: 'ruta@example.lt' });
    expect(await redirectOf(requireOnboarded())).toBe('/pradzia');
  });

  it('let an onboarded account through', async () => {
    await signIn('ruta@example.lt');
    const id = await onboard('en');
    expect(await requireOnboarded()).toMatchObject({
      id,
      displayName: 'Rūta',
      locale: 'en',
    });
  });

  it('read a disabled account as signed out, even with its session left', async () => {
    await signIn('ruta@example.lt');
    await client.query('update accounts set disabled_at = now()');
    expect(
      (await client.query('select count(*)::int as n from sessions')).rows,
    ).toEqual([{ n: 1 }]);
    expect(await getAccount()).toBeNull();
    expect(await redirectOf(requireAccount())).toBe('/prisijungti');
  });
});

// The locale next-intl renders this request in.
const requestLocale = async (): Promise<string | undefined> =>
  (await requestConfig({ requestLocale: Promise.resolve(undefined) })).locale;

describe('the request locale', () => {
  it('follows the cookie while signed out', async () => {
    expect(await requestLocale()).toBe('lt');
    request.localeCookie = 'en';
    expect(await requestLocale()).toBe('en');
  });

  it("is the account's once signed in, whatever the cookie says", async () => {
    await signIn('ruta@example.lt');
    request.localeCookie = 'en';
    expect(await requestLocale()).toBe('lt');
    await onboard('en');
    request.localeCookie = 'lt';
    expect(await requestLocale()).toBe('en');
  });
});
