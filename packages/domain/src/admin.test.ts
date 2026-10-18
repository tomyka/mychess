import { describe, expect, it } from 'vitest';
import type { Account } from './account';
import { ADMIN_ACTIONS, ADMIN_REFUSALS, canDisable } from './admin';

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a1',
  email: 'ruta@example.lt',
  emailVerified: true,
  displayName: 'Rūta',
  locale: 'lt',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: null,
  coachSince: null,
  createdAt: new Date('2026-10-16T08:00:00Z'),
  ...over,
});

describe('admin vocabulary', () => {
  it('names the two audited Admin actions (R-72, R-80)', () => {
    expect(ADMIN_ACTIONS).toEqual(['grant-admin', 'disable-account']);
  });

  it('keys admin refusals by message-catalogue key', () => {
    expect(ADMIN_REFUSALS).toEqual({
      accountNotFound: 'admin.accountNotFound',
      alreadyDisabled: 'admin.alreadyDisabled',
    });
  });
});

describe('canDisable', () => {
  it('allows an active account', () => {
    expect(canDisable(account())).toEqual({ ok: true, value: undefined });
  });

  it('refuses an account that is already disabled', () => {
    expect(
      canDisable(account({ disabledAt: new Date('2026-10-16T09:00:00Z') })),
    ).toEqual({ ok: false, refusal: { reason: 'admin.alreadyDisabled' } });
  });
});
