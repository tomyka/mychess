import { describe, expect, it, vi } from 'vitest';
import requestConfig from '../../src/i18n/request';
import {
  getAccount,
  requireAccount,
  requireOnboarded,
} from '../../src/server/session';
import { onboard } from './support/auth';
import { signIn, useRequestHarness } from './support/harness';
import { built, outcomeOf, request, setRequestCookie } from './support/request';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('next/navigation', async () =>
  (await import('./support/request')).nextNavigation(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

// Outside a React server build next-intl's getRequestConfig refuses to run;
// the request config is the function it wraps.
vi.mock('next-intl/server', () => ({
  getRequestConfig: <T>(config: T): T => config,
}));

const { db, client } = useRequestHarness();

const onboardAs = (locale: 'lt' | 'en'): Promise<string> =>
  onboard(built(), db, request.cookie, { displayName: 'Rūta', locale });

describe('the session helpers', () => {
  it('send a signed-out visitor to sign-in', async () => {
    expect(await getAccount()).toBeNull();
    expect(await outcomeOf(requireAccount())).toEqual({
      redirectedTo: '/prisijungti',
    });
    expect(await outcomeOf(requireOnboarded())).toEqual({
      redirectedTo: '/prisijungti',
    });
  });

  it('send a new account to onboarding (R-81)', async () => {
    request.cookie = await signIn('ruta@example.lt');
    expect(await requireAccount()).toMatchObject({ email: 'ruta@example.lt' });
    expect(await outcomeOf(requireOnboarded())).toEqual({
      redirectedTo: '/pradzia',
    });
  });

  it('let an onboarded account through', async () => {
    request.cookie = await signIn('ruta@example.lt');
    const id = await onboardAs('en');
    expect(await requireOnboarded()).toMatchObject({
      id,
      displayName: 'Rūta',
      locale: 'en',
    });
  });

  it('read a disabled account as signed out, even with its session left', async () => {
    request.cookie = await signIn('ruta@example.lt');
    await client.query('update accounts set disabled_at = now()');
    expect(
      (await client.query('select count(*)::int as n from sessions')).rows,
    ).toEqual([{ n: 1 }]);
    expect(await getAccount()).toBeNull();
    expect(await outcomeOf(requireAccount())).toEqual({
      redirectedTo: '/prisijungti',
    });
  });
});

// The locale next-intl renders this request in.
const requestLocale = async (): Promise<string | undefined> =>
  (await requestConfig({ requestLocale: Promise.resolve(undefined) })).locale;

describe('the request locale', () => {
  it('follows the cookie while signed out', async () => {
    expect(await requestLocale()).toBe('lt');
    setRequestCookie('NEXT_LOCALE', 'en');
    expect(await requestLocale()).toBe('en');
  });

  it("is the account's once signed in, whatever the cookie says", async () => {
    request.cookie = await signIn('ruta@example.lt');
    setRequestCookie('NEXT_LOCALE', 'en');
    expect(await requestLocale()).toBe('lt');
    await onboardAs('en');
    setRequestCookie('NEXT_LOCALE', 'lt');
    expect(await requestLocale()).toBe('en');
  });
});
