import { describe, expect, it } from 'vitest';
import { MESSAGES } from './catalogue';
import { isMessageKey } from './message-key';

describe('isMessageKey', () => {
  it('accepts a dotted path to a message', () => {
    expect(isMessageKey(MESSAGES, 'repertoire.stale')).toBe(true);
    expect(isMessageKey(MESSAGES, 'board.moveInput.unknown')).toBe(true);
  });

  it('refuses a path to a group, a missing path or a malformed one', () => {
    expect(isMessageKey(MESSAGES, 'repertoire')).toBe(false);
    expect(isMessageKey(MESSAGES, 'repertoire.nope')).toBe(false);
    expect(isMessageKey(MESSAGES, 'repertoire.stale.more')).toBe(false);
    expect(isMessageKey(MESSAGES, '')).toBe(false);
    expect(isMessageKey(undefined, 'repertoire.stale')).toBe(false);
  });
});
