import { describe, expect, it, vi } from 'vitest';
import { completeOnboardingAction } from '../../src/app/welcome/actions';
import { signIn, useRequestHarness } from './support/harness';
import { outcomeOf, request } from './support/request';

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

const { client } = useRequestHarness();

function form(displayName: string): FormData {
  const data = new FormData();
  data.set('displayName', displayName);
  return data;
}

async function storedAccount(): Promise<unknown> {
  const { rows } = await client.query(
    `select display_name as "displayName",
            onboarded_at is not null as onboarded
       from accounts`,
  );
  return rows;
}

describe('completeOnboardingAction', () => {
  it('stores the name, marks the account onboarded, sets no cookie and goes home (R-81)', async () => {
    request.cookie = await signIn('ruta@example.lt');
    expect(
      await outcomeOf(completeOnboardingAction({}, form(' Rūta '))),
    ).toEqual({ redirectedTo: '/' });
    expect(await storedAccount()).toEqual([
      { displayName: 'Rūta', onboarded: true },
    ]);
    expect(request.set).toEqual([]);
  });

  it('refuses a blank name and stores nothing', async () => {
    request.cookie = await signIn('ruta@example.lt');
    const before = await storedAccount();
    expect(await outcomeOf(completeOnboardingAction({}, form('  ')))).toEqual({
      refusal: 'displayName.blank',
    });
    expect(await storedAccount()).toEqual(before);
    expect(await storedAccount()).toEqual([
      expect.objectContaining({ onboarded: false }),
    ]);
    expect(request.set).toEqual([]);
  });

  it('sends an onboarded account home without writing anything', async () => {
    request.cookie = await signIn('ruta@example.lt');
    await outcomeOf(completeOnboardingAction({}, form('Rūta')));
    const stored = async (): Promise<unknown[]> =>
      (
        await client.query<Record<string, unknown>>(
          'select display_name, onboarded_at, updated_at from accounts',
        )
      ).rows;
    const before = await stored();
    request.set = [];
    expect(
      await outcomeOf(completeOnboardingAction({}, form('Jonas'))),
    ).toEqual({ redirectedTo: '/' });
    expect(await stored()).toEqual(before);
    expect(before).toEqual([expect.objectContaining({ display_name: 'Rūta' })]);
    expect(request.set).toEqual([]);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(await outcomeOf(completeOnboardingAction({}, form('Rūta')))).toEqual(
      { redirectedTo: '/sign-in' },
    );
    expect(request.set).toEqual([]);
  });
});
