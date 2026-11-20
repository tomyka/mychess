/**
 * Whether an upload looks imported for the wrong side (#364, R-214): a
 * Black repertoire imported as White keeps White's first move and leaves
 * every other one out as a second answer, so most of its games lose moves.
 */
import type { Side } from '../repertoire/graph';
import { importPgn, type ImportedRepertoire, type Skipped } from './import-pgn';

const OTHER: Readonly<Record<Side, Side>> = { white: 'black', black: 'white' };

/** The file's games that lost at least one second answer, by number. */
function gamesLosingAnswers(skipped: readonly Skipped[]): Set<number> {
  return new Set(
    skipped
      .filter((item) => item.reason === 'pgn.secondAnswer')
      .map((item) => item.game),
  );
}

/**
 * The games read: each that became a chapter, and each that lost all its
 * moves as second answers and so became none.
 */
const gamesRead = (
  imported: ImportedRepertoire,
  losing: ReadonlySet<number>,
): number => new Set([...Object.values(imported.pgnGames), ...losing]).size;

/**
 * The other side, when `imported` (`text` imported for `side`) lost second
 * answers in most of its games and the other side would lose them in fewer;
 * otherwise null. The other side is imported only when the first test holds.
 */
export function suggestedSide(
  text: string,
  side: Side,
  imported: ImportedRepertoire,
): Side | null {
  const losing = gamesLosingAnswers(imported.skipped);
  if (losing.size * 2 <= gamesRead(imported, losing)) return null;
  const other = OTHER[side];
  const asOther = importPgn(text, other);
  return asOther.ok &&
    gamesLosingAnswers(asOther.value.skipped).size < losing.size
    ? other
    : null;
}
