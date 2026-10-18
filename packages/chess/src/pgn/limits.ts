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
 * Text where parentheses and moves do not count, by the character that
 * opens it and the one that closes it: brace comments, rest-of-line
 * comments and quoted tag values. Text left open runs to the end.
 */
const SKIPPED = new Map([
  ['{', '}'],
  [';', '\n'],
  ['"', '"'],
]);

/** Characters that end a word of movetext; '.' parts a move from its number. */
const WORD_BREAK = /[\s(){};$[\]".]/;

/**
 * What a move starts with: a letter (SAN and the O-O castling) or the
 * 0-0 castling. Move numbers, results and NAGs start otherwise.
 */
const MOVE_START = /[A-Za-z]|0-0/y;

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

/** What one pass over the text has seen so far. */
interface Scan {
  depth: number;
  maxDepth: number;
  plies: number;
  /** Inside a tag pair's brackets, which end at `]` or the line's end. */
  inTag: boolean;
  inWord: boolean;
}

/** Follows variation nesting and tag-pair brackets. */
function bracket(scan: Scan, ch: string): void {
  if (ch === '(') scan.maxDepth = Math.max(scan.maxDepth, ++scan.depth);
  else if (ch === ')') scan.depth = Math.max(0, scan.depth - 1);
  else if (ch === '[') scan.inTag = true;
  else if (ch === ']' || ch === '\n') scan.inTag = false;
}

/** Counts a move at the start of each movetext word outside tag pairs. */
function word(scan: Scan, text: string, i: number): void {
  const breaks = WORD_BREAK.test(text.charAt(i));
  MOVE_START.lastIndex = i;
  if (!breaks && !scan.inWord && !scan.inTag && MOVE_START.test(text)) {
    scan.plies++;
  }
  scan.inWord = !breaks;
}

/** The deepest variation nesting and the half-moves, in one pass. */
function scanText(text: string): Scan {
  const scan: Scan = {
    depth: 0,
    maxDepth: 0,
    plies: 0,
    inTag: false,
    inWord: false,
  };
  for (let i = 0; i < text.length; i++) {
    const closer = SKIPPED.get(text.charAt(i));
    if (closer === undefined) {
      bracket(scan, text.charAt(i));
      word(scan, text, i);
    } else {
      i = skipEnd(text, i, closer);
      scan.inWord = false;
      if (closer === '\n') scan.inTag = false;
    }
  }
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
