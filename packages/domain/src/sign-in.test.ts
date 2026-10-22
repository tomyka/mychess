import { describe, expect, it } from 'vitest';
import type { Account } from './account';
import {
  FRESH_AGE_SECONDS,
  GOOGLE,
  LICHESS,
  PROVIDERS,
  SIGN_IN_REFUSALS,
  canLinkProvider,
  canOpenSession,
  canStartOAuth,
  isFreshSession,
  isProvider,
  decideProviderJoin,
  leavesLichessNotice,
  magicLinkRequest,
  providerSessionStands,
  showsLichessNotice,
  signInEmail,
  type LinkEnd,
  type ProviderJoin,
} from './sign-in';

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1',
  email: 'ruta@example.lt',
  emailVerified: false,
  displayName: 'Ruta',
  locale: 'lt',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: null,
  coachSince: null,
  createdAt: new Date('2026-10-16T08:00:00Z'),
  ...over,
});

const DISABLED_AT = new Date('2026-10-16T09:00:00Z');

describe('sign-in refusals', () => {
  it('keys every sign-in refusal by its reason (the web maps each one)', () => {
    expect(SIGN_IN_REFUSALS).toEqual({
      lichessEmailInUse: 'signIn.lichessEmailInUse',
      joinRefused: 'signIn.joinRefused',
      sessionNotFresh: 'signIn.sessionNotFresh',
      clientOAuthField: 'signIn.clientOAuthField',
      accountDisabled: 'signIn.accountDisabled',
    });
  });
});

describe('providers (R-68)', () => {
  it('lists Google, then Lichess', () => {
    expect(PROVIDERS).toEqual(['google', 'lichess']);
  });

  it('names each provider by the id Better Auth carries', () => {
    expect([GOOGLE, LICHESS]).toEqual(['google', 'lichess']);
  });

  it.each(['google', 'lichess'])('knows %j', (id) => {
    expect(isProvider(id)).toBe(true);
  });

  it.each(['credential', 'Google', ''])('does not know %j', (id) => {
    expect(isProvider(id)).toBe(false);
  });
});

const CANONICAL = 'ruta@example.lt';
const SAME_EMAIL = [
  ' Ruta@Example.lt ',
  'RUTA@EXAMPLE.LT',
  'ｒｕｔａ@ｅｘａｍｐｌｅ.ｌｔ',
];
// A Cyrillic "а" look-alike, an empty string and values that are no string.
const NOT_AN_EMAIL: unknown[] = ['rutа@example.lt', '', undefined, null, 1];
const EMAIL_INVALID = {
  ok: false,
  refusal: { reason: 'account.emailInvalid' },
};

describe('signInEmail (security item 6)', () => {
  it.each(SAME_EMAIL)('keys %j by its canonical form', (raw) => {
    expect(signInEmail(raw)).toEqual({ ok: true, value: CANONICAL });
  });

  it.each(NOT_AN_EMAIL)('refuses %j', (raw) => {
    expect(signInEmail(raw)).toEqual(EMAIL_INVALID);
  });
});

describe('magicLinkRequest (security item 6, R-81)', () => {
  it.each(SAME_EMAIL)(
    'asks for %j by its canonical form, with a blank name',
    (raw) => {
      expect(magicLinkRequest(raw)).toEqual({
        ok: true,
        value: { email: CANONICAL, name: '' },
      });
    },
  );

  it.each(NOT_AN_EMAIL)('refuses %j', (raw) => {
    expect(magicLinkRequest(raw)).toEqual(EMAIL_INVALID);
  });
});

describe('canStartOAuth (security item 7)', () => {
  it.each([
    [[]],
    [['provider', 'callbackURL', 'disableRedirect', 'errorCallbackURL']],
    [['Scopes']],
  ])('starts with the fields %j', (fields) => {
    expect(canStartOAuth(fields)).toEqual({ ok: true, value: undefined });
  });

  it.each(['scopes', 'additionalParams', 'loginHint', 'idToken'])(
    'refuses a client-chosen %s, naming it',
    (field) => {
      expect(canStartOAuth(['provider', field])).toEqual({
        ok: false,
        refusal: { reason: 'signIn.clientOAuthField', field },
      });
    },
  );

  it('names the first refused field in list order, not request order', () => {
    expect(canStartOAuth(['idToken', 'scopes'])).toEqual({
      ok: false,
      refusal: { reason: 'signIn.clientOAuthField', field: 'scopes' },
    });
  });
});

const NOW = new Date('2026-10-17T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const before = (ms: number): Date => new Date(NOW.getTime() - ms);

describe('isFreshSession (R-84, R-95)', () => {
  it('is a day: Better Auth’s freshAge', () => {
    expect(FRESH_AGE_SECONDS).toBe(86_400);
  });

  it.each([
    ['just signed in', 0, true],
    ['signed in 23 hours ago', 23 * HOUR, true],
    ['signed in a millisecond under a day ago', 24 * HOUR - 1, true],
    ['signed in exactly a day ago', 24 * HOUR, false],
    ['signed in 25 hours ago', 25 * HOUR, false],
    ['created an hour after now (clock skew)', -HOUR, true],
  ])('%s: %s', (_, ago, fresh) => {
    expect(isFreshSession(before(ago), NOW)).toBe(fresh);
  });
});

describe('canLinkProvider (R-84)', () => {
  it('links from a session started 23 hours ago', () => {
    expect(canLinkProvider(before(23 * HOUR), NOW)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('refuses a session started a day ago', () => {
    expect(canLinkProvider(before(24 * HOUR), NOW)).toEqual({
      ok: false,
      refusal: { reason: 'signIn.sessionNotFresh' },
    });
  });
});

describe('canOpenSession (R-80, security item 8)', () => {
  it('opens a session for an enabled account', () => {
    expect(canOpenSession(account())).toEqual({ ok: true, value: undefined });
  });

  it('refuses a disabled account', () => {
    expect(canOpenSession(account({ disabledAt: DISABLED_AT }))).toEqual({
      ok: false,
      refusal: { reason: 'signIn.accountDisabled' },
    });
  });
});

type EmailJoin = Extract<ProviderJoin, { via: 'email' }>;
type SettingsJoin = Extract<ProviderJoin, { via: 'settings' }>;

// A verified Google email joining an enabled account at sign-in.
const email = (over: Partial<EmailJoin> = {}): EmailJoin => ({
  via: 'email',
  provider: 'google',
  emailVerified: true,
  account: account(),
  ...over,
});

// A Lichess link from settings by the signed-in owner of the account.
const settings = (over: Partial<SettingsJoin> = {}): SettingsJoin => ({
  via: 'settings',
  provider: 'lichess',
  linkAccountId: 'a1',
  targetAccountId: 'a1',
  sessionAccountId: 'a1',
  ...over,
});

const LICHESS_EMAIL_IN_USE = {
  ok: false,
  refusal: { reason: 'signIn.lichessEmailInUse' },
};
const JOIN_REFUSED = { ok: false, refusal: { reason: 'signIn.joinRefused' } };
const LINK = { ok: true, value: { kind: 'link' } };
const proveEmail = (accountId: string) => ({
  ok: true,
  value: { kind: 'proveEmail', accountId },
});

describe('decideProviderJoin by email at sign-in (R-69, R-83, R-87, A1)', () => {
  it('lets a verified Google email prove the mailbox of that account (R-87)', () => {
    expect(decideProviderJoin(email())).toEqual(proveEmail('a1'));
  });

  it('refuses Lichess with its own reason (R-69, R-83)', () => {
    expect(decideProviderJoin(email({ provider: 'lichess' }))).toEqual(
      LICHESS_EMAIL_IN_USE,
    );
  });

  it('refuses Lichess with its own reason onto a disabled account too', () => {
    const disabled = account({ disabledAt: DISABLED_AT });
    expect(
      decideProviderJoin(email({ provider: 'lichess', account: disabled })),
    ).toEqual(LICHESS_EMAIL_IN_USE);
  });

  it.each<[string, Partial<EmailJoin>]>([
    ['any other provider', { provider: 'github' }],
    ['a source with no provider', { provider: undefined }],
    ['a Google email that is not verified', { emailVerified: false }],
    ['a Google email with no verification flag', { emailVerified: undefined }],
    ['a verification flag that is a string', { emailVerified: 'true' }],
    ['an account that cannot be found', { account: undefined }],
    [
      'a disabled account (R-80)',
      { account: account({ disabledAt: DISABLED_AT }) },
    ],
  ])('refuses %s', (_, over) => {
    expect(decideProviderJoin(email(over))).toEqual(JOIN_REFUSED);
  });
});

describe('decideProviderJoin from settings (R-69, R-83)', () => {
  it('links Lichess while signed in to the very account it joins', () => {
    expect(decideProviderJoin(settings())).toEqual(LINK);
  });

  it.each<[string, Partial<SettingsJoin>]>([
    ['a link that names another account', { linkAccountId: 'a2' }],
    ['a session of another account', { sessionAccountId: 'a2' }],
    ['no session', { sessionAccountId: undefined }],
    ['an identity with no target account', { targetAccountId: undefined }],
  ])('refuses Lichess with %s', (_, over) => {
    expect(decideProviderJoin(settings(over))).toEqual(LICHESS_EMAIL_IN_USE);
  });

  // Better Auth itself joins any other provider to the session's account.
  it.each(['google', undefined])(
    'links provider %j whatever the ids (spec decision 9)',
    (provider) => {
      const join = settings({
        provider,
        linkAccountId: 'a2',
        targetAccountId: undefined,
        sessionAccountId: 'a3',
      });
      expect(decideProviderJoin(join)).toEqual(LINK);
    },
  );
});

// Every combination of the inputs that decide a join, so the properties
// below hold over the whole input space, not a sample of it.
const PROVIDER_IDS = ['google', 'lichess', 'github', undefined];
const VERIFICATIONS: unknown[] = [true, false, 'true', undefined];
const JOINED_ACCOUNTS = [
  account({ id: 'a7' }),
  account({ id: 'a8', disabledAt: DISABLED_AT }),
  undefined,
];
const IDS = ['a1', 'a2', undefined];

const emailJoins: EmailJoin[] = PROVIDER_IDS.flatMap((provider) =>
  VERIFICATIONS.flatMap((emailVerified) =>
    JOINED_ACCOUNTS.map((joined) =>
      email({ provider, emailVerified, account: joined }),
    ),
  ),
);

const settingsJoins: SettingsJoin[] = PROVIDER_IDS.flatMap((provider) =>
  ['a1', 'a2'].flatMap((linkAccountId) =>
    IDS.flatMap((targetAccountId) =>
      IDS.map((sessionAccountId) =>
        settings({
          provider,
          linkAccountId,
          targetAccountId,
          sessionAccountId,
        }),
      ),
    ),
  ),
);

const provesEmail = (join: EmailJoin): boolean =>
  join.provider === 'google' &&
  join.emailVerified === true &&
  join.account?.disabledAt === null;

const sameAccountThrice = (join: SettingsJoin): boolean =>
  join.targetAccountId !== undefined &&
  join.linkAccountId === join.targetAccountId &&
  join.sessionAccountId === join.targetAccountId;

describe('decideProviderJoin: deny by default (A1), over every input', () => {
  it('covers the whole input space', () => {
    expect([emailJoins.length, settingsJoins.length]).toEqual([48, 72]);
  });

  it.each(emailJoins.filter(provesEmail))(
    'proves the email of the joined account: %j',
    (join) => {
      expect(decideProviderJoin(join)).toEqual(
        proveEmail(join.account?.id ?? ''),
      );
    },
  );

  it.each(emailJoins.filter((join) => !provesEmail(join)))(
    'refuses any other join by email, never linking: %j',
    (join) => {
      expect(decideProviderJoin(join)).toEqual(
        join.provider === 'lichess' ? LICHESS_EMAIL_IN_USE : JOIN_REFUSED,
      );
    },
  );

  it.each(settingsJoins.filter((join) => join.provider === 'lichess'))(
    'links Lichess only when link, target and session are one account: %j',
    (join) => {
      expect(decideProviderJoin(join)).toEqual(
        sameAccountThrice(join) ? LINK : LICHESS_EMAIL_IN_USE,
      );
    },
  );

  it.each(settingsJoins.filter((join) => join.provider !== 'lichess'))(
    'links any other provider from settings: %j',
    (join) => {
      expect(decideProviderJoin(join)).toEqual(LINK);
    },
  );
});

describe('providerSessionStands (#272)', () => {
  it.each<[string, string[], boolean]>([
    ['google', ['google', 'lichess'], true],
    ['lichess', ['lichess'], true],
    ['lichess', ['google'], false],
    ['google', [], false],
  ])('a %s session with links %j stands: %s', (provider, links, stands) => {
    expect(providerSessionStands(provider, links)).toBe(stands);
  });
});

describe('leavesLichessNotice (R-90)', () => {
  it.each<[string, LinkEnd, boolean]>([
    ['lichess', 'proof', true],
    ['lichess', 'unlink', false],
    ['google', 'proof', false],
    ['google', 'unlink', false],
  ])('a %s link ended by %s leaves the notice: %s', (provider, end, leaves) => {
    expect(leavesLichessNotice(provider, end)).toBe(leaves);
  });
});

describe('showsLichessNotice (R-90)', () => {
  interface Notice {
    noticeFor: string | undefined;
    accountId: string;
    linkedProviders: string[];
  }
  const notice = (over: Partial<Notice> = {}): Notice => ({
    noticeFor: 'a1',
    accountId: 'a1',
    linkedProviders: [],
    ...over,
  });

  it.each<[string, Partial<Notice>, boolean]>([
    ['this account with no Lichess link', {}, true],
    [
      'this account beside a Google link',
      { linkedProviders: ['google'] },
      true,
    ],
    ['a notice for another account', { noticeFor: 'a2' }, false],
    ['no notice', { noticeFor: undefined }, false],
    ['Lichess linked again', { linkedProviders: ['lichess'] }, false],
  ])('with %s shows: %s', (_, over, shows) => {
    expect(showsLichessNotice(notice(over))).toBe(shows);
  });
});
