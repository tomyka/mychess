import type { MovetextToken, Token } from './tokenize';

/** One game of a PGN file: its tag pairs and its movetext tokens. */
export interface RawGame {
  headers: Readonly<Record<string, string>>;
  body: readonly MovetextToken[];
}

interface Draft {
  headers: Map<string, string>;
  body: MovetextToken[];
}

const emptyDraft = (): Draft => ({ headers: new Map(), body: [] });

const isEmpty = (draft: Draft): boolean =>
  draft.headers.size === 0 && draft.body.length === 0;

const toGame = (draft: Draft): RawGame => ({
  headers: Object.fromEntries(draft.headers),
  body: draft.body,
});

/**
 * Splits a file's tokens into games. A game ends at its result, or where a
 * tag pair follows movetext (exports that omit the result or the blank
 * line between games).
 */
export function splitGames(tokens: readonly Token[]): RawGame[] {
  const games: RawGame[] = [];
  let draft = emptyDraft();
  const flush = (): void => {
    if (!isEmpty(draft)) games.push(toGame(draft));
    draft = emptyDraft();
  };
  for (const token of tokens) {
    if (token.kind === 'result') {
      flush();
    } else if (token.kind === 'tag') {
      if (draft.body.length > 0) flush();
      draft.headers.set(token.name, token.value);
    } else {
      draft.body.push(token);
    }
  }
  flush();
  return games;
}
