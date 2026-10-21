import { describe, expect, it } from 'vitest';
import { growth, LINEAR_GROWTH } from './test-support';

/** Visits every pair of `0..n`, so its time grows with the square of `n`. */
function pairs(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sum += (i ^ j) & 1;
  }
  return sum;
}

/** Visits `0..n` a few hundred times, so its time grows with `n`. */
function rounds(n: number): number {
  let sum = 0;
  for (let k = 0; k < 400; k++) {
    for (let i = 0; i < n; i++) sum += (i ^ k) & 1;
  }
  return sum;
}

const same = (n: number) => n;

describe('growth', () => {
  it('reports quadratic work above the linear bound', () => {
    expect(growth(same, pairs, 250)).toBeGreaterThanOrEqual(LINEAR_GROWTH);
  }, 300_000);

  it('reports linear work below the linear bound', () => {
    expect(growth(same, rounds, 250)).toBeLessThan(LINEAR_GROWTH);
  }, 300_000);
});
