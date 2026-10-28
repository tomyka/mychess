import { describe, expect, it } from 'vitest';
import { byDisplayName } from '../src/sort';

describe('byDisplayName', () => {
  it('orders accounts by display name in Lithuanian order, then id', () => {
    expect(
      [
        { id: 'b', displayName: 'Ona' },
        { id: '1', displayName: 'Žalias' },
        { id: '2', displayName: 'Zuikis' },
        { id: 'a', displayName: 'Ona' },
      ]
        .toSorted(byDisplayName)
        .map((one) => one.id),
    ).toEqual(['a', 'b', '2', '1']);
  });
});
