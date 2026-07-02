import { describe, it, expect } from 'vitest';
import { ageBracket } from './rank';

describe('ageBracket', () => {
  const YEAR = 2026;

  it('returns null when birth year is null', () => {
    expect(ageBracket(null, YEAR)).toBeNull();
  });

  it('classifies juniors by upper bound of each bracket', () => {
    expect(ageBracket(2019, YEAR)).toBe('U8');
    expect(ageBracket(2018, YEAR)).toBe('U8');
    expect(ageBracket(2017, YEAR)).toBe('U10');
    expect(ageBracket(2016, YEAR)).toBe('U10');
    expect(ageBracket(2014, YEAR)).toBe('U12');
    expect(ageBracket(2012, YEAR)).toBe('U14');
    expect(ageBracket(2010, YEAR)).toBe('U16');
    expect(ageBracket(2008, YEAR)).toBe('U18');
    expect(ageBracket(2006, YEAR)).toBe('U20');
  });

  it('classifies adults between U20 and senior as open', () => {
    expect(ageBracket(2005, YEAR)).toBe('open');
    expect(ageBracket(1977, YEAR)).toBe('open');
  });

  it('classifies seniors, checking 65+ before 50+', () => {
    expect(ageBracket(1976, YEAR)).toBe('50+');
    expect(ageBracket(1962, YEAR)).toBe('50+');
    expect(ageBracket(1961, YEAR)).toBe('65+');
    expect(ageBracket(1950, YEAR)).toBe('65+');
  });
});
