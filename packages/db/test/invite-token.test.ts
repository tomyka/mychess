import { inviteTokenSchema } from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import {
  inviteTokenHash,
  newInviteToken,
  parsedTokenHash,
} from '../src/invite-token';

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

describe('parsedTokenHash', () => {
  it("is a well-formed token's hash", () => {
    const token = newInviteToken();
    expect(parsedTokenHash(token)).toBe(inviteTokenHash(token));
  });

  it.each(['', 'abc', 'a'.repeat(44), `${'a'.repeat(42)}=`])(
    'is nothing for the malformed token %j',
    (token) => {
      expect(parsedTokenHash(token)).toBeUndefined();
    },
  );
});
