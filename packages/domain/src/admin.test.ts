import { describe, expect, it } from 'vitest';
import { ADMIN_ACTIONS, ADMIN_REFUSALS } from './admin';

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
