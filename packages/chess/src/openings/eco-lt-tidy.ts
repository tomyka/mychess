// The "safe tidy" of šachmatai.lt's Lithuanian opening names (ruling R-77),
// applied by `scripts/generate-eco-lt.mjs`. Only notation and punctuation
// change; wording, capitalisation and word forms stay verbatim.

/** A move with its number: `5.Žf3`, `6...Žbd7`, `9.O-O`. */
const NUMBERED_MOVE = /^\d+\.+\S+$/u;
/** A move without a number: `c5`, `Žbd7`, `Rc3+`, `O-O`, `cd`. */
const BARE_MOVE = /^(?:O-O(?:-O)?|[KVRŽBNQ]?[a-h]?[1-8]?x?[a-h][1-8]?)[+#]?$/u;
/** Words that open a qualifier themselves: "with", "without", "and". */
const QUALIFIER_WORDS = new Set(['su', 'be', 'ir']);
const WORD = /^\p{L}+$/u;

function isMove(token: string): boolean {
  return NUMBERED_MOVE.test(token) || BARE_MOVE.test(token);
}

/**
 * The index of the first numbered move in the trailing run of moves, or the
 * token count when that run has none.
 */
function trailingMovesStart(tokens: readonly string[]): number {
  const run = tokens.findLastIndex((token) => !isMove(token)) + 1;
  const first = tokens.findIndex(
    (token, index) => index >= run && NUMBERED_MOVE.test(token),
  );
  return first === -1 ? tokens.length : first;
}

/** "variantas 5.Žf3" -> "variantas, 5.Žf3", when a plain word precedes. */
function commaBeforeTrailingMoves(name: string): string {
  const tokens = name.split(' ');
  const start = trailingMovesStart(tokens);
  const before = tokens[start - 1];
  if (start === tokens.length || before === undefined) return name;
  if (!WORD.test(before) || QUALIFIER_WORDS.has(before) || isMove(before)) {
    return name;
  }
  tokens[start - 1] = `${before},`;
  return tokens.join(' ');
}

export function tidyLtName(name: string): string {
  const tidied = name
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/(?<![\d-])0-0(?:-0)?(?![\d-])/gu, (castling) =>
      castling.replaceAll('0', 'O'),
    )
    .replace(/(\d+\.+) (?=\S)/gu, '$1');
  return commaBeforeTrailingMoves(tidied);
}
