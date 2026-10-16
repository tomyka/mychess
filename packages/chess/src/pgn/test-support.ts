/** Helpers shared by the PGN tests; no runtime code imports this file. */
import { DEFAULT_POSITION } from 'chess.js';
import { positionKey } from '../position-key';
import type { Side } from '../repertoire/graph';
import { importPgn, type ImportedRepertoire } from './import-pgn';

/** The standard start position's key. */
export const START = positionKey(DEFAULT_POSITION);

/** `value`, or a thrown error when it is missing. */
export function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** The repertoire `text` imports to, or a thrown error naming the refusal. */
export function imported(
  text: string,
  side: Side = 'white',
): ImportedRepertoire {
  const r = importPgn(text, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

/**
 * The most a linear operation may grow when its input grows fourfold. Linear
 * work grows about 4 times and quadratic work about 16, so 8 tells them apart
 * on any machine, where an absolute time limit depends on the machine.
 */
export const LINEAR_GROWTH = 8;

/** The fastest of three runs of `run`, in milliseconds. */
function fastest(run: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * How many times longer `run` takes on the input of size `4 * n` than on the
 * input of size `n`. Both inputs are built before timing, and each size takes
 * the fastest of three runs to cut noise; pick `n` big enough that a run
 * takes some milliseconds.
 */
export function growth<T>(
  inputOf: (n: number) => T,
  run: (input: T) => unknown,
  n: number,
): number {
  const small = inputOf(n);
  const large = inputOf(4 * n);
  const timeOf = (input: T) =>
    fastest(() => {
      run(input);
    });
  return timeOf(large) / timeOf(small);
}
