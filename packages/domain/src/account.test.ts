import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_REFUSALS,
  ENTITLEMENTS,
  LOCALES,
  accountSchema,
  canDelete,
  canonicalEmail,
  entitlementLimits,
  isOnboarded,
  type Account,
} from './account';

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1',
  email: 'ruta@example.lt',
  displayName: 'Rūta',
  locale: 'lt',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: new Date('2026-10-16T08:00:00Z'),
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

describe('isOnboarded', () => {
  it('is true once onboarding was completed', () => {
    expect(isOnboarded(account())).toBe(true);
  });

  it('is false before, even with a prefilled name', () => {
    expect(isOnboarded(account({ onboardedAt: null }))).toBe(false);
  });
});

describe('canDelete', () => {
  it('takes the display name typed exactly, ignoring outer spaces', () => {
    expect(canDelete(account(), '  Rūta ')).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it.each([['rūta'], ['Ruta'], [''], ['Rūta Rūtaitė']])(
    'refuses %j',
    (typed) => {
      expect(canDelete(account(), typed)).toEqual({
        ok: false,
        refusal: { reason: ACCOUNT_REFUSALS.deleteNameMismatch },
      });
    },
  );
});

describe('entitlementLimits', () => {
  it('gives the free entitlement 30 players and 10 groups (R-70)', () => {
    expect(entitlementLimits('free')).toEqual({
      coachPlayers: 30,
      coachGroups: 10,
    });
  });
});

describe('account constants', () => {
  it('offers Lithuanian first, then English (R-1)', () => {
    expect(LOCALES).toEqual(['lt', 'en']);
  });

  it('has only the free entitlement in the MVP (R-70)', () => {
    expect(ENTITLEMENTS).toEqual(['free']);
  });

  it('keys refusals by message-catalogue key', () => {
    expect(ACCOUNT_REFUSALS).toEqual({
      emailInvalid: 'account.emailInvalid',
      deleteNameMismatch: 'account.deleteNameMismatch',
    });
  });
});

describe('accountSchema', () => {
  it('parses a complete account', () => {
    expect(accountSchema.parse(account())).toEqual(account());
  });

  it.each([
    ['an empty id', { id: '' }],
    ['an empty email', { email: '' }],
    ['an unknown locale', { locale: 'de' }],
    ['an unknown entitlement', { entitlement: 'pro' }],
    ['a missing creation time', { createdAt: null }],
  ])('refuses %s', (_, over) => {
    expect(accountSchema.safeParse({ ...account(), ...over }).success).toBe(
      false,
    );
  });
});
