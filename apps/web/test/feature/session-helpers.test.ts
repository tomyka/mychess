import { describe, expect, it, vi } from 'vitest';
import {
  getAccount,
  requireAccount,
  requireOnboarded,
} from '../../src/server/session';
import { onboard } from './support/auth';
import { signIn, useRequestHarness } from './support/harness';
import { built, outcomeOf, request } from './support/request';

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

const { db, client } = useRequestHarness();

const onboardAsRuta = (): Promise<string> =>
  onboard(built(), db, request.cookie, { displayName: 'Rūta' });

describe('the session helpers', () => {
  it('send a signed-out visitor to sign-in', async () => {
    expect(await getAccount()).toBeNull();
    expect(await outcomeOf(requireAccount())).toEqual({
      redirectedTo: '/sign-in',
    });
    expect(await outcomeOf(requireOnboarded())).toEqual({
      redirectedTo: '/sign-in',
    });
  });

  it('send a new account to onboarding (R-81)', async () => {
    request.cookie = await signIn('ruta@example.lt');
    expect(await requireAccount()).toMatchObject({ email: 'ruta@example.lt' });
    expect(await outcomeOf(requireOnboarded())).toEqual({
      redirectedTo: '/welcome',
    });
  });

  it('let an onboarded account through', async () => {
    request.cookie = await signIn('ruta@example.lt');
    const id = await onboardAsRuta();
    expect(await requireOnboarded()).toMatchObject({
      id,
      displayName: 'Rūta',
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
      redirectedTo: '/sign-in',
    });
  });
});
