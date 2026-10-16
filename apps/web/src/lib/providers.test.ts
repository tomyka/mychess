import { describe, expect, it } from 'vitest';
import { isProvider, offeredProviders } from './providers';

describe('isProvider', () => {
  it.each(['google', 'lichess'])('knows %j', (id) => {
    expect(isProvider(id)).toBe(true);
  });

  it.each(['credential', 'Google', ''])('does not know %j', (id) => {
    expect(isProvider(id)).toBe(false);
  });
});

describe('offeredProviders', () => {
  it('offers Google, then Lichess, when Google is configured', () => {
    expect(offeredProviders(true)).toEqual(['google', 'lichess']);
  });

  it('offers only Lichess when Google is not configured (A7)', () => {
    expect(offeredProviders(false)).toEqual(['lichess']);
  });
});
