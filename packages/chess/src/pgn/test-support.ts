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

/** How many times larger the large input of {@link growth} is than the small. */
const GROWTH_FACTOR = 8;

/**
 * The most a linear operation may grow when its input grows by
 * {@link GROWTH_FACTOR}. Linear work grows about 8 times and quadratic work
 * about 64, so 24 tells them apart with room for a loaded machine's noise on
 * either side, where an absolute time limit depends on the machine.
 */
export const LINEAR_GROWTH = 24;

/** Timed samples per input size; the fastest one counts. */
const SAMPLES = 5;

/** A sample repeats a fast run until this many milliseconds have passed. */
const MIN_SAMPLE_MS = 20;

/**
 * One sample of `run`'s time per call, in milliseconds: it calls `run` until
 * at least {@link MIN_SAMPLE_MS} have passed, so a run far below the timer's
 * and the scheduler's resolution is still measured over a span they resolve.
 */
function sample(run: () => void): number {
  const start = performance.now();
  let calls = 0;
  let elapsed: number;
  do {
    run();
    calls++;
    elapsed = performance.now() - start;
  } while (elapsed < MIN_SAMPLE_MS);
  return elapsed / calls;
}

/**
 * How many times longer `run` takes on the input of size `GROWTH_FACTOR * n`
 * than on the input of size `n`. Both inputs are built before timing and the
 * small one runs once untimed to warm up the code. The sizes then alternate
 * for {@link SAMPLES} samples each, so a burst of load from elsewhere slows
 * both alike, and each size counts its fastest sample: load only ever adds
 * time, so the fastest is the closest to the work itself.
 */
export function growth<T>(
  inputOf: (n: number) => T,
  run: (input: T) => unknown,
  n: number,
): number {
  const small = inputOf(n);
  const large = inputOf(GROWTH_FACTOR * n);
  const runOn = (input: T) => () => {
    run(input);
  };
  run(small);
  let fastestSmall = Number.POSITIVE_INFINITY;
  let fastestLarge = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SAMPLES; i++) {
    fastestSmall = Math.min(fastestSmall, sample(runOn(small)));
    fastestLarge = Math.min(fastestLarge, sample(runOn(large)));
  }
  return fastestLarge / fastestSmall;
}
