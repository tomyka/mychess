import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a request's secret is the configured one, in constant time.
 * Compares bytes, not characters: a non-ASCII header is longer in bytes.
 */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
