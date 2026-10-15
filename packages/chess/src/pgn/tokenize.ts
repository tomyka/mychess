import type { Result } from '../result';

/** One meaningful piece of PGN text; move numbers and whitespace are dropped. */
export type Token =
  | { kind: 'tag'; name: string; value: string }
  | { kind: 'san'; san: string }
  | { kind: 'nag'; nag: number }
  | { kind: 'comment'; text: string }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'result' };

/** A token of a game's movetext: everything but tag pairs and results. */
export type MovetextToken = Exclude<
  Token,
  { kind: 'tag' } | { kind: 'result' }
>;

/** Text the tokenizer cannot read, with the offset where reading stopped. */
export interface UnreadablePgn {
  reason: 'pgn.unreadable';
  offset: number;
}

/** The traditional move-suffix glyphs and the NAGs they stand for. */
const SUFFIX_NAGS: Readonly<Record<string, number>> = {
  '!': 1,
  '?': 2,
  '!!': 3,
  '??': 4,
  '!?': 5,
  '?!': 6,
};

interface Rule {
  pattern: RegExp;
  read: (match: RegExpExecArray) => Token[];
}

const none = (): Token[] => [];

const RULES: readonly Rule[] = [
  { pattern: /\s+/y, read: none },
  {
    pattern: /\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/y,
    read: (m) => [
      { kind: 'tag', name: m[1] ?? '', value: unescape(m[2] ?? '') },
    ],
  },
  { pattern: /\{([^}]*)\}/y, read: (m) => commentTokens(m[1] ?? '') },
  { pattern: /;[^\n]*/y, read: none },
  { pattern: /\$(\d+)/y, read: (m) => [{ kind: 'nag', nag: Number(m[1]) }] },
  { pattern: /\(/y, read: () => [{ kind: 'open' }] },
  { pattern: /\)/y, read: () => [{ kind: 'close' }] },
  { pattern: /(?:1-0|0-1|1\/2-1\/2|\*)/y, read: () => [{ kind: 'result' }] },
  { pattern: /\d+\.+/y, read: none },
  { pattern: /[^\s(){};$[\]"]+/y, read: (m) => sanTokens(m[0]) },
];

function unescape(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

function commentTokens(body: string): Token[] {
  const text = body
    .replace(/\[%[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? [] : [{ kind: 'comment', text }];
}

/**
 * A move, then the NAG its suffix glyphs stand for, if any. Glyphs written
 * apart from their move give the NAG alone.
 */
function sanTokens(raw: string): Token[] {
  const glyphs = /[!?]*$/.exec(raw)?.[0] ?? '';
  const san = raw.slice(0, raw.length - glyphs.length);
  const nag = SUFFIX_NAGS[glyphs];
  const tokens: Token[] = san === '' ? [] : [{ kind: 'san', san }];
  return nag === undefined ? tokens : [...tokens, { kind: 'nag', nag }];
}

function readAt(
  text: string,
  offset: number,
): { tokens: Token[]; end: number } | null {
  for (const { pattern, read } of RULES) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (match !== null) return { tokens: read(match), end: pattern.lastIndex };
  }
  return null;
}

/** Splits PGN text into tokens, or refuses text it cannot read. */
export function tokenize(text: string): Result<Token[], UnreadablePgn> {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < text.length) {
    const step = readAt(text, offset);
    if (step === null) {
      return { ok: false, refusal: { reason: 'pgn.unreadable', offset } };
    }
    tokens.push(...step.tokens);
    offset = step.end;
  }
  return { ok: true, value: tokens };
}
