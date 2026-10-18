import { inviteTokenSchema } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import { inviteTokenHash, newInviteToken } from '../src/invite-token';

describe('newInviteToken', () => {
  it('makes a well-formed token, a different one each time (checklist 5)', () => {
    const first = newInviteToken();
    const second = newInviteToken();
    expect(inviteTokenSchema.safeParse(first).success).toBe(true);
    expect(inviteTokenSchema.safeParse(second).success).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('inviteTokenHash', () => {
  it('is the SHA-256 of the token, in hex', () => {
    expect(inviteTokenHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
