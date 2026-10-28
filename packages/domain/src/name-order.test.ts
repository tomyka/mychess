import { describe, expect, it } from 'vitest';
import { byName, byNameAndId, type NameAndId } from './name-order';

const sorted = (list: readonly NameAndId[]): string[] =>
  list.toSorted(byNameAndId).map((one) => one.id);

describe('byNameAndId', () => {
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

describe('byName', () => {
  it('orders by the name and id the key gives', () => {
    const rows = [
      { label: 'Zuikis', key: '1' },
      { label: 'Yra', key: '2' },
    ];
    expect(
      rows
        .toSorted(byName((one) => ({ name: one.label, id: one.key })))
        .map((one) => one.key),
    ).toEqual(['2', '1']);
  });
});
