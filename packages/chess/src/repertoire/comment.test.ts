import { describe, expect, it } from 'vitest';
import { normalizeComment } from './comment';

describe('normalizeComment', () => {
  it.each([
    ['  Best   by\ntest ', 'Best by test'],
    ['Close } early', 'Close early'],
    ['Plan [%cal Ge2e4] here', 'Plan here'],
    ['Kodėl ne 5...Qc7?', 'Kodėl ne 5...Qc7?'],
    ['a}b', 'a b'],
  ])('keeps %j as %j, the text PGN carries', (typed, kept) => {
    expect(normalizeComment(typed)).toBe(kept);
  });

  it.each([[''], ['   '], ['}'], ['[%csl Gd4]']])(
    'makes %j no comment',
    (typed) => {
      expect(normalizeComment(typed)).toBeNull();
    },
  );
});
