import type { Account } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import { JOIN_REFUSED, LICHESS_EMAIL_IN_USE } from '../lib/sign-in-errors';
import { implicitJoin, type ImplicitJoin } from './implicit-join';

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

// A Google sign-in with a verified email, joining an enabled account.
const google = (over: Partial<ImplicitJoin> = {}): ImplicitJoin => ({
  providerId: 'google',
  emailVerified: true,
  account: account(),
  ...over,
});

describe('implicitJoin: a provider joining an account by email at sign-in', () => {
  it('lets a verified Google email prove the mailbox of that account (R-87)', () => {
    expect(implicitJoin(google())).toEqual({
      kind: 'proveEmail',
      accountId: 'a1',
    });
  });

  it('refuses Lichess with its own code (R-69, R-83)', () => {
    expect(implicitJoin(google({ providerId: 'lichess' }))).toEqual({
      kind: 'refuse',
      code: LICHESS_EMAIL_IN_USE,
    });
  });

  it.each<[string, Partial<ImplicitJoin>]>([
    ['any other provider', { providerId: 'github' }],
    ['a source with no provider', { providerId: undefined }],
    ['a Google email that is not verified', { emailVerified: false }],
    ['a Google email with no verification flag', { emailVerified: undefined }],
    ['an account that cannot be found', { account: undefined }],
    [
      'a disabled account (R-80)',
      { account: account({ disabledAt: new Date('2026-10-16T09:00:00Z') }) },
    ],
  ])('refuses %s', (_, over) => {
    expect(implicitJoin(google(over))).toEqual({
      kind: 'refuse',
      code: JOIN_REFUSED,
    });
  });
});
