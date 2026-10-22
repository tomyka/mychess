import { describe, expect, it } from 'vitest';
import { offeredProviders } from './providers';

describe('offeredProviders', () => {
  it('offers Google, then Lichess, when Google is configured', () => {
    expect(offeredProviders(true)).toEqual(['google', 'lichess']);
  });

  it('offers only Lichess when Google is not configured (A7)', () => {
    expect(offeredProviders(false)).toEqual(['lichess']);
  });
});
