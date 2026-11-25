import { describe, expect, it } from 'vitest';
import { heroState } from './hero-state';

const s = (due: number, toLearn: number, rows: number) => ({
  due,
  toLearn,
  rows,
});

describe('heroState', () => {
  it('is empty without a trained repertoire, whatever the counts', () => {
    expect(heroState(s(0, 0, 0))).toBe('empty');
    expect(heroState(s(3, 2, 0))).toBe('empty');
  });

  it('is due when anything is due', () => {
    expect(heroState(s(1, 5, 1))).toBe('due');
    expect(heroState(s(1, 0, 1))).toBe('due');
  });

  it('is learn when nothing is due and new moves are allowed', () => {
    expect(heroState(s(0, 1, 1))).toBe('learn');
  });

  it('is done when nothing is due or allowed', () => {
    expect(heroState(s(0, 0, 2))).toBe('done');
  });
});
