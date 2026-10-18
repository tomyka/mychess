// Repertoires for feature tests, written straight through the repository so
// a test drives only the action or loader it is about.
import type { ChapterNameSource, Side } from '@mychess/chess';
import { createRepertoire, findAccountByEmail, type Db } from '@mychess/db';
import { graphOf, TAIMANOV } from '../../fixtures/repertoires';

export { LONDON, TAIMANOV } from '../../fixtures/repertoires';

/** The Taimanov without its [Event] tag: its chapter is named after its opening (R-63). */
export const UNTITLED_TAIMANOV = TAIMANOV.split('\n').slice(2).join('\n');

/** The ECO code a chapter is named after; throws for any other name. */
export function ecoOf(source: ChapterNameSource | undefined): string {
  if (source?.kind !== 'eco') throw new Error('not an ECO chapter');
  return source.eco;
}

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
