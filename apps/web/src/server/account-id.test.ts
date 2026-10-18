import { describe, expect, it } from 'vitest';
import { accountIdSchema } from './account-id';

describe('accountIdSchema', () => {
  it('takes an account id of 1 to 100 characters', () => {
    expect(accountIdSchema.parse('a')).toBe('a');
    expect(accountIdSchema.parse('x'.repeat(100))).toBe('x'.repeat(100));
  });

  it('refuses an empty id, one over 100 characters and anything not text', () => {
    for (const bad of ['', 'x'.repeat(101), null, undefined, 7])
      expect(accountIdSchema.safeParse(bad).success).toBe(false);
  });
});
