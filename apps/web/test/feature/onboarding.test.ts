import { describe, expect, it, vi } from 'vitest';
import { completeOnboardingAction } from '../../src/app/pradzia/actions';
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

function form(displayName: string, locale: string): FormData {
  const data = new FormData();
  data.set('displayName', displayName);
  data.set('locale', locale);
  return data;
}

async function storedAccount(): Promise<unknown> {
  const { rows } = await client.query(
    `select display_name as "displayName", locale,
            onboarded_at is not null as onboarded
       from accounts`,
  );
  return rows;
}

describe('completeOnboardingAction', () => {
  it('stores the name and language, marks the account onboarded and goes home (R-81)', async () => {
    request.cookie = await signIn('ruta@example.lt');
    expect(
      await outcomeOf(completeOnboardingAction({}, form(' Rūta ', 'en'))),
    ).toEqual({ redirectedTo: '/' });
    expect(await storedAccount()).toEqual([
      { displayName: 'Rūta', locale: 'en', onboarded: true },
    ]);
  });

  it('keeps the language in the locale cookie for after sign-out', async () => {
    request.cookie = await signIn('ruta@example.lt');
    await outcomeOf(completeOnboardingAction({}, form('Rūta', 'en')));
    expect(request.set).toEqual([
      {
        name: 'NEXT_LOCALE',
        value: 'en',
        options: { path: '/', maxAge: 31_536_000, sameSite: 'lax' },
      },
    ]);
  });

  it('refuses a blank name and stores nothing', async () => {
    request.cookie = await signIn('ruta@example.lt');
    const before = await storedAccount();
    expect(
      await outcomeOf(completeOnboardingAction({}, form('  ', 'en'))),
    ).toEqual({ refusal: 'displayName.blank' });
    expect(await storedAccount()).toEqual(before);
    expect(await storedAccount()).toEqual([
      expect.objectContaining({ onboarded: false }),
    ]);
    expect(request.set).toEqual([]);
  });

  it('refuses a language the site does not have', async () => {
    request.cookie = await signIn('ruta@example.lt');
    expect(
      await outcomeOf(completeOnboardingAction({}, form('Rūta', 'de'))),
    ).toEqual({ refusal: 'account.localeInvalid' });
  });

  it('sends an onboarded account home without writing anything', async () => {
    request.cookie = await signIn('ruta@example.lt');
    await outcomeOf(completeOnboardingAction({}, form('Rūta', 'en')));
    const stored = async (): Promise<unknown[]> =>
      (
        await client.query<Record<string, unknown>>(
          'select display_name, locale, onboarded_at, updated_at from accounts',
        )
      ).rows;
    const before = await stored();
    request.set = [];
    expect(
      await outcomeOf(completeOnboardingAction({}, form('Jonas', 'lt'))),
    ).toEqual({ redirectedTo: '/' });
    expect(await stored()).toEqual(before);
    expect(before).toEqual([
      expect.objectContaining({ display_name: 'Rūta', locale: 'en' }),
    ]);
    expect(request.set).toEqual([]);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(
      await outcomeOf(completeOnboardingAction({}, form('Rūta', 'en'))),
    ).toEqual({ redirectedTo: '/prisijungti' });
    expect(request.set).toEqual([]);
  });
});
