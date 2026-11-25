import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_REFUSALS,
  DEFAULT_ENTITLEMENT,
  ENTITLEMENTS,
  accountSchema,
  profileSchema,
  canonicalEmail,
  entitlementLimits,
  hasProvenEmail,
  type Account,
} from './account';

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1',
  email: 'ruta@example.lt',
  emailVerified: true,
  displayName: 'Rūta',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: new Date('2026-10-16T08:00:00Z'),
  coachSince: null,
  createdAt: new Date('2026-10-16T08:00:00Z'),
  ...over,
});

describe('canonicalEmail', () => {
  it.each([
    ['  Ruta@Example.LT ', 'ruta@example.lt'],
    ['RUTA@EXAMPLE.LT', 'ruta@example.lt'],
    // Fullwidth letters fold to ASCII under NFKC (security item 6).
    ['ｒｕｔａ@ｅｘａｍｐｌｅ.ｌｔ', 'ruta@example.lt'],
  ])('folds %j to %j', (raw, canonical) => {
    expect(canonicalEmail(raw)).toEqual({ ok: true, value: canonical });
  });

  it.each([
    ['blank', '   '],
    ['no at sign', 'ruta.example.lt'],
    ['two addresses', 'a@example.lt, b@example.lt'],
    // A Cyrillic "а" stays distinct under NFKC; it is refused, never a look-alike account.
    ['a Cyrillic look-alike', 'ruta@exаmple.lt'],
  ])('refuses %s', (_, raw) => {
    expect(canonicalEmail(raw)).toEqual({
      ok: false,
      refusal: { reason: ACCOUNT_REFUSALS.emailInvalid },
    });
  });
});

describe('hasProvenEmail', () => {
  it('is true once a magic link or Google proved the mailbox', () => {
    expect(hasProvenEmail(account())).toBe(true);
  });

  it('is false for an account a Lichess sign-up created (R-87)', () => {
    expect(hasProvenEmail(account({ emailVerified: false }))).toBe(false);
  });
});

describe('entitlementLimits', () => {
  it('gives the free entitlement 30 players, 10 groups, 50 repertoires of 5,000 moves (R-70, R-162)', () => {
    expect(entitlementLimits('free')).toEqual({
      coachPlayers: 30,
      coachGroups: 10,
      repertoires: 50,
      repertoireMoves: 5000,
    });
  });
});

describe('account constants', () => {
  it('has only the free entitlement in the MVP (R-70)', () => {
    expect(ENTITLEMENTS).toEqual(['free']);
  });

  it('keys refusals by message-catalogue key', () => {
    expect(ACCOUNT_REFUSALS).toEqual({
      emailInvalid: 'account.emailInvalid',
      deleteNameMismatch: 'account.deleteNameMismatch',
      deleteEmailMismatch: 'account.deleteEmailMismatch',
    });
  });

  it('starts a new account on the free entitlement (R-70)', () => {
    expect(DEFAULT_ENTITLEMENT).toBe('free');
  });
});

describe('profileSchema', () => {
  it('trims the display name', () => {
    expect(profileSchema.parse({ displayName: '  Rūta ' })).toEqual({
      displayName: 'Rūta',
    });
  });

  it.each([
    ['a blank name', { displayName: '   ' }, 'displayName.blank'],
    [
      'a name over 50 characters',
      { displayName: 'x'.repeat(51) },
      'displayName.tooLong',
    ],
  ])('refuses %s with its catalogue key', (_, input, key) => {
    const result = profileSchema.safeParse(input);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([key]);
  });
});

describe('accountSchema', () => {
  it('parses a complete account', () => {
    expect(accountSchema.parse(account())).toEqual(account());
  });

  it('keeps when Coach mode was switched on (R-11)', () => {
    const coachSince = new Date('2026-10-17T08:00:00Z');
    expect(accountSchema.parse(account({ coachSince }))).toMatchObject({
      coachSince,
    });
  });

  it.each([
    ['an empty id', { id: '' }],
    ['an empty email', { email: '' }],
    ['an unknown entitlement', { entitlement: 'pro' }],
    ['a missing email proof', { emailVerified: null }],
    ['a missing creation time', { createdAt: null }],
    ['a missing Coach mode state', { coachSince: undefined }],
  ])('refuses %s', (_, over) => {
    expect(accountSchema.safeParse({ ...account(), ...over }).success).toBe(
      false,
    );
  });
});
