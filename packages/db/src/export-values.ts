/** How the account export writes times and moves (R-40). */
import { fenOf, parseMoveKey } from '@mychess/chess';

/** An ISO time, or null. */
export const iso = (at: Date | null): string | null =>
  at?.toISOString() ?? null;

/**
 * Where a move is played from, as a FEN, and its SAN. A key that is
 * not a move key (a bad row) is exported as it is stored, with no SAN, so
 * it can never break the export.
 */
export function notedMove(key: string): { position: string; san: string } {
  const parts = parseMoveKey(key);
  return parts === null
    ? { position: key, san: '' }
    : { position: fenOf(parts.fromKey), san: parts.san };
}
