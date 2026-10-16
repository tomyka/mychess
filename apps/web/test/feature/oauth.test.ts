import { useTestDatabase } from '@mychess/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LICHESS_EMAIL_IN_USE } from '../../src/lib/sign-in-errors';
import {
  buildTestAuth,
  type BuiltAuth,
  cookieFrom,
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
  startOAuth,
} from './support/oauth';

const { db, client } = useTestDatabase();
const rows = async (sql: string): Promise<unknown[]> => {
  const result = await client.query<Record<string, unknown>>(sql);
  return result.rows;
};
const count = async (table: string): Promise<number> => {
  const [row] = z
    .array(z.object({ n: z.number() }))
    .parse(await rows(`select count(*)::int as n from ${table}`));
  return row?.n ?? 0;
};

// Better Auth's token exchange uses the global fetch; Lichess's identity
// calls use the one createAuth is given. Both answer as `who`.
function setup(who: FakeIdentity): BuiltAuth {
  const fetch = fakeProviderFetch(who);
  vi.stubGlobal('fetch', fetch);
  return buildTestAuth(db, { fetch });
}

// The account a cookie header is signed in to, if any.
async function sessionOf(
  built: BuiltAuth,
  cookie: string,
): Promise<string | undefined> {
  const session = await built.auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  return session?.user.id;
}

const signedInAs = (built: BuiltAuth, response: Response) =>
  sessionOf(built, cookieFrom(response));

// The id of the one account there is.
async function onlyAccountId(): Promise<string> {
  const ids = z
    .array(z.object({ id: z.string() }))
    .parse(await rows('select id from accounts'));
  const [only, ...others] = ids;
  if (only === undefined || others.length > 0)
    throw new Error(`expected one account, found ${String(ids.length)}`);
  return only.id;
}

// The account the Lichess-disconnected notice was left for (R-90), if any.
const unlinkedNotice = (cookie: string): string | undefined =>
  /(?:^|; )mychess\.lichess_unlinked=([^;]*)/.exec(cookie)?.[1];

const accessTokens = async (): Promise<string[]> =>
  z
    .array(z.object({ access_token: z.string() }))
    .parse(await rows('select access_token from provider_accounts'))
    .map((r) => r.access_token);

afterEach(() => {
  vi.unstubAllGlobals();
});

const GOOGLE = {
  sub: 'g1',
  email: 'ruta@example.lt',
  email_verified: true,
  name: 'Rūta',
};
const LICHESS = { id: 'ruta', username: 'Ruta', email: 'ruta@example.lt' };
const BOTH: FakeIdentity = { google: GOOGLE, lichess: LICHESS };

describe('Google', () => {
  it.each([
    ['client id', { GOOGLE_CLIENT_ID: '' }],
    ['client secret', { GOOGLE_CLIENT_SECRET: '' }],
  ])(
    'offers no Google sign-in without a %s: refused as unknown, not a server error (A7)',
    async (_, env) => {
      const built = buildTestAuth(db, { env });
      const response = await startOAuth(built, 'google');
      expect(response.status).toBe(404);
      expect(await count('accounts')).toBe(0);
    },
  );

  it('creates an account with the Google name prefilled, not onboarded', async () => {
    const built = setup({ google: GOOGLE });
    const response = await oauthRoundTrip(built, 'google');
    expect(
      await rows('select email, display_name, onboarded_at from accounts'),
    ).toEqual([
      { email: 'ruta@example.lt', display_name: 'Rūta', onboarded_at: null },
    ]);
    expect(await signedInAs(built, response)).toBe(await onlyAccountId());
  });

  it('signs a returning Google identity in to the same account', async () => {
    const built = setup({ google: GOOGLE });
    await oauthRoundTrip(built, 'google');
    const response = await oauthRoundTrip(built, 'google');
    expect(errorCode(response)).toBeNull();
    expect(await count('provider_accounts')).toBe(1);
    expect(await signedInAs(built, response)).toBe(await onlyAccountId());
  });

  it('joins the existing account with the same verified email (R-69)', async () => {
    const built = setup({ google: GOOGLE });
    await signInByMagicLink(built, 'ruta@example.lt');
    // Better Auth joins only an account whose own email is verified.
    expect(await rows('select email_verified from accounts')).toEqual([
      { email_verified: true },
    ]);
    const response = await oauthRoundTrip(built, 'google');
    expect(await rows('select provider_id from provider_accounts')).toEqual([
      { provider_id: 'google' },
    ]);
    expect(await signedInAs(built, response)).toBe(await onlyAccountId());
  });

  it('refuses an unverified Google email for an existing account: no link', async () => {
    const built = setup({ google: { ...GOOGLE, email_verified: false } });
    await signInByMagicLink(built, 'ruta@example.lt');
    const response = await oauthRoundTrip(built, 'google');
    expect(errorCode(response)).not.toBeNull();
    expect(await count('accounts')).toBe(1);
    expect(await count('provider_accounts')).toBe(0);
    expect(await signedInAs(built, response)).toBeUndefined();
  });

  it('refuses an unverified Google email with no account: nothing is created', async () => {
    const built = setup({ google: { ...GOOGLE, email_verified: false } });
    const response = await oauthRoundTrip(built, 'google');
    expect(errorCode(response)).not.toBeNull();
    expect(await count('accounts')).toBe(0);
    expect(await count('provider_accounts')).toBe(0);
    expect(await count('sessions')).toBe(0);
  });

  it('does not sign in with a Google id token posted by the client', async () => {
    const built = setup({ google: GOOGLE });
    const response = await startOAuth(built, 'google', {
      body: { idToken: { token: 'e30.e30.sig' } },
    });
    expect(response.status).toBe(400);
    expect(await count('accounts')).toBe(0);
  });
});

// A Google sign-in with a verified email proves the mailbox, as a magic
// link does (R-87): whatever reached an account before its email was
// proven (a Lichess sign-up with that address) ends, and Google joins.
describe('Google proving the email of an account Lichess created', () => {
  // Someone signs up with Lichess under Rūta's address: the account is
  // unproven, with a Lichess link and a session. Returns that session.
  async function lichessSignUp(built: BuiltAuth): Promise<string> {
    const cookie = cookieFrom(await oauthRoundTrip(built, 'lichess'));
    expect(await rows('select email_verified from accounts')).toEqual([
      { email_verified: false },
    ]);
    expect(await sessionOf(built, cookie)).toBe(await onlyAccountId());
    return cookie;
  }

  it('ends the Lichess link and its sessions, proves the email and lets Google in', async () => {
    const built = setup(BOTH);
    const lichessSession = await lichessSignUp(built);
    const response = await oauthRoundTrip(built, 'google');
    expect(errorCode(response)).toBeNull();
    expect(await rows('select provider_id from provider_accounts')).toEqual([
      { provider_id: 'google' },
    ]);
    expect(await rows('select email_verified from accounts')).toEqual([
      { email_verified: true },
    ]);
    expect(await sessionOf(built, lichessSession)).toBeUndefined();
    expect(await signedInAs(built, response)).toBe(await onlyAccountId());
    expect(unlinkedNotice(cookieFrom(response))).toBe(await onlyAccountId());
  });

  it('changes nothing of a disabled account: it opens no session either (R-80)', async () => {
    const built = setup(BOTH);
    const lichessSession = await lichessSignUp(built);
    await client.query('update accounts set disabled_at = now()');
    const response = await oauthRoundTrip(built, 'google');
    expect(errorCode(response)).not.toBeNull();
    expect(
      await rows(
        'select provider_id, provider_account_id from provider_accounts',
      ),
    ).toEqual([{ provider_id: 'lichess', provider_account_id: 'ruta' }]);
    expect(await count('sessions')).toBe(1);
    expect(await sessionOf(built, lichessSession)).toBe(await onlyAccountId());
    expect(await rows('select email_verified from accounts')).toEqual([
      { email_verified: false },
    ]);
    expect(unlinkedNotice(cookieFrom(response))).toBeUndefined();
    expect(await signedInAs(built, response)).toBeUndefined();
  });

  it('leaves Lichess no way back in by email afterwards', async () => {
    const built = setup(BOTH);
    await lichessSignUp(built);
    await oauthRoundTrip(built, 'google');
    const again = await oauthRoundTrip(built, 'lichess');
    expect(errorCode(again)).toBe(LICHESS_EMAIL_IN_USE);
    expect(await signedInAs(built, again)).toBeUndefined();
    expect(await rows('select provider_id from provider_accounts')).toEqual([
      { provider_id: 'google' },
    ]);
  });

  it('keeps the Lichess link of an account whose email was already proven', async () => {
    const built = setup({
      google: GOOGLE,
      lichess: { ...LICHESS, email: 'other@example.lt' },
    });
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    await oauthRoundTrip(built, 'lichess', { cookie, link: true });
    const response = await oauthRoundTrip(built, 'google');
    expect(errorCode(response)).toBeNull();
    expect(
      await rows(
        'select provider_id from provider_accounts order by provider_id',
      ),
    ).toEqual([{ provider_id: 'google' }, { provider_id: 'lichess' }]);
    expect(await sessionOf(built, cookie)).toBe(await onlyAccountId());
    expect(unlinkedNotice(cookieFrom(response))).toBeUndefined();
  });

  it('leaves the account alone when Google is linked from its own settings', async () => {
    const built = setup(BOTH);
    // Only the session: the sign-up also expired its OAuth state cookie.
    const cookie = (await lichessSignUp(built))
      .split('; ')
      .filter((c) => c.includes('session_token='))
      .join('; ');
    const response = await oauthRoundTrip(built, 'google', {
      cookie,
      link: true,
    });
    expect(errorCode(response)).toBeNull();
    expect(
      await rows(
        'select provider_id from provider_accounts order by provider_id',
      ),
    ).toEqual([{ provider_id: 'google' }, { provider_id: 'lichess' }]);
    expect(await sessionOf(built, cookie)).toBe(await onlyAccountId());
  });

  it('does not let a second Lichess identity in by email either (R-69)', async () => {
    const who: FakeIdentity = { lichess: LICHESS };
    const built = setup(who);
    const first = await lichessSignUp(built);
    who.lichess = { ...LICHESS, id: 'impostor', username: 'Impostor' };
    const response = await oauthRoundTrip(built, 'lichess');
    expect(errorCode(response)).toBe(LICHESS_EMAIL_IN_USE);
    expect(await signedInAs(built, response)).toBeUndefined();
    expect(
      await rows('select provider_account_id from provider_accounts'),
    ).toEqual([{ provider_account_id: 'ruta' }]);
    expect(await rows('select email_verified from accounts')).toEqual([
      { email_verified: false },
    ]);
    expect(await sessionOf(built, first)).toBe(await onlyAccountId());
  });
});

describe('the OAuth state (security item 7)', () => {
  it.each<[string, (state: string) => string, string]>([
    ['a wrong state', (state) => `${state}x`, 'state_mismatch'],
    ['no state', () => '', 'state_not_found'],
  ])('refuses %s, creating nothing', async (_, tamper, code) => {
    const built = setup(BOTH);
    const flow = await startedFlow(built, 'google');
    const response = await oauthCallback(built, {
      ...flow,
      state: tamper(flow.state),
    });
    expect(errorCode(response)).toBe(code);
    expect(await count('accounts')).toBe(0);
  });

  it('refuses the state without the signed state cookie, creating nothing', async () => {
    const built = setup(BOTH);
    const flow = await startedFlow(built, 'lichess');
    const response = await oauthCallback(built, { ...flow, cookie: '' });
    expect(errorCode(response)).toBe('state_mismatch');
    expect(await count('accounts')).toBe(0);
  });

  it.each<Provider>(['google', 'lichess'])(
    'refuses a replayed %s callback',
    async (provider) => {
      const built = setup(BOTH);
      const flow = await startedFlow(built, provider);
      await oauthCallback(built, flow);
      const replay = await oauthCallback(built, flow);
      expect(errorCode(replay)).toBe('state_mismatch');
      expect(await count('sessions')).toBe(1);
    },
  );
});

describe('the sign-in and link requests', () => {
  it.each([
    ['scopes', ['openid', 'https://www.googleapis.com/auth/drive']],
    ['additionalParams', { prompt: 'none' }],
    ['loginHint', 'ruta@example.lt'],
    ['idToken', { token: 'e30.e30.sig' }],
  ])(
    'refuse a client-chosen %s on both sign-in and link',
    async (field, value) => {
      const built = setup(BOTH);
      const cookie = await signInByMagicLink(built, 'ruta@example.lt');
      const body = { [field]: value };
      const signIn = await startOAuth(built, 'google', { body });
      const link = await startOAuth(built, 'lichess', {
        cookie,
        link: true,
        body,
      });
      expect([signIn.status, link.status]).toEqual([400, 400]);
      expect(
        await count("verifications where identifier like 'auth-state:%'"),
      ).toBe(0);
    },
  );
});

describe('Lichess', () => {
  it('creates a new account with the Lichess email when none has it, its token encrypted (R-83)', async () => {
    const built = setup({ lichess: LICHESS });
    const response = await oauthRoundTrip(built, 'lichess');
    expect(await rows('select email, display_name from accounts')).toEqual([
      { email: 'ruta@example.lt', display_name: 'Ruta' },
    ]);
    expect(
      await rows(
        'select provider_id, provider_account_id from provider_accounts',
      ),
    ).toEqual([{ provider_id: 'lichess', provider_account_id: 'ruta' }]);
    expect(await accessTokens()).toEqual([expect.not.stringMatching(/^l-at$/)]);
    expect(await signedInAs(built, response)).toBe(await onlyAccountId());
  });

  it('never merges by email: the sign-in is refused with its own code (R-69, R-83)', async () => {
    const built = setup({ lichess: LICHESS });
    await signInByMagicLink(built, 'ruta@example.lt');
    const response = await oauthRoundTrip(built, 'lichess');
    expect(errorCode(response)).toBe(LICHESS_EMAIL_IN_USE);
    expect(await count('accounts')).toBe(1);
    expect(await count('provider_accounts')).toBe(0);
    expect(await signedInAs(built, response)).toBeUndefined();
  });

  it('refuses a sign-in (not a link) by email even while signed in to that account (R-69)', async () => {
    const built = setup({ lichess: LICHESS });
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    const response = await oauthRoundTrip(built, 'lichess', { cookie });
    expect(errorCode(response)).toBe(LICHESS_EMAIL_IN_USE);
    expect(await count('provider_accounts')).toBe(0);
  });

  it.each([['ruta@example.lt'], ['other@example.lt']])(
    'links from settings while signed in, with the Lichess email %s, its token encrypted',
    async (email) => {
      const built = setup({ lichess: { ...LICHESS, email } });
      const cookie = await signInByMagicLink(built, 'ruta@example.lt');
      const response = await oauthRoundTrip(built, 'lichess', {
        cookie,
        link: true,
      });
      expect(response.headers.get('location')).toBe('/');
      expect(
        await rows(
          'select a.email, p.provider_id from provider_accounts p join accounts a on a.id = p.account_id',
        ),
      ).toEqual([{ email: 'ruta@example.lt', provider_id: 'lichess' }]);
      expect(await accessTokens()).toEqual([
        expect.not.stringMatching(/^l-at$/),
      ]);
    },
  );

  it('signs in by Lichess to the account it was linked to from settings', async () => {
    const built = setup({ lichess: { ...LICHESS, email: 'other@example.lt' } });
    const cookie = await signInByMagicLink(built, 'ruta@example.lt');
    await oauthRoundTrip(built, 'lichess', { cookie, link: true });
    const response = await oauthRoundTrip(built, 'lichess');
    expect(errorCode(response)).toBeNull();
    expect(await signedInAs(built, response)).toBe(await onlyAccountId());
  });

  it('signs a linked Lichess id in to its account after its Lichess email changed', async () => {
    const who: FakeIdentity = { lichess: { ...LICHESS } };
    const built = setup(who);
    await oauthRoundTrip(built, 'lichess');
    who.lichess = { ...LICHESS, email: 'new@example.lt' };
    const response = await oauthRoundTrip(built, 'lichess');
    expect(errorCode(response)).toBeNull();
    expect(await rows('select email from accounts')).toEqual([
      { email: 'ruta@example.lt' },
    ]);
    expect(await count('provider_accounts')).toBe(1);
    expect(await signedInAs(built, response)).toBe(await onlyAccountId());
  });

  it('loses its link and sessions when the email owner proves the mailbox by magic link', async () => {
    const built = setup({ lichess: LICHESS });
    const lichessSession = cookieFrom(await oauthRoundTrip(built, 'lichess'));
    expect(await rows('select email_verified from accounts')).toEqual([
      { email_verified: false },
    ]);
    const owner = await signInByMagicLink(built, 'ruta@example.lt');
    expect(await count('provider_accounts')).toBe(0);
    expect(await sessionOf(built, lichessSession)).toBeUndefined();
    expect(await sessionOf(built, owner)).toBe(await onlyAccountId());
    // Settings will say why Lichess is gone (R-90).
    expect(unlinkedNotice(owner)).toBe(await onlyAccountId());
  });
});

// The language a new account starts in: the one the browser was using (R-85).
describe('a new account from a provider', () => {
  const localeRows = () => rows('select locale from accounts');

  it.each<[Provider, string, string]>([
    ['google', 'NEXT_LOCALE=en', 'en'],
    ['lichess', 'NEXT_LOCALE=en', 'en'],
    ['google', '', 'lt'],
    ['google', 'NEXT_LOCALE=de', 'lt'],
  ])(
    'from %s with the cookie %j starts in %s',
    async (provider, cookie, locale) => {
      const built = setup(BOTH);
      const response = await oauthRoundTrip(built, provider, { cookie });
      expect(errorCode(response)).toBeNull();
      expect(await localeRows()).toEqual([{ locale }]);
    },
  );

  it('leaves an existing account in its own language', async () => {
    const built = setup({ google: GOOGLE });
    await oauthRoundTrip(built, 'google');
    await oauthRoundTrip(built, 'google', { cookie: 'NEXT_LOCALE=en' });
    expect(await localeRows()).toEqual([{ locale: 'lt' }]);
  });
});
