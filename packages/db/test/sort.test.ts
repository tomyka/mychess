import { describe, expect, it } from 'vitest';
import { byName } from '../src/sort';

interface Named {
  readonly id: string;
  readonly name: string;
}

const sorted = (list: readonly Named[]): string[] =>
  list.toSorted(byName((one: Named) => one)).map((one) => one.id);

describe('byName', () => {
  it('orders by name in Lithuanian order: y with i, before j', () => {
    expect(
      sorted([
        { id: '1', name: 'Jonas' },
        { id: '2', name: 'Yra' },
        { id: '3', name: 'Ieva' },
        { id: '4', name: 'Žalias' },
        { id: '5', name: 'Zuikis' },
      ]),
    ).toEqual(['3', '2', '1', '5', '4']);
  });

  it('orders equal names by id', () => {
    expect(
      sorted([
        { id: 'c', name: 'Ona' },
        { id: 'a', name: 'Ona' },
        { id: 'b', name: 'Ona' },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });
});
