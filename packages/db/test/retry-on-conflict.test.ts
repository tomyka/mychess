import { describe, expect, it, vi } from 'vitest';
import { retryOnConflict } from '../src/retry-on-conflict';

/** An error as pg raises it: an Error carrying the SQLSTATE in `code`. */
const pgError = (code: string): Error =>
  Object.assign(new Error(`sqlstate ${code}`), { code });

/** An error as drizzle raises it: the pg error is its `cause`. */
const drizzleError = (code: string): Error =>
  new Error('Failed query', { cause: pgError(code) });

/** A function that throws each of `errors` in turn, then returns 'done'. */
function failing(...errors: Error[]) {
  const queue = [...errors];
  return vi.fn(() => {
    const next = queue.shift();
    return next === undefined ? Promise.resolve('done') : Promise.reject(next);
  });
}

describe('retryOnConflict', () => {
  it('returns the first result without retrying', async () => {
    const fn = failing();
    expect(await retryOnConflict(fn, 3)).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a deadlock', pgError('40P01')],
    ['a serialization failure', pgError('40001')],
    ['a deadlock wrapped by drizzle', drizzleError('40P01')],
    ['a serialization failure wrapped by drizzle', drizzleError('40001')],
  ])('runs again after %s', async (_, error) => {
    const fn = failing(error);
    expect(await retryOnConflict(fn, 2)).toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs at most `attempts` times, then throws the last conflict', async () => {
    const last = pgError('40001');
    const fn = failing(pgError('40P01'), pgError('40P01'), last);
    await expect(retryOnConflict(fn, 3)).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('runs once and throws when given one attempt', async () => {
    const conflict = pgError('40P01');
    const fn = failing(conflict);
    await expect(retryOnConflict(fn, 1)).rejects.toBe(conflict);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another SQLSTATE', pgError('23505')],
    ['another wrapped SQLSTATE', drizzleError('23503')],
    ['a plain error', new Error('bug')],
    ['a code that is not a string', Object.assign(new Error('x'), { code: 1 })],
    ['a cause that is not an object', new Error('x', { cause: '40P01' })],
    ['a cause with no code', new Error('x', { cause: new Error('y') })],
  ])('rethrows %s without retrying', async (_, error) => {
    const fn = failing(error);
    await expect(retryOnConflict(fn, 3)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
