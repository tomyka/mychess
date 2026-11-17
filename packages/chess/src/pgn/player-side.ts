/**
 * The side a PGN file is a repertoire for, read from its players (#330
 * decision 8): the importing account's names in the [White] or [Black]
 * header. The import page uses it as the side's default only; the player
 * still chooses.
 */
import type { Side } from '../repertoire/graph';
import { splitGames, type PgnHeaders } from './split-games';
import { tokenize } from './tokenize';

/**
 * A name as compared: composed letters (a decomposed "ė" matches a composed
 * one), trimmed, without case, the same in any locale.
 */
const fold = (name: string): string =>
  name.normalize('NFC').trim().toLowerCase();

/** The colour one game names the player in; null for neither or both. */
function sideIn(headers: PgnHeaders, names: ReadonlySet<string>): Side | null {
  const white = names.has(fold(headers['White'] ?? ''));
  const black = names.has(fold(headers['Black'] ?? ''));
  if (white === black) return null;
  return white ? 'white' : 'black';
}

/**
 * The colour every game of `text` names one of `names` in, compared without
 * case or surrounding spaces; null when a game names none of them or both
 * sides, the games disagree, there are none, or the text cannot be read.
 */
export function playerSide(
  text: string,
  names: readonly string[],
): Side | null {
  const wanted = new Set(names.map(fold).filter((n) => n !== ''));
  if (wanted.size === 0) return null;
  const tokens = tokenize(text);
  if (!tokens.ok) return null;
  const sides = new Set(
    splitGames(tokens.value).map((g) => sideIn(g.headers, wanted)),
  );
  const [only = null] = sides;
  return sides.size === 1 ? only : null;
}
