import { describe, it, expect } from 'vitest';
import { mergeRepertoireIds } from './repertoire';

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
