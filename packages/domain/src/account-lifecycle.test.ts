import { ok, refuse } from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_REFUSALS,
  type Account,
  type Locale,
  type Profile,
} from './account';
import {
  LIFECYCLE_REFUSALS,
  accountStage,
  canDelete,
  decideDeletion,
  decideDisable,
  decideOnboarding,
  deletableAccount,
  deleteConfirmation,
  isDisabled,
  isOnboarded,
  type AccountStage,
} from './account-lifecycle';

const ONBOARDED_AT = new Date('2026-10-16T08:00:00Z');
const DISABLED_AT = new Date('2026-10-16T09:00:00Z');
const NOW = new Date('2026-10-22T09:00:00Z');
const PROFILE: Profile = { displayName: 'Rūta', locale: 'en' };

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1',
  email: 'ruta@example.lt',
  emailVerified: true,
  displayName: 'Rūta',
  locale: 'lt',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: new Date('2026-10-16T08:00:00Z'),
  coachSince: null,
  createdAt: new Date('2026-10-16T08:00:00Z'),
  ...over,
});

describe('isOnboarded', () => {
  it('is true once onboarding was completed', () => {
    expect(isOnboarded(account())).toBe(true);
  });

  it('is false before, even with a prefilled name', () => {
    expect(isOnboarded(account({ onboardedAt: null }))).toBe(false);
  });
});

describe('isDisabled', () => {
  it('is false for an active account', () => {
    expect(isDisabled(account())).toBe(false);
  });

  it('is true once an admin disabled it (R-80)', () => {
    expect(
      isDisabled(account({ disabledAt: new Date('2026-10-16T09:00:00Z') })),
    ).toBe(true);
  });
});

describe('isDisabled on what an invite knows of its coach', () => {
  it('needs only the disable time (R-108)', () => {
    const coach: Pick<Account, 'disabledAt'> = { disabledAt: DISABLED_AT };
    expect(isDisabled(coach)).toBe(true);
    expect(isDisabled({ disabledAt: null })).toBe(false);
  });
});

describe('accountStage', () => {
  // Every combination of the two stamps: disabled wins over onboarded.
  it.each<[Date | null, Date | null, AccountStage]>([
    [null, null, 'notOnboarded'],
    [ONBOARDED_AT, null, 'onboarded'],
    [null, DISABLED_AT, 'disabled'],
    [ONBOARDED_AT, DISABLED_AT, 'disabled'],
  ])(
    'onboardedAt %j and disabledAt %j is %j (R-80, R-81)',
    (onboardedAt, disabledAt, stage) => {
      expect(accountStage({ onboardedAt, disabledAt })).toBe(stage);
      expect(accountStage(account({ onboardedAt, disabledAt }))).toBe(stage);
    },
  );
});

describe('deleteConfirmation', () => {
  it('asks a not-onboarded account for its email (R-86)', () => {
    expect(deleteConfirmation({ onboardedAt: null })).toBe('email');
  });

  it('asks an onboarded account for its display name (R-82)', () => {
    expect(deleteConfirmation({ onboardedAt: ONBOARDED_AT })).toBe(
      'displayName',
    );
  });
});

describe('deletableAccount', () => {
  it('keeps only what deciding a deletion needs', () => {
    expect(deletableAccount(account())).toStrictEqual({
      displayName: 'Rūta',
      email: 'ruta@example.lt',
      onboardedAt: new Date('2026-10-16T08:00:00Z'),
    });
  });
});

describe('canDelete', () => {
  describe('an onboarded account confirms with its display name (R-82)', () => {
    it('takes the display name typed exactly, ignoring outer spaces', () => {
      expect(canDelete(account(), '  Rūta ')).toEqual({
        ok: true,
        value: undefined,
      });
    });

    it.each([['rūta'], ['Ruta'], [''], ['Rūta Rūtaitė'], ['ruta@example.lt']])(
      'refuses %j',
      (typed) => {
        expect(canDelete(account(), typed)).toEqual({
          ok: false,
          refusal: { reason: ACCOUNT_REFUSALS.deleteNameMismatch },
        });
      },
    );

    // A blank name can never be typed: a blank confirmation must not match it.
    it.each([
      ['', ''],
      ['', '   '],
      ['   ', ''],
      ['   ', '   '],
    ])('refuses a blank display name %j confirmed by %j', (name, typed) => {
      expect(canDelete(account({ displayName: name }), typed)).toEqual({
        ok: false,
        refusal: { reason: ACCOUNT_REFUSALS.deleteNameMismatch },
      });
    });
  });

  describe('an account not yet onboarded confirms with its email (R-86)', () => {
    const fresh = (over: Partial<Account> = {}) =>
      account({ onboardedAt: null, displayName: 'Ruta J', ...over });

    it.each([
      ['ruta@example.lt'],
      ['  Ruta@Example.LT '],
      ['ｒｕｔａ@ｅｘａｍｐｌｅ.ｌｔ'],
    ])('takes %j, compared in its canonical form', (typed) => {
      expect(canDelete(fresh(), typed)).toEqual({ ok: true, value: undefined });
    });

    it.each([
      ['the prefilled display name', 'Ruta J'],
      ['another address', 'jonas@example.lt'],
      ['a Cyrillic look-alike', 'ruta@exаmple.lt'],
      ['nothing', ''],
      ['spaces', '   '],
    ])('refuses %s', (_, typed) => {
      expect(canDelete(fresh(), typed)).toEqual({
        ok: false,
        refusal: { reason: ACCOUNT_REFUSALS.deleteEmailMismatch },
      });
    });

    it('refuses a blank confirmation for a blank display name', () => {
      expect(canDelete(fresh({ displayName: '' }), '')).toEqual({
        ok: false,
        refusal: { reason: ACCOUNT_REFUSALS.deleteEmailMismatch },
      });
    });
  });
});

describe('LIFECYCLE_REFUSALS', () => {
  it('keys the two lifecycle refusals', () => {
    expect(LIFECYCLE_REFUSALS).toEqual({
      alreadyOnboarded: 'lifecycle.alreadyOnboarded',
      accountClosed: 'lifecycle.accountClosed',
    });
  });
});

describe('decideOnboarding', () => {
  it('onboards a new, enabled account with the profile at now (R-81)', () => {
    expect(
      decideOnboarding(account({ onboardedAt: null }), PROFILE, NOW),
    ).toEqual(ok({ profile: PROFILE, onboardedAt: NOW }));
  });

  it('refuses an account that has been through onboarding', () => {
    expect(decideOnboarding(account(), PROFILE, NOW)).toEqual(
      refuse('lifecycle.alreadyOnboarded'),
    );
  });

  // No way in wins: a disabled account is closed whether onboarded or not.
  it.each([
    [
      'disabled, not onboarded',
      account({ onboardedAt: null, disabledAt: DISABLED_AT }),
    ],
    ['disabled and onboarded', account({ disabledAt: DISABLED_AT })],
    ['gone', undefined],
  ])('refuses an account %s as closed (R-80)', (_, subject) => {
    expect(decideOnboarding(subject, PROFILE, NOW)).toEqual(
      refuse('lifecycle.accountClosed'),
    );
  });
});

describe('decideDisable', () => {
  it('disables an active account at now', () => {
    expect(decideDisable(account(), NOW)).toEqual(ok({ disabledAt: NOW }));
  });

  it('refuses an account that is already disabled (R-80)', () => {
    expect(decideDisable(account({ disabledAt: DISABLED_AT }), NOW)).toEqual({
      ok: false,
      refusal: { reason: 'admin.alreadyDisabled' },
    });
  });
});

describe('decideDeletion', () => {
  const MAIL = { to: 'ruta@example.lt', locale: 'en' } as const;
  const english = (over: Partial<Account> = {}): Account =>
    account({ locale: 'en', ...over });

  it('confirms by the display name and mails the proven address (R-82, R-87)', () => {
    expect(decideDeletion(english(), '  Rūta ')).toEqual(
      ok({ confirmationMail: MAIL }),
    );
  });

  it('mails nobody when the address was never proven (R-87)', () => {
    expect(
      decideDeletion(english({ emailVerified: false }), '  Rūta '),
    ).toEqual(ok({ confirmationMail: null }));
  });

  it('confirms a not-onboarded account by its email in any case (R-86)', () => {
    expect(
      decideDeletion(english({ onboardedAt: null }), ' Ruta@Example.LT '),
    ).toEqual(ok({ confirmationMail: MAIL }));
  });

  it('refuses an onboarded account confirmed by its email', () => {
    expect(decideDeletion(english(), 'ruta@example.lt')).toEqual(
      refuse('account.deleteNameMismatch'),
    );
  });

  it('refuses a not-onboarded account confirmed by its name', () => {
    expect(decideDeletion(english({ onboardedAt: null }), 'Rūta')).toEqual(
      refuse('account.deleteEmailMismatch'),
    );
  });

  it.each([['Rūta'], [''], ['anything']])(
    'finds an account already gone deleted, with no mail, whatever is typed (%j)',
    (typed) => {
      expect(decideDeletion(undefined, typed)).toEqual(
        ok({ confirmationMail: null }),
      );
    },
  );
});

// Every combination of what the lifecycle reads, in place of a property test.
const STAMPS = [null, ONBOARDED_AT] as const;
const DISABLES = [null, DISABLED_AT] as const;
const PROOFS = [true, false] as const;
const NAMES = ['Rūta', '', '   '] as const;
const LOCALES_SEEN: readonly Locale[] = ['lt', 'en'];
const EVERY_ACCOUNT: readonly Account[] = STAMPS.flatMap((onboardedAt) =>
  DISABLES.flatMap((disabledAt) =>
    PROOFS.flatMap((emailVerified) =>
      NAMES.flatMap((displayName) =>
        LOCALES_SEEN.map((locale) =>
          account({
            onboardedAt,
            disabledAt,
            emailVerified,
            displayName,
            locale,
          }),
        ),
      ),
    ),
  ),
);
const EVERY_TYPED = [
  'Rūta',
  '  Rūta ',
  'rūta',
  '',
  '   ',
  'ruta@example.lt',
  ' Ruta@Example.LT ',
  'jonas@example.lt',
] as const;
const EVERY_CASE = EVERY_ACCOUNT.flatMap((subject) =>
  EVERY_TYPED.map((typed) => [subject, typed] as const),
);

describe('the lifecycle over every account', () => {
  it('covers every combination', () => {
    expect(EVERY_ACCOUNT).toHaveLength(48);
    expect(EVERY_CASE).toHaveLength(384);
  });

  it.each(EVERY_ACCOUNT)(
    'onboards only a notOnboarded stage (%#)',
    (subject) => {
      expect(decideOnboarding(subject, PROFILE, NOW).ok).toBe(
        accountStage(subject) === 'notOnboarded',
      );
    },
  );

  it.each(EVERY_ACCOUNT)('never confirms a blank text (%#)', (subject) => {
    expect(canDelete(subject, '   ').ok).toBe(false);
    expect(decideDeletion(subject, '   ').ok).toBe(false);
  });

  it.each(EVERY_CASE)(
    'deletes as canDelete decides, mailing only a proven address (%#)',
    (subject, typed) => {
      const confirmed = canDelete(subject, typed);
      const mail = subject.emailVerified
        ? { to: subject.email, locale: subject.locale }
        : null;
      expect(decideDeletion(subject, typed)).toEqual(
        confirmed.ok ? ok({ confirmationMail: mail }) : confirmed,
      );
    },
  );
});
