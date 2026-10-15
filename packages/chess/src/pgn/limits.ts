/**
 * Upload limits for PGN text (R-66): checked before parsing, so a huge or
 * deeply nested file is refused cheaply, naming the limit it breaks.
 */
import type { Result } from '../result';

export const PGN_LIMITS = {
  bytes: 2 * 1024 * 1024,
  games: 200,
  depth: 64,
} as const;

export type LimitRefusal =
  | { reason: 'pgn.tooLarge'; limit: number }
  | { reason: 'pgn.tooManyGames'; limit: number }
  | { reason: 'pgn.tooDeep'; limit: number };

/** Brace and rest-of-line comments and quoted tag values: no parentheses count there. */
const NOT_MOVETEXT = /\{[^}]*\}|;[^\n]*|"(?:[^"\\]|\\.)*"/g;

/**
 * A fast pre-check that counts `[Event` tags; the importer applies the same
 * cap to the games it actually splits, so a file without Event tags is
 * still capped.
 */
function countGames(text: string): number {
  return (text.match(/^\s*\[Event\s/gm) ?? []).length;
}

function maxDepth(text: string): number {
  let depth = 0;
  let max = 0;
  for (const ch of text.replace(NOT_MOVETEXT, '')) {
    if (ch === '(') max = Math.max(max, ++depth);
    else if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return max;
}

const refuse = (
  reason: LimitRefusal['reason'],
  limit: number,
): Result<undefined, LimitRefusal> => ({
  ok: false,
  refusal: { reason, limit },
});

/** Refuses PGN text over the upload limits (R-66). */
export function checkLimits(text: string): Result<undefined, LimitRefusal> {
  if (new TextEncoder().encode(text).length > PGN_LIMITS.bytes) {
    return refuse('pgn.tooLarge', PGN_LIMITS.bytes);
  }
  if (countGames(text) > PGN_LIMITS.games) {
    return refuse('pgn.tooManyGames', PGN_LIMITS.games);
  }
  if (maxDepth(text) > PGN_LIMITS.depth) {
    return refuse('pgn.tooDeep', PGN_LIMITS.depth);
  }
  return { ok: true, value: undefined };
}
