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
 * How many times larger the large input of {@link growth} is than the small.
 * Sixteen rather than eight (#292): linear work then grows about 16 times and
 * quadratic about 256, a gap wide enough for a bound with a factor of four of
 * room on either side.
 */
export const GROWTH_FACTOR = 16;

/**
 * The most a linear operation may grow when its input grows by
 * {@link GROWTH_FACTOR}: 64, the geometric middle of linear (16) and
 * quadratic (256) growth. A loaded machine has inflated a linear ratio by
 * more than three times (#292: 26 where about 8 was expected at the old
 * factor of eight), so the bound keeps four times of room above linear, and
 * as much below quadratic. A ratio is used rather than an absolute time
 * limit, which would depend on the machine.
 */
export const LINEAR_GROWTH = 64;

/** Timed samples per input size in one measurement; the fastest one counts. */
const SAMPLES = 5;

/**
 * At most this many measurements in one {@link growth}: a ratio at or above
 * {@link LINEAR_GROWTH} is measured again, so one stretch of load cannot fail
 * a linear operation, while quadratic work stays above the bound on every
 * measurement.
 */
const ATTEMPTS = 3;

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
 * One measurement of how many times longer `run` takes on `large` than on
 * `small`. The sizes alternate for {@link SAMPLES} samples each, so a burst
 * of load from elsewhere slows both alike, and each size counts its fastest
 * sample: load only ever adds time, so the fastest is the closest to the work
 * itself.
 */
function measure<T>(run: (input: T) => unknown, small: T, large: T): number {
  const runOn = (input: T) => () => {
    run(input);
  };
  let fastestSmall = Number.POSITIVE_INFINITY;
  let fastestLarge = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SAMPLES; i++) {
    fastestSmall = Math.min(fastestSmall, sample(runOn(small)));
    fastestLarge = Math.min(fastestLarge, sample(runOn(large)));
  }
  return fastestLarge / fastestSmall;
}

/**
 * How many times longer `run` takes on the input of size `GROWTH_FACTOR * n`
 * than on the input of size `n`. Both inputs are built before timing and the
 * small one runs once untimed to warm up the code. It returns the first
 * measurement below {@link LINEAR_GROWTH}, or the smallest of
 * {@link ATTEMPTS} measurements when none is: load that slows the large input
 * more than the small one (memory bandwidth, cache, garbage collection) comes
 * and goes, so a later measurement escapes it, while quadratic work grows
 * past the bound every time.
 */
export function growth<T>(
  inputOf: (n: number) => T,
  run: (input: T) => unknown,
  n: number,
): number {
  const small = inputOf(n);
  const large = inputOf(GROWTH_FACTOR * n);
  run(small);
  let smallest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ATTEMPTS && smallest >= LINEAR_GROWTH; i++) {
    smallest = Math.min(smallest, measure(run, small, large));
  }
  return smallest;
}
