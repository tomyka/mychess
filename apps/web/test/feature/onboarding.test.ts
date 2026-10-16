import { useTestDatabase } from '@mychess/db/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOnboardingAction } from '../../src/app/pradzia/actions';
import {
  buildTestAuth,
  signInByMagicLink,
  type BuiltAuth,
} from './support/auth';

interface SetCookie {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

// What the mocked Next.js request carries, and the cookies the action set.
const request = vi.hoisted(() => {
  const state: { cookie: string; set: SetCookie[]; built?: BuiltAuth } = {
    cookie: '',
    set: [],
  };
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
      set: (name: string, value: string, options: Record<string, unknown>) => {
        request.set.push({ name, value, options });
      },
    }),
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
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
  request.set = [];
});

function form(displayName: string, locale: string): FormData {
  const data = new FormData();
  data.set('displayName', displayName);
  data.set('locale', locale);
  return data;
}

const outcomeOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    (state) => state,
    (error: unknown) =>
      error instanceof Redirected ? { redirectedTo: error.to } : error,
  );

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
    request.cookie = await signInByMagicLink(built(), 'ruta@example.lt');
    expect(
      await outcomeOf(completeOnboardingAction({}, form(' Rūta ', 'en'))),
    ).toEqual({ redirectedTo: '/' });
    expect(await storedAccount()).toEqual([
      { displayName: 'Rūta', locale: 'en', onboarded: true },
    ]);
  });

  it('keeps the language in the locale cookie for after sign-out', async () => {
    request.cookie = await signInByMagicLink(built(), 'ruta@example.lt');
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
    request.cookie = await signInByMagicLink(built(), 'ruta@example.lt');
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
    request.cookie = await signInByMagicLink(built(), 'ruta@example.lt');
    expect(
      await outcomeOf(completeOnboardingAction({}, form('Rūta', 'de'))),
    ).toEqual({ refusal: 'account.localeInvalid' });
  });

  it('sends an onboarded account home without writing anything', async () => {
    request.cookie = await signInByMagicLink(built(), 'ruta@example.lt');
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
