// A provider sign-in whose link ends while its callback runs (#272). The
// callback finds its link, then a proof of the email (R-87) or an unlink
// ends that link before the callback opens its session: the session must
// not stand, or the squatter keeps a way in to the now-proven account.
import type * as MychessDb from '@mychess/db';
import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTestAuth,
  type BuiltAuth,
  cookieFrom,
  mailedLink,
  requestMagicLink,
  signInByMagicLink,
} from './support/auth';
import {
  errorCode,
  type FakeIdentity,
  fakeProviderFetch,
  oauthCallback,
  oauthRoundTrip,
  type Provider,
  startedFlow,
} from './support/oauth';
import { sqlOn } from './support/rows';

// The seam: the session hook reads the account (is it disabled?) just
// before the session is written, after the callback found its link. A step
// armed here runs once, at that moment.
const midCallback = vi.hoisted(() => {
  const armed: { step?: (() => Promise<void>) | undefined } = {};
  return armed;
});

vi.mock('@mychess/db', async (importOriginal) => {
  const original = await importOriginal<typeof MychessDb>();
  return {
    ...original,
    findAccountById: async (
      ...args: Parameters<typeof original.findAccountById>
    ) => {
      const { step } = midCallback;
      midCallback.step = undefined;
      if (step !== undefined) await step();
      return original.findAccountById(...args);
    },
  };
});

const { db, client } = useTestDatabase();
const { rows, count, accountId } = sqlOn(client);

const EMAIL = 'ruta@example.lt';
const GOOGLE = { sub: 'g1', email: EMAIL, email_verified: true, name: 'Rūta' };
const LICHESS = { id: 'ruta', username: 'Ruta', email: EMAIL };

// Better Auth's own code for a session it was refused (a disabled account
// gets it too); the sign-in page shows the general message for it.
const SESSION_REFUSED = 'unable_to_create_session';

function setup(who: FakeIdentity): BuiltAuth {
  const fetch = fakeProviderFetch(who);
  vi.stubGlobal('fetch', fetch);
  return buildTestAuth(db, { fetch });
}

async function sessionOf(
  built: BuiltAuth,
  cookie: string,
): Promise<string | undefined> {
  const session = await built.auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  return session?.user.id;
}

const providerRows = () =>
  rows('select provider_id from provider_accounts order by provider_id');

afterEach(() => {
  midCallback.step = undefined;
  vi.unstubAllGlobals();
});

// The proofs of the email that end an unproven account's access (R-87):
// each runs in the middle of the squatter's Lichess callback and returns
// the owner's cookie.
const PROOFS: [string, (built: BuiltAuth) => Promise<() => Promise<string>>][] =
  [
    [
      'a magic link',
      async (built) => {
        await requestMagicLink(built, { email: EMAIL, callbackURL: '/' });
        const link = mailedLink(built) ?? '';
        return async () =>
          cookieFrom(await built.auth.handler(new Request(link)));
      },
    ],
    [
      'a Google sign-in',
      async (built) => {
        const flow = await startedFlow(built, 'google');
        return async () => cookieFrom(await oauthCallback(built, flow));
      },
    ],
  ];

describe('a Lichess sign-in racing a proof of the email (#272)', () => {
  it.each(PROOFS)(
    'opens no session when %s ends the Lichess link mid-callback',
    async (_, prepare) => {
      const built = setup({ google: GOOGLE, lichess: LICHESS });
      const squatter = cookieFrom(await oauthRoundTrip(built, 'lichess'));
      const prove = await prepare(built);
      const flow = await startedFlow(built, 'lichess');
      let owner = '';
      midCallback.step = async () => {
        owner = await prove();
      };

      const response = await oauthCallback(built, flow);

      expect(midCallback.step).toBeUndefined();
      expect(errorCode(response)).toBe(SESSION_REFUSED);
      expect(await sessionOf(built, cookieFrom(response))).toBeUndefined();
      expect(await sessionOf(built, squatter)).toBeUndefined();
      const id = await accountId(EMAIL);
      expect(await sessionOf(built, owner)).toBe(id);
      expect(await count('sessions')).toBe(1);
      expect(await rows('select email_verified from accounts')).toEqual([
        { email_verified: true },
      ]);
      expect(
        await count("provider_accounts where provider_id = 'lichess'"),
      ).toBe(0);
    },
  );
});

// A Google sign-in proves the email before Better Auth looks the account up
// (R-87, #365). When the callback fails after the proof, the account is left
// as a magic link would leave it: proven, with the unproven access ended,
// and no Google link or session; signing in again joins.
describe('a Google sign-in that fails after proving the email', () => {
  it('leaves the account proven with no link or session, and the retry joins', async () => {
    const built = setup({ google: GOOGLE, lichess: LICHESS });
    const squatter = cookieFrom(await oauthRoundTrip(built, 'lichess'));
    const flow = await startedFlow(built, 'google');
    // The proof reads the account first; the join's own read, after the
    // proof, is the one that fails.
    midCallback.step = () => {
      midCallback.step = () => Promise.reject(new Error('database went away'));
      return Promise.resolve();
    };

    const response = await oauthCallback(built, flow);

    expect(midCallback.step).toBeUndefined();
    expect(errorCode(response)).not.toBeNull();
    expect(await sessionOf(built, cookieFrom(response))).toBeUndefined();
    expect(await sessionOf(built, squatter)).toBeUndefined();
    expect(await count('sessions')).toBe(0);
    expect(await count('provider_accounts')).toBe(0);
    expect(await rows('select email_verified from accounts')).toEqual([
      { email_verified: true },
    ]);

    const retry = await oauthRoundTrip(built, 'google');
    expect(errorCode(retry)).toBeNull();
    expect(await providerRows()).toEqual([{ provider_id: 'google' }]);
    expect(await sessionOf(built, cookieFrom(retry))).toBe(
      await accountId(EMAIL),
    );
  });
});

describe('a provider sign-in whose own link ends mid-callback', () => {
  // A proven account with both providers linked.
  async function bothLinked(built: BuiltAuth): Promise<void> {
    const cookie = await signInByMagicLink(built, EMAIL);
    await oauthRoundTrip(built, 'lichess', { cookie, link: true });
    await oauthRoundTrip(built, 'google');
    expect(await providerRows()).toEqual([
      { provider_id: 'google' },
      { provider_id: 'lichess' },
    ]);
  }

  it.each<[Provider, Provider]>([
    ['google', 'lichess'],
    ['lichess', 'google'],
  ])(
    'opens no %s session though the %s link stands',
    async (provider, other) => {
      const built = setup({
        google: GOOGLE,
        lichess: { ...LICHESS, email: 'other@example.lt' },
      });
      await bothLinked(built);
      const before = await count('sessions');
      const flow = await startedFlow(built, provider);
      midCallback.step = async () => {
        await client.query(
          'delete from provider_accounts where provider_id = $1',
          [provider],
        );
      };

      const response = await oauthCallback(built, flow);

      expect(errorCode(response)).toBe(SESSION_REFUSED);
      expect(await sessionOf(built, cookieFrom(response))).toBeUndefined();
      expect(await count('sessions')).toBe(before);
      expect(await providerRows()).toEqual([{ provider_id: other }]);
    },
  );

  it.each<Provider>(['google', 'lichess'])(
    'signs in by %s while its link stands',
    async (provider) => {
      const built = setup({
        google: GOOGLE,
        lichess: { ...LICHESS, email: 'other@example.lt' },
      });
      await bothLinked(built);
      const response = await oauthRoundTrip(built, provider);
      expect(errorCode(response)).toBeNull();
      expect(await sessionOf(built, cookieFrom(response))).toBe(
        await accountId(EMAIL),
      );
    },
  );
});
