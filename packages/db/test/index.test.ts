import { describe, expect, it } from 'vitest';
import { authSchema } from '../src';
import {
  accounts,
  providerAccounts,
  rateLimits,
  sessions,
  verifications,
} from '../src/schema';

describe('authSchema', () => {
  it('hands Better Auth exactly its five tables under their model names', () => {
    expect(Object.keys(authSchema).sort()).toEqual([
      'accounts',
      'providerAccounts',
      'rateLimits',
      'sessions',
      'verifications',
    ]);
    expect(authSchema.accounts).toBe(accounts);
    expect(authSchema.sessions).toBe(sessions);
    expect(authSchema.providerAccounts).toBe(providerAccounts);
    expect(authSchema.verifications).toBe(verifications);
    expect(authSchema.rateLimits).toBe(rateLimits);
  });
});
