import { describe, expect, it } from 'vitest';
import { MESSAGES } from './locales';
import { isMessageKey } from './message-key';

describe('isMessageKey', () => {
  it('accepts a dotted path to a message', () => {
    expect(isMessageKey(MESSAGES.lt, 'repertoire.stale')).toBe(true);
    expect(isMessageKey(MESSAGES.en, 'board.moveInput.unknown')).toBe(true);
  });

  it('refuses a path to a group, a missing path or a malformed one', () => {
    expect(isMessageKey(MESSAGES.lt, 'repertoire')).toBe(false);
    expect(isMessageKey(MESSAGES.lt, 'repertoire.nope')).toBe(false);
    expect(isMessageKey(MESSAGES.lt, 'repertoire.stale.more')).toBe(false);
    expect(isMessageKey(MESSAGES.lt, '')).toBe(false);
    expect(isMessageKey(undefined, 'repertoire.stale')).toBe(false);
  });
});
