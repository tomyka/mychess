import { describe, it, expect } from 'vitest';
import { mergeRepertoireIds, buildBookMoveMap, isBookMove, findBookMove } from './repertoire';

describe('mergeRepertoireIds', () => {
  it('unions own and assigned ids', () => {
    expect(mergeRepertoireIds(['a', 'b'], ['c'])).toEqual(['a', 'b', 'c']);
  });
  it('deduplicates ids present in both lists', () => {
    expect(mergeRepertoireIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('handles empty inputs', () => {
    expect(mergeRepertoireIds([], [])).toEqual([]);
    expect(mergeRepertoireIds(['a'], [])).toEqual(['a']);
    expect(mergeRepertoireIds([], ['a'])).toEqual(['a']);
  });
});

describe('buildBookMoveMap', () => {
  it('groups moves by from_position', () => {
    const map = buildBookMoveMap([
      { id: 'm1', from_position: 'p1', san: 'Nf3' },
      { id: 'm2', from_position: 'p1', san: 'Bc4' },
      { id: 'm3', from_position: 'p2', san: 'e5' }
    ]);
    expect(map.p1).toEqual([
      { id: 'm1', san: 'Nf3' },
      { id: 'm2', san: 'Bc4' }
    ]);
    expect(map.p2).toEqual([{ id: 'm3', san: 'e5' }]);
  });

  it('returns an empty map for no rows', () => {
    expect(buildBookMoveMap([])).toEqual({});
  });
});

describe('isBookMove', () => {
  const entries = [
    { id: 'm1', san: 'Nf3' },
    { id: 'm2', san: 'Bc4' }
  ];

  it('matches any book alternative, not just the first', () => {
    expect(isBookMove(entries, 'Bc4')).toBe(true);
  });

  it('returns false for a move not in the book set', () => {
    expect(isBookMove(entries, 'Nc3')).toBe(false);
  });

  it('returns false against an empty entry list', () => {
    expect(isBookMove([], 'Nf3')).toBe(false);
  });
});

describe('findBookMove', () => {
  const entries = [
    { id: 'm1', san: 'Nf3' },
    { id: 'm2', san: 'Bc4' }
  ];

  it('returns the matching entry, including its own move id', () => {
    expect(findBookMove(entries, 'Bc4')).toEqual({ id: 'm2', san: 'Bc4' });
  });

  it('returns undefined when nothing matches', () => {
    expect(findBookMove(entries, 'Nc3')).toBeUndefined();
  });
});
