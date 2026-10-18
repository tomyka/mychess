// Repertoires for feature tests, written straight through the repository so
// a test drives only the action or loader it is about.
import type { Side } from '@mychess/chess';
import { createRepertoire, findAccountByEmail, type Db } from '@mychess/db';
import { graphOf } from '../../fixtures/repertoires';

export { LONDON, TAIMANOV } from '../../fixtures/repertoires';

export interface SeededRepertoire {
  /** The PGN to import, or null for an empty repertoire without chapters. */
  readonly pgn: string | null;
  readonly side: Side;
  readonly name: string;
}

/** Imports `pgn` as a repertoire of the account `ownerEmail`; returns its id. */
export async function seedRepertoire(
  db: Db,
  ownerEmail: string,
  { pgn, side, name }: SeededRepertoire,
): Promise<string> {
  const owner = await findAccountByEmail(db, ownerEmail);
  if (owner === undefined) throw new Error(`no account ${ownerEmail}`);
  return createRepertoire(db, {
    ownerId: owner.id,
    side,
    name,
    graph:
      pgn === null ? { side, chapters: [], moves: [] } : graphOf(pgn, side),
    now: new Date(),
  });
}
