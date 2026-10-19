/**
 * Upload limits for PGN text (R-66, R-119): checked before parsing, so a
 * huge, deeply nested or move-heavy file is refused cheaply, naming the
 * limit it breaks. Every check is a single linear pass, so hostile text
 * cannot make it slow.
 */
import type { Result } from '../result';

export const PGN_LIMITS = {
  bytes: 2 * 1024 * 1024,
  games: 200,
  depth: 64,
  /** Half-moves in the whole file, variations included (R-119). */
  plies: 50_000,
} as const;

export interface LimitRefusal {
  reason:
    'pgn.tooLarge' | 'pgn.tooManyGames' | 'pgn.tooDeep' | 'pgn.tooManyMoves';
  limit: number;
}

/**
 * A fast pre-check that counts `[Event` tags at line starts. `importPgn`
 * applies the same cap to the games it actually splits, so a file without
 * Event tags is still capped.
 */
function countGames(text: string): number {
  return (text.match(/^[ \t]*\[Event\s/gm) ?? []).length;
}

/**
 * The movetext tokens the limits look at, in one native regular-expression
 * pass, so a 2 MB file costs a few thousand matches rather than two million
 * steps. In order: brace comments, rest-of-line comments, tag pairs (to `]`
 * or the line's end, quoted values whole), quoted text, parentheses, and
 * words of movetext ('.' parts a move from its number). Text left open runs
 * to the end. Comments, tags and quotes are matched only to be skipped.
 */
const TOKEN =
  /\{[^}]*\}?|;[^\n]*|\[(?:[^\]\n"]|"(?:[^"\\\n]|\\.)*"?)*|"(?:[^"\\]|\\.)*"?|[()]|[^\s(){};$[\]".]+/g;

/**
 * What a move starts with: a letter (SAN and the O-O castling) or the
 * 0-0 castling. Move numbers, results and NAGs start otherwise.
 */
const MOVE_START = /^(?:[A-Za-z]|0-0)/;

/** The deepest variation nesting and the half-moves. */
interface Scan {
  depth: number;
  maxDepth: number;
  plies: number;
}

/** Follows one token: a parenthesis changes the depth, a move counts. */
function follow(scan: Scan, token: string): void {
  if (token === '(') scan.maxDepth = Math.max(scan.maxDepth, ++scan.depth);
  else if (token === ')') scan.depth = Math.max(0, scan.depth - 1);
  else if (MOVE_START.test(token)) scan.plies++;
}

/** The deepest variation nesting and the half-moves, in one pass. */
function scanText(text: string): Scan {
  const scan: Scan = { depth: 0, maxDepth: 0, plies: 0 };
  for (const [token] of text.matchAll(TOKEN)) follow(scan, token);
  return scan;
}

const refuse = (
  reason: LimitRefusal['reason'],
  limit: number,
): Result<undefined, LimitRefusal> => ({
  ok: false,
  refusal: { reason, limit },
});

/** Refuses PGN text over the upload limits (R-66, R-119). */
export function checkLimits(text: string): Result<undefined, LimitRefusal> {
  if (new TextEncoder().encode(text).length > PGN_LIMITS.bytes) {
    return refuse('pgn.tooLarge', PGN_LIMITS.bytes);
  }
  if (countGames(text) > PGN_LIMITS.games) {
    return refuse('pgn.tooManyGames', PGN_LIMITS.games);
  }
  const scan = scanText(text);
  if (scan.maxDepth > PGN_LIMITS.depth) {
    return refuse('pgn.tooDeep', PGN_LIMITS.depth);
  }
  if (scan.plies > PGN_LIMITS.plies) {
    return refuse('pgn.tooManyMoves', PGN_LIMITS.plies);
  }
  return { ok: true, value: undefined };
}
