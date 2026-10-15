/**
 * Upload limits for PGN text (R-66): checked before parsing, so a huge or
 * deeply nested file is refused cheaply, naming the limit it breaks. Every
 * check is a single linear pass, so hostile text cannot make it slow.
 */
import type { Result } from '../result';

export const PGN_LIMITS = {
  bytes: 2 * 1024 * 1024,
  games: 200,
  depth: 64,
} as const;

export interface LimitRefusal {
  reason: 'pgn.tooLarge' | 'pgn.tooManyGames' | 'pgn.tooDeep';
  limit: number;
}

/**
 * Text where parentheses do not count, by the character that opens it and
 * the one that closes it: brace comments, rest-of-line comments and quoted
 * tag values. Text left open runs to the end.
 */
const SKIPPED = new Map([
  ['{', '}'],
  [';', '\n'],
  ['"', '"'],
]);

/**
 * A fast pre-check that counts `[Event` tags at line starts. `importPgn`
 * applies the same cap to the games it actually splits, so a file without
 * Event tags is still capped.
 */
function countGames(text: string): number {
  return (text.match(/^[ \t]*\[Event\s/gm) ?? []).length;
}

/**
 * The index of the character that closes the skipped text opened at
 * `start`, or the text's length when nothing closes it. A backslash in a
 * quoted value escapes the next character.
 */
function skipEnd(text: string, start: number, closer: string): number {
  let i = start + 1;
  while (i < text.length && text.charAt(i) !== closer) {
    i += closer === '"' && text.charAt(i) === '\\' ? 2 : 1;
  }
  return i;
}

function maxDepth(text: string): number {
  let depth = 0;
  let max = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    const closer = SKIPPED.get(ch);
    if (closer !== undefined) i = skipEnd(text, i, closer);
    else if (ch === '(') max = Math.max(max, ++depth);
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
