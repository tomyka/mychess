import type { Color, Key } from '@lichess-org/chessground/types';
import { isKey } from './squares';

const FILES = 'abcdefgh';

/** File and rank steps per arrow key, as seen with White at the bottom. */
const STEPS: ReadonlyMap<string, readonly [number, number]> = new Map([
  ['ArrowUp', [0, 1]],
  ['ArrowDown', [0, -1]],
  ['ArrowLeft', [-1, 0]],
  ['ArrowRight', [1, 0]],
]);

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** The square the keyboard cursor moves to, or null for a key that is not an arrow. */
export function stepCursor(
  from: Key,
  key: string,
  orientation: Color,
): Key | null {
  const step = STEPS.get(key);
  if (step === undefined) return null;
  const sign = orientation === 'white' ? 1 : -1;
  const file = clamp(FILES.indexOf(from.charAt(0)) + step[0] * sign, 0, 7);
  const rank = clamp(Number(from.charAt(1)) + step[1] * sign, 1, 8);
  const next = `${FILES.charAt(file)}${String(rank)}`;
  return isKey(next) ? next : from;
}

/** Where the cursor starts: the bottom-left square. */
export const cursorStart = (orientation: Color): Key =>
  orientation === 'white' ? 'a1' : 'h8';
